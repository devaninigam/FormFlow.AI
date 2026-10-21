const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');
const PdfReconstructor = require('../services/pdfReconstructor');
const WordExporter = require('../services/wordExporter');
const ExcelExporter = require('../services/excelExporter');
const JsonExporter = require('../services/jsonExporter');
const SampleGenerator = require('../services/sampleGenerator');
const AccidentReportPdfGenerator = require('../services/accidentReportPdfGenerator');

function isAccidentDoc(doc) {
  if (!doc) return false;
  const name = String(doc.filename || doc.documentTitle || '').toLowerCase();
  return name.includes('accident') || name.includes('incident') ||
    (doc.fields || []).some(f => /riddor|injury|incident|daycare|toybox|ey staff/i.test(f.label || ''));
}

// Setup storage directories
const UPLOADS_DIR = path.join(__dirname, '..', 'storage', 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', 'storage', 'processed');

[UPLOADS_DIR, PROCESSED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/tiff'
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(pdf|png|jpe?g|webp|tiff)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, PNG, JPG, WEBP, or TIFF file.'));
    }
  }
});

// In-memory document session cache
const documentsMap = new Map();

/**
 * Save document session to memory and disk
 */
function saveDocumentState(doc) {
  documentsMap.set(doc.id, doc);
  try {
    const metaPath = path.join(PROCESSED_DIR, `${doc.id}.json`);
    // Save metadata without large page buffers
    const meta = {
      ...doc,
      pages: (doc.pages || []).map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        pdfPointsWidth: p.pdfPointsWidth,
        pdfPointsHeight: p.pdfPointsHeight,
        originalType: p.originalType,
        textItems: p.textItems || [],
        fullText: p.fullText || ''
      }))
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error('Failed to write document metadata to disk:', err.message);
  }
}

/**
 * Helper to get document or throw 404 (persisted across restarts)
 */
async function getDocumentOr404(id, res) {
  let doc = documentsMap.get(id);
  if (!doc) {
    const metaPath = path.join(PROCESSED_DIR, `${id}.json`);
    if (fs.existsSync(metaPath)) {
      try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        doc = JSON.parse(raw);
        documentsMap.set(id, doc);
      } catch (e) {
        console.error(`Failed to read doc ${id} from disk:`, e);
      }
    }
  }

  if (!doc) {
    res.status(404).json({ error: `Document with ID ${id} not found.` });
    return null;
  }

  // Ensure page buffers are loaded if missing (needed for page rendering, PDF reconstruction and exports)
  if (!doc.pages || doc.pages.length === 0 || (!doc.pages[0].buffer && !doc.pages[0].pageBuffer)) {
    if (doc.originalPath && fs.existsSync(doc.originalPath)) {
      try {
        const freshPages = await ImagePreprocessor.extractPages(doc.originalPath, doc.mimeType);
        doc.pages = freshPages;
        documentsMap.set(id, doc);
      } catch (err) {
        console.warn(`Could not re-extract pages for ${id}:`, err.message);
      }
    }
  }

  return doc;
}

// ----------------------------------------------------------------------------
// 1. Check System Providers Status
// ----------------------------------------------------------------------------
router.get('/status', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    providers: {
      builtin: {
        available: true,
        name: 'FormFlow Smart Local Engine (Sharp + Tesseract + CV)',
        readyWithoutKey: true
      },
      azure: {
        available: !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY && process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT),
        name: 'Azure AI Document Intelligence',
        configured: !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY && process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT)
      },
      gemini: {
        available: !!process.env.GEMINI_API_KEY,
        name: 'Google Gemini 1.5 / 2.0 Vision LLM',
        configured: !!process.env.GEMINI_API_KEY
      },
      openai: {
        available: !!process.env.OPENAI_API_KEY,
        name: 'OpenAI GPT-4o Vision',
        configured: !!process.env.OPENAI_API_KEY
      }
    }
  });
});

// ----------------------------------------------------------------------------
// 2. Upload Document
// ----------------------------------------------------------------------------
router.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document file uploaded.' });
    }

    const docId = `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    // Extract pages and render previews
    const pages = await ImagePreprocessor.extractPages(filePath, mimeType);

    const doc = {
      id: docId,
      filename: req.file.originalname,
      mimeType,
      originalPath: filePath,
      pageCount: pages.length,
      pages,
      fields: [],
      tables: [],
      summary: {
        totalFields: 0,
        verifiedCount: 0,
        highConfidenceCount: 0,
        needsReviewCount: 0,
        unreadableCount: 0
      },
      status: 'uploaded',
      uploadedAt: new Date().toISOString()
    };

    saveDocumentState(doc);

    res.json({
      success: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
        status: doc.status,
        pages: pages.map(p => ({
          pageNumber: p.pageNumber,
          width: p.width,
          height: p.height
        }))
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: `Upload processing failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 3. Analyze Document (OCR & Dynamic Layout Understanding)
// ----------------------------------------------------------------------------
router.post('/analyze/:id', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const {
      provider = 'auto',
      secondaryAiLayer = false,
      apiKey = null,
      geminiKey = null,
      openaiKey = null,
      azureKey = null,
      azureEndpoint = null
    } = req.body || {};

    const analysisResult = await OcrEngine.analyzeDocument(doc.pages, {
      provider,
      secondaryAiLayer,
      apiKey,
      geminiKey,
      openaiKey,
      azureKey,
      azureEndpoint
    });

    // Update document record
    doc.fields = analysisResult.fields || [];
    doc.tables = analysisResult.tables || [];
    doc.summary = analysisResult.summary || {};
    doc.engineUsed = analysisResult.engineUsed;
    doc.status = analysisResult.status || 'analyzed';
    doc.extractedAt = new Date().toISOString();

    saveDocumentState(doc);

    res.json({
      success: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
        status: doc.status,
        engineUsed: doc.engineUsed,
        summary: doc.summary,
        fields: doc.fields,
        tables: doc.tables,
        pages: doc.pages.map(p => ({
          pageNumber: p.pageNumber,
          width: p.width,
          height: p.height
        }))
      }
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: `Document analysis failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 4. Retrieve Document Details
// ----------------------------------------------------------------------------
router.get('/document/:id', async (req, res) => {
  const doc = await getDocumentOr404(req.params.id, res);
  if (!doc) return;

  res.json({
    document: {
      id: doc.id,
      filename: doc.filename,
      pageCount: doc.pageCount,
      status: doc.status,
      engineUsed: doc.engineUsed,
      summary: doc.summary,
      fields: doc.fields,
      tables: doc.tables,
      pages: (doc.pages || []).map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height
      }))
    }
  });
});

// ----------------------------------------------------------------------------
// 5. Get Page Image (High-Res PNG)
// ----------------------------------------------------------------------------
router.get('/page/:id/:pageNumber', async (req, res) => {
  const doc = await getDocumentOr404(req.params.id, res);
  if (!doc) return;

  const pageNum = parseInt(req.params.pageNumber, 10) || 1;
  const page = doc.pages.find(p => p.pageNumber === pageNum) || doc.pages[0];

  if (!page || !page.buffer) {
    return res.status(404).json({ error: `Page ${pageNum} not available` });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(page.buffer);
});

// ----------------------------------------------------------------------------
// 5b. Get Reconstructed Page Image (Digital Text Overlaid on Cleaned Page)
// ----------------------------------------------------------------------------
router.get('/reconstructed-page/:id/:pageNumber', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const pageNum = parseInt(req.params.pageNumber, 10) || 1;
    const page = doc.pages.find(p => p.pageNumber === pageNum) || doc.pages[0];

    if (!page || !page.buffer) {
      return res.status(404).json({ error: `Page ${pageNum} not available` });
    }

    if (isAccidentDoc(doc)) {
      const generated = await AccidentReportPdfGenerator.generate(doc);
      if (generated.previewPng) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.send(generated.previewPng);
      }
    }

    const reconstruction = await PdfReconstructor.reconstruct([page], doc.fields || [], { fontName: 'Helvetica' });
    if (reconstruction.previewImages && reconstruction.previewImages[0]?.dataUrl) {
      const base64Data = reconstruction.previewImages[0].dataUrl.replace(/^data:image\/png;base64,/, '');
      const imgBuf = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.send(imgBuf);
    }

    res.setHeader('Content-Type', 'image/png');
    res.send(page.buffer);
  } catch (err) {
    console.error('Reconstructed page preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6. Save Corrected Fields & User Edits
// ----------------------------------------------------------------------------
router.put('/document/:id/fields', async (req, res) => {
  const doc = await getDocumentOr404(req.params.id, res);
  if (!doc) return;

  const { fields, tables } = req.body;
  if (!Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields must be an array' });
  }

  doc.fields = fields;
  if (Array.isArray(tables)) {
    doc.tables = tables;
  }

  // Recalculate verification metrics
  const total = doc.fields.length;
  const verified = doc.fields.filter(f => f.verified).length;
  const highConf = doc.fields.filter(f => f.confidence >= 0.85).length;
  const needsReview = doc.fields.filter(f => f.confidence < 0.85 && f.confidence >= 0.50).length;
  const unreadable = doc.fields.filter(f => f.confidence < 0.50 || f.isUnreadable).length;

  doc.summary = {
    totalFields: total,
    verifiedCount: verified,
    highConfidenceCount: highConf,
    needsReviewCount: needsReview,
    unreadableCount: unreadable,
    tablesCount: (doc.tables || []).length
  };

  doc.status = verified === total && total > 0 ? 'verified' : 'in_progress';
  doc.extractedAt = new Date().toISOString();
  saveDocumentState(doc);

  res.json({
    success: true,
    summary: doc.summary,
    status: doc.status,
    extractedAt: doc.extractedAt
  });
});

// ----------------------------------------------------------------------------
// 7. Update Cleanup Regions
// ----------------------------------------------------------------------------
router.put('/document/:id/cleanup-regions', async (req, res) => {
  const doc = await getDocumentOr404(req.params.id, res);
  if (!doc) return;

  const { regions } = req.body;
  doc.cleanupRegions = regions || [];
  saveDocumentState(doc);

  res.json({ success: true, cleanupRegionsCount: doc.cleanupRegions.length });
});

// ----------------------------------------------------------------------------
// 8. Export Reconstructed PDF (Supports both POST & GET)
// ----------------------------------------------------------------------------
router.all('/export/pdf/:id', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const fieldsToUse = Array.isArray(req.body?.fields) ? req.body.fields : doc.fields;
    const safeBaseName = doc.filename.replace(/\.[^/.]+$/, '');

    if (isAccidentDoc(doc)) {
      const generated = await AccidentReportPdfGenerator.generate({ ...doc, fields: fieldsToUse });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName}_reconstructed.pdf"`);
      return res.send(generated.pdfBuffer);
    }

    const reconstruction = await PdfReconstructor.reconstruct(doc.pages, fieldsToUse, req.body || {});

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName}_reconstructed.pdf"`);
    res.send(reconstruction.pdfBuffer);
  } catch (err) {
    console.error('PDF Reconstruction error:', err);
    res.status(500).json({ error: `PDF reconstruction failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 9. Preview Reconstructed PDF (In-Browser Inspection)
// ----------------------------------------------------------------------------
router.all('/preview/pdf/:id', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const fieldsToUse = Array.isArray(req.body?.fields) ? req.body.fields : doc.fields;

    if (isAccidentDoc(doc)) {
      const generated = await AccidentReportPdfGenerator.generate({ ...doc, fields: fieldsToUse });
      return res.json({
        success: true,
        previewImages: generated.previewImages,
        report: generated.report
      });
    }

    const reconstruction = await PdfReconstructor.reconstruct(doc.pages, fieldsToUse, req.body || {});
    res.json({
      success: true,
      previewImages: reconstruction.previewImages,
      report: reconstruction.report
    });
  } catch (err) {
    console.error('PDF Preview error:', err);
    res.status(500).json({ error: `PDF preview generation failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 10. Export Word (.docx) (Supports both POST & GET)
// ----------------------------------------------------------------------------
router.all('/export/word/:id', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const fieldsToUse = Array.isArray(req.body?.fields) ? req.body.fields : doc.fields;
    const tablesToUse = Array.isArray(req.body?.tables) ? req.body.tables : (doc.tables || []);
    const docxBuffer = await WordExporter.generateDocx({ ...doc, fields: fieldsToUse, tables: tablesToUse });
    const safeBaseName = doc.filename.replace(/\.[^/.]+$/, '');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName}.docx"`);
    res.send(docxBuffer);
  } catch (err) {
    console.error('Word export error:', err);
    res.status(500).json({ error: `Word export failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 11. Export Excel (.xlsx) (Supports both POST & GET)
// ----------------------------------------------------------------------------
router.all('/export/excel/:id', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const fieldsToUse = Array.isArray(req.body?.fields) ? req.body.fields : doc.fields;
    const tablesToUse = Array.isArray(req.body?.tables) ? req.body.tables : (doc.tables || []);
    const excelBuffer = await ExcelExporter.generateExcel({ ...doc, fields: fieldsToUse, tables: tablesToUse });
    const safeBaseName = doc.filename.replace(/\.[^/.]+$/, '');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName}.xlsx"`);
    res.send(excelBuffer);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: `Excel export failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------------------
// 12. Export JSON (Clean metadata & instant payload)
// ----------------------------------------------------------------------------
router.all('/export/json/:id', async (req, res) => {
  const doc = await getDocumentOr404(req.params.id, res);
  if (!doc) return;

  const fieldsToUse = Array.isArray(req.body?.fields) ? req.body.fields : doc.fields;
  const jsonData = JsonExporter.formatJson({ ...doc, fields: fieldsToUse });
  const safeBaseName = doc.filename.replace(/\.[^/.]+$/, '');

  if (req.query.download === 'true') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName}.json"`);
  }
  res.json(jsonData);
});

// ----------------------------------------------------------------------------
// 13. Available Samples List
// ----------------------------------------------------------------------------
router.get('/samples', (req, res) => {
  res.json({
    samples: [
      {
        id: 'medical_intake',
        name: 'Patient Medical Intake Form',
        description: 'Photo of handwritten clinical form with allergy checkboxes & prior surgery table.',
        filename: 'sample_medical_intake.png',
        type: 'image/png',
        difficulty: 'Medium (Angled phone photo, blue handwriting, checkboxes, table)'
      },
      {
        id: 'equipment_inspection',
        name: 'Equipment Safety Inspection Log',
        description: 'Industrial quality checklist with bounded item grid & multi-column status table.',
        filename: 'sample_equipment_inspection.png',
        type: 'image/png',
        difficulty: 'High (Structured table grid, numbers, handwritten notes)'
      },
      {
        id: 'tax_photocopy',
        name: 'W-2C Tax Declaration Form',
        description: 'Low-quality gritty photocopy with box borders, employer EIN, and monetary amounts.',
        filename: 'sample_tax_photocopy.png',
        type: 'image/png',
        difficulty: 'High (Photocopier noise, mono font, dark borders)'
      },
      {
        id: 'multipage_contract',
        name: 'Consulting Services Agreement (Multi-Page)',
        description: '2-page legal document with printed terms, signature lines, fee rates, and deliverables.',
        filename: 'sample_multipage_contract.pdf',
        type: 'application/pdf',
        difficulty: 'Medium (Multi-page PDF, varied headers, signature boxes)'
      },
      {
        id: 'accident_report',
        name: 'Accident & Incident Report Form',
        description: 'Dense grid-box compliance form with multi-section checkbox options, table matrices, and narrative statement.',
        filename: 'sample_accident_report.pdf',
        type: 'application/pdf',
        difficulty: 'High (Dense table boxes, option crosses, handwriting, multiline statement)'
      }
    ]
  });
});

// ----------------------------------------------------------------------------
// 14. Load and Process Sample Document in 1 Click
// ----------------------------------------------------------------------------
router.post('/load-sample/:sampleId', async (req, res) => {
  try {
    const { sampleId } = req.params;
    const sampleDir = SampleGenerator.getSamplesDir();
    let sampleFilename = '';

    switch (sampleId) {
      case 'medical_intake':
        sampleFilename = 'sample_medical_intake.png';
        break;
      case 'equipment_inspection':
        sampleFilename = 'sample_equipment_inspection.png';
        break;
      case 'tax_photocopy':
        sampleFilename = 'sample_tax_photocopy.png';
        break;
      case 'multipage_contract':
        sampleFilename = 'sample_multipage_contract.pdf';
        break;
      case 'accident_report':
        sampleFilename = 'sample_accident_report.pdf';
        break;
      default:
        return res.status(404).json({ error: `Sample ${sampleId} not found.` });
    }

    const sampleFilePath = path.join(sampleDir, sampleFilename);
    if (!fs.existsSync(sampleFilePath)) {
      await SampleGenerator.generateAllSamples();
    }

    const mimeType = sampleFilename.endsWith('.pdf') ? 'application/pdf' : 'image/png';
    const pages = await ImagePreprocessor.extractPages(sampleFilePath, mimeType);

    const docId = `doc_sample_${Date.now()}`;
    const doc = {
      id: docId,
      filename: sampleFilename,
      mimeType,
      originalPath: sampleFilePath,
      pageCount: pages.length,
      pages,
      fields: [],
      tables: [],
      summary: {},
      status: 'uploaded',
      uploadedAt: new Date().toISOString()
    };

    // Automatically analyze sample with built-in engine
    const analysis = await OcrEngine.analyzeDocument(pages, { provider: 'auto' });
    doc.fields = analysis.fields;
    doc.tables = analysis.tables;
    doc.summary = analysis.summary;
    doc.engineUsed = analysis.engineUsed;
    doc.status = analysis.status;
    doc.extractedAt = new Date().toISOString();

    saveDocumentState(doc);

    res.json({
      success: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
        status: doc.status,
        engineUsed: doc.engineUsed,
        summary: doc.summary,
        fields: doc.fields,
        tables: doc.tables,
        pages: doc.pages.map(p => ({
          pageNumber: p.pageNumber,
          width: p.width,
          height: p.height
        }))
      }
    });
  } catch (err) {
    console.error('Load sample error:', err);
    res.status(500).json({ error: `Failed to load sample: ${err.message}` });
  }
});

module.exports = router;
