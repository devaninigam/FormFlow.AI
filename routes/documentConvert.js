const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const ImagePreprocessor = require('../services/imagePreprocessor');
const OcrEngine = require('../services/ocrEngine');
const PdfReconstructor = require('../services/pdfReconstructor');
const WordExporter = require('../services/wordExporter');
const ExcelExporter = require('../services/excelExporter');
const JsonExporter = require('../services/jsonExporter');
const SampleGenerator = require('../services/sampleGenerator');
const AccidentReportPdfGenerator = require('../services/accidentReportPdfGenerator');

/**
 * Early Years Accident is the main FormFlow document format.
 * Values are filled by label targeting from the upload; layout uses the classic EY form.
 */
function isEarlyYearsAccidentDoc(doc) {
  if (!doc) return false;
  if (doc.formLayout === 'early_years_accident') return true;
  if (doc.documentType === 'early_years_accident') return true;
  if (doc.formLayout === 'dynamic') return false;
  const labels = (doc.fields || []).map(f => f.label || '').join(' ');
  const hasEyTitle = /accident\s*&\s*incident/i.test(labels);
  const hasEySpecific = /riddor|toybox|surestart/i.test(labels);
  return hasEyTitle && hasEySpecific;
}

function isAccidentDoc(doc) {
  return isEarlyYearsAccidentDoc(doc);
}

// Legacy runtime directories — automatically purged on startup; never persisted to.
const UPLOADS_DIR = path.join(__dirname, '..', 'storage', 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', 'storage', 'processed');

function purgeDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dirPath)) {
    if (entry === '.gitkeep') continue;
    const fullPath = path.join(dirPath, entry);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed++;
    } catch (err) {
      console.warn(`Could not remove stale file ${fullPath}:`, err.message);
    }
  }
  return removed;
}

// Purge any historical uploaded images or processed JSON artifacts from disk immediately
[UPLOADS_DIR, PROCESSED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const count = purgeDirectoryContents(dir);
  if (count > 0) {
    console.log(`[Security Cleanup] Purged ${count} old file(s) from ${path.basename(dir)}/`);
  }
});

// Zero-disk-storage Multer: hold uploaded file in memory only during active processing
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    const isImageOrPdf =
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('image/') ||
      /\.(pdf|png|jpe?g|webp|tiff?|bmp|jfif|gif|heic|heif)$/i.test(file.originalname);

    if (isImageOrPdf) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload an image (JPG, PNG, WEBP, TIFF, BMP) or PDF document.'));
    }
  }
});

// Strictly ephemeral in-memory session cache (never written to disk locally or in production)
const documentsMap = new Map();

const ENV_FILE_PATH = path.join(__dirname, '..', '.env');
let lastEnvMtimeMs = 0;
let managedEnvKeys = new Set();

try {
  if (fs.existsSync(ENV_FILE_PATH)) {
    const stat = fs.statSync(ENV_FILE_PATH);
    lastEnvMtimeMs = stat.mtimeMs;
    const parsed = dotenv.parse(fs.readFileSync(ENV_FILE_PATH));
    managedEnvKeys = new Set(Object.keys(parsed));
  }
} catch (_) { /* ignore */ }

/**
 * Hot-reload .env changes if .env is edited at runtime without requiring server restart
 */
function syncEnvFromFile() {
  try {
    if (!fs.existsSync(ENV_FILE_PATH)) return;
    const stat = fs.statSync(ENV_FILE_PATH);
    if (stat.mtimeMs === lastEnvMtimeMs) return;
    lastEnvMtimeMs = stat.mtimeMs;
    const parsed = dotenv.parse(fs.readFileSync(ENV_FILE_PATH));
    for (const oldKey of managedEnvKeys) {
      if (!(oldKey in parsed)) {
        delete process.env[oldKey];
      }
    }
    for (const [k, v] of Object.entries(parsed)) {
      process.env[k] = v;
    }
    managedEnvKeys = new Set(Object.keys(parsed));
  } catch (err) {
    console.warn('Could not reload .env:', err.message);
  }
}

function getDocumentTtlMs() {
  const mins = Math.max(1, parseInt(process.env.DOCUMENT_TTL_MINUTES || '15', 10) || 15);
  return mins * 60 * 1000;
}

function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

/**
 * Update ephemeral in-memory document session (zero disk persistence)
 */
function saveDocumentState(doc) {
  if (!doc || !doc.id) return;
  doc.lastAccessedAt = Date.now();
  documentsMap.set(doc.id, doc);
}

/**
 * Permanently wipe a document and its image buffers from memory
 */
function purgeDocument(id) {
  if (!id) return false;
  const doc = documentsMap.get(id);
  let existed = false;
  if (doc) {
    existed = true;
    for (const p of doc.pages || []) {
      if (Buffer.isBuffer(p.buffer)) {
        p.buffer.fill(0);
      }
      p.buffer = null;
      if (Buffer.isBuffer(p.pageBuffer)) {
        p.pageBuffer.fill(0);
      }
      p.pageBuffer = null;
      p.textItems = null;
      p.fullText = null;
    }
    doc.pages = [];
    doc.fields = [];
    doc.tables = [];
    documentsMap.delete(id);
  }
  const staleMeta = path.join(PROCESSED_DIR, `${id}.json`);
  if (fs.existsSync(staleMeta)) {
    try { fs.unlinkSync(staleMeta); existed = true; } catch (_) { /* ignore */ }
  }
  return existed;
}

// Auto-expire inactive in-memory sessions every 2 minutes (.unref() keeps CLI/test exit clean)
setInterval(() => {
  syncEnvFromFile();
  const cutoff = Date.now() - getDocumentTtlMs();
  for (const [id, doc] of documentsMap.entries()) {
    if ((doc.lastAccessedAt || 0) < cutoff) {
      purgeDocument(id);
    }
  }
}, 2 * 60 * 1000).unref();

/**
 * Helper to get ephemeral document from memory or return 404
 */
async function getDocumentOr404(id, res) {
  const doc = documentsMap.get(id);
  if (!doc) {
    res.status(404).json({ error: `Document session ${id} expired or was removed. Please re-upload.` });
    return null;
  }
  doc.lastAccessedAt = Date.now();
  return doc;
}

// ----------------------------------------------------------------------------
// 1. Check System Providers Status
// ----------------------------------------------------------------------------
router.get('/status', (req, res) => {
  syncEnvFromFile();
  setNoStoreHeaders(res);

  const hasAws = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasAzure = !!(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY && process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT);
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenai = !!process.env.OPENAI_API_KEY;

  const activeProvider = hasAws
    ? 'aws'
    : hasAzure
      ? 'azure'
      : hasGemini
        ? 'gemini'
        : hasOpenai
          ? 'openai'
          : 'builtin';

  const providers = {
    aws: {
      available: hasAws,
      configured: hasAws,
      activeInAuto: activeProvider === 'aws',
      priority: 1,
      type: 'Cloud ML OCR',
      region: hasAws ? (process.env.AWS_REGION || 'us-east-1') : null,
      envKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
      name: 'AWS Textract (Forms, Tables & Handwriting)'
    },
    azure: {
      available: hasAzure,
      configured: hasAzure,
      activeInAuto: activeProvider === 'azure',
      priority: 2,
      type: 'Cloud ML OCR',
      envKeys: ['AZURE_DOCUMENT_INTELLIGENCE_KEY', 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT'],
      name: 'Azure AI Document Intelligence'
    },
    gemini: {
      available: hasGemini,
      configured: hasGemini,
      activeInAuto: activeProvider === 'gemini',
      priority: 3,
      type: 'Cloud Vision LLM',
      envKeys: ['GEMINI_API_KEY'],
      name: 'Google Gemini 1.5 / 2.0 Vision LLM'
    },
    openai: {
      available: hasOpenai,
      configured: hasOpenai,
      activeInAuto: activeProvider === 'openai',
      priority: 4,
      type: 'Cloud Vision LLM',
      envKeys: ['OPENAI_API_KEY'],
      name: 'OpenAI GPT-4o Vision'
    },
    builtin: {
      available: true,
      configured: true,
      readyWithoutKey: true,
      activeInAuto: activeProvider === 'builtin',
      priority: 5,
      type: 'Local Offline OCR',
      envKeys: [],
      name: 'FormFlow Smart Local Engine (Sharp + Tesseract + CV)'
    }
  };

  res.json({
    status: 'online',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    activeProvider,
    activeEngineName: providers[activeProvider].name,
    security: {
      storageMode: 'ephemeral_memory_only',
      diskUploadStorage: false,
      diskProcessedStorage: false,
      documentTtlMinutes: Math.round(getDocumentTtlMs() / 60000),
      activeSessionsCount: documentsMap.size
    },
    providers
  });
});

// ----------------------------------------------------------------------------
// 2. Upload Document (Memory-Only — Zero Disk Retention)
// ----------------------------------------------------------------------------
router.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No document file uploaded.' });
    }

    if (req.body?.previousDocId) {
      purgeDocument(req.body.previousDocId);
    }

    const docId = `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const mimeType = req.file.mimetype;

    // Extract pages purely from in-memory Buffer — never write user file to disk
    const pages = await ImagePreprocessor.extractPages(req.file.buffer, mimeType);
    req.file.buffer.fill(0);
    req.file.buffer = null;

    const doc = {
      id: docId,
      filename: req.file.originalname,
      mimeType,
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
    setNoStoreHeaders(res);

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
    syncEnvFromFile();
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

    const {
      provider = 'auto',
      secondaryAiLayer = false,
      apiKey = null,
      geminiKey = null,
      openaiKey = null,
      azureKey = null,
      azureEndpoint = null,
      awsAccessKey = null,
      awsSecretKey = null,
      awsRegion = null
    } = req.body || {};

    const analysisResult = await OcrEngine.analyzeDocument(doc.pages, {
      provider,
      secondaryAiLayer,
      apiKey,
      geminiKey,
      openaiKey,
      azureKey,
      azureEndpoint,
      awsAccessKey,
      awsSecretKey,
      awsRegion
    });

    // Update document record
    doc.fields = analysisResult.fields || [];
    doc.tables = analysisResult.tables || [];
    doc.summary = analysisResult.summary || {};
    doc.engineUsed = analysisResult.engineUsed;
    doc.formLayout = analysisResult.formLayout || analysisResult.summary?.formLayout || 'dynamic';
    doc.status = analysisResult.status || 'analyzed';
    doc.extractedAt = new Date().toISOString();

    // Persist OCR fullText onto pages when engine provides it
    if (analysisResult.pages && doc.pages) {
      for (const rp of analysisResult.pages) {
        const target = doc.pages.find(p => p.pageNumber === rp.pageNumber);
        if (target && rp.fullText) target.fullText = rp.fullText;
      }
    }

    saveDocumentState(doc);
    setNoStoreHeaders(res);

    res.json({
      success: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
        status: doc.status,
        engineUsed: doc.engineUsed,
        formLayout: doc.formLayout,
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

  setNoStoreHeaders(res);
  res.json({
    document: {
      id: doc.id,
      filename: doc.filename,
      pageCount: doc.pageCount,
      status: doc.status,
      engineUsed: doc.engineUsed,
      formLayout: doc.formLayout || 'dynamic',
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
// 4b. Immediate Session Removal (Delete Uploaded Image & Extracted Data)
// ----------------------------------------------------------------------------
router.delete('/document/:id', (req, res) => {
  const purged = purgeDocument(req.params.id);
  setNoStoreHeaders(res);
  res.json({ success: true, purged });
});

router.post('/document/:id/purge', (req, res) => {
  const purged = purgeDocument(req.params.id);
  setNoStoreHeaders(res);
  res.json({ success: true, purged });
});

// ----------------------------------------------------------------------------
// 5. Get Page Image (Ephemeral, Never Cached)
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
  setNoStoreHeaders(res);
  res.send(page.buffer);
});

// ----------------------------------------------------------------------------
// 5b. Get Reconstructed Page Image (Digital Text Overlaid on Cleaned Page)
// ----------------------------------------------------------------------------
router.get('/reconstructed-page/:id/:pageNumber', async (req, res) => {
  try {
    const doc = await getDocumentOr404(req.params.id, res);
    if (!doc) return;

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

    const pageNum = parseInt(req.params.pageNumber, 10) || 1;
    const page = doc.pages.find(p => p.pageNumber === pageNum) || doc.pages[0];

    if (!page || !page.buffer) {
      return res.status(404).json({ error: `Page ${pageNum} not available` });
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
    setNoStoreHeaders(res);
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

    setNoStoreHeaders(res);
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

    setNoStoreHeaders(res);
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

    setNoStoreHeaders(res);
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

    setNoStoreHeaders(res);
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

  setNoStoreHeaders(res);
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
    setNoStoreHeaders(res);

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
