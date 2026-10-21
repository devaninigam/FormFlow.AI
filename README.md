# FormFlow AI — Fully Dynamic Handwritten Document Converter

> **Production-ready, universal document understanding, verification editor, and original-layout PDF reconstruction application for React + Node.js.**

---

## 🌟 Key Features

1. **Universal Document Understanding (Zero Hardcoded Templates)**:
   - Does **not** rely on predefined forms or hardcoded field definitions (e.g. no fixed "Name", "Email", or "College").
   - Automatically detects printed labels, headings, checkboxes, tables, multiline text, dates, numbers, and unreadable areas for any arbitrary uploaded form or contract.

2. **Original-Layout PDF Reconstruction (Core Priority)**:
   - Preserves original page dimensions, printed graphics, logos, form lines, underlines, and table borders.
   - Cleans and masks handwritten ink without destroying printed lines or bounding cell borders.
   - Overlays verified typed text with font scaling, vertical baseline positioning, and multiline wrapping.
   - Provides an in-app visual PDF preview modal to compare before saving.

3. **Multi-Format Exports**:
   - **PDF**: Original-layout preserved background with clean typed text overlay.
   - **Word (`.docx`)**: Generated using `docx`, complete with styled headers, field tables, and detected tables.
   - **Excel (`.xlsx`)**: Generated using `exceljs` with sheets for "Extracted Fields", "Detected Tables", and "Document Summary".
   - **JSON (`.json`)**: Structured standardized output with field coordinates, confidence scores, and verification status.

4. **Multi-Tier OCR Architecture (Works 100% Offline by Default)**:
   - **Built-in Smart Local Engine**: Sharp + Tesseract.js + Computer Vision layout analysis. Operates offline with zero external credentials or API keys.
   - **Azure AI Document Intelligence Adapter**: Plug-and-play support for Azure `prebuilt-layout` / `prebuilt-document`.
   - **Vision LLM Interpretation Layer**: Optional support for Google Gemini 1.5/2.0 Vision and OpenAI GPT-4o Vision for complex, unconstrained handwriting.

5. **Interactive Document Canvas**:
   - 2D panning, zoom controls (50% - 300%), 90° page rotation.
   - Color-coded bounding box overlays (Green = High Confidence, Amber = Needs Review, Red = Low Confidence).
   - Bi-directional selection: clicking a bounding box scrolls to and highlights the field card; selecting a field highlights the bounding box on the canvas.
   - Custom Field Drawing Tool: draw new bounding boxes directly on the document canvas.

---

## 📁 File Structure

```text
FormFlow AI/
├── server.js                          # Starts Express server & registers /api/document-convert router
├── routes/
│   └── documentConvert.js             # Uploads, OCR, layout analysis, verification & export routes
├── services/
│   ├── imagePreprocessor.js          # Multi-page PDF/image rasterization & line-preserving ink cleanup
│   ├── ocrEngine.js                  # Pluggable OCR engine (Built-in, Azure, Gemini, OpenAI)
│   ├── pdfReconstructor.js           # PDF reconstruction with stroke inpainting & typed text overlay
│   ├── wordExporter.js               # Word (.docx) export generation
│   ├── excelExporter.js              # Excel (.xlsx) export generation
│   ├── jsonExporter.js               # JSON export formatting
│   └── sampleGenerator.js            # Generator for diverse testing scenarios
├── src/
│   ├── DocumentConverter.jsx         # Complete standalone React single-page interface
│   ├── index.css                     # Obsidian dark glassmorphic design system
│   └── main.jsx                      # React 18 client entry point
├── storage/
│   ├── samples/                      # Diverse real test documents (medical, inspection, tax, multi-page)
│   ├── uploads/                      # Temporary document uploads
│   └── processed/                    # Processed pages and metadata
├── index.html                        # Web entry point
├── vite.config.js                    # Vite configuration with /api proxy
├── package.json                      # Unified scripts and dependencies
└── .env.example                      # Configuration and OCR credentials template
```

---

## 🚀 Quick Start & Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment (Optional)

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

| Environment Variable | Description | Cost / Tier |
|---|---|---|
| `PORT` | Server port (default: `5000`) | N/A |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Azure Form Recognizer subscription key | Free tier (500 pages/mo) or S0 ($1.50 / 1k pages) |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Azure Document Intelligence endpoint URL | Included with Azure resource |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key | Free tier available / Pay-as-you-go |
| `OPENAI_API_KEY` | OpenAI API Key for GPT-4o Vision | Pay-as-you-go |

> **Note:** If no external keys are configured, FormFlow AI runs seamlessly using its **Built-in Smart Local Engine**.

### 3. Run Development Server

To run both the backend Express API and the Vite frontend:

```bash
npm run dev
```

Or run the production server (serves both API and built React client on port 5000):

```bash
npm run build
npm start
```

Access the application in your browser at: **`http://localhost:5000`** (or `http://localhost:5173` during Vite dev).

---

## 📡 Backend API Endpoints

All endpoints are registered under `/api/document-convert`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/status` | Returns system status & configured OCR providers |
| `POST` | `/upload` | Upload document (`multipart/form-data`, file field: `document`) |
| `POST` | `/analyze/:id` | Run layout analysis & handwriting extraction (`provider: 'auto' \| 'builtin' \| 'azure' \| 'gemini' \| 'openai'`) |
| `GET` | `/document/:id` | Retrieve document details, fields, tables, and verification summary |
| `GET` | `/page/:id/:pageNumber` | Retrieve high-resolution page PNG image |
| `PUT` | `/document/:id/fields` | Save corrected fields, labels, and verification flags |
| `PUT` | `/document/:id/cleanup-regions` | Save custom cleanup bounding regions |
| `POST` | `/export/pdf/:id` | Download reconstructed PDF with typed text overlay |
| `GET` | `/preview/pdf/:id` | Generate and preview reconstructed PDF in browser |
| `POST` | `/export/word/:id` | Download structured Word `.docx` file |
| `POST` | `/export/excel/:id` | Download structured Excel `.xlsx` workbook |
| `GET` | `/export/json/:id` | Export structured JSON (`?download=true` for file download) |
| `GET` | `/samples` | List available diverse real test samples |
| `POST` | `/load-sample/:sampleId` | 1-click test of diverse real samples (`medical_intake`, `equipment_inspection`, `tax_photocopy`, `multipage_contract`) |

---

## 🧪 Testing with Real Diverse Documents

FormFlow AI comes with 4 diverse real test documents pre-generated:

1. **`medical_intake`**:
   - Angled mobile photograph of a clinical intake form.
   - Blue ballpoint handwriting across lines and boxes.
   - Checkboxes for known allergies (`[X] Penicillin`, `[ ] Sulfa`, `[X] Latex`).
   - Prior surgery history table with columns (Condition, Year, Doctor, Status).
2. **`equipment_inspection`**:
   - Machinery quality checklist with box grids.
   - Form table with 5 columns (Item #, Component, Status, Measurement, Action).
   - Handwritten measurements, checkmarks, and signoff remarks.
3. **`tax_photocopy`**:
   - Low-quality gritty photocopy with speckled noise and mono font.
   - Taxpayer identification, EIN, amended wage numbers, monetary amounts.
4. **`multipage_contract`**:
   - 2-page legal consulting agreement in PDF format.
   - Varied page layouts, deliverable milestones, and signature authorization boxes.

Click any sample button in the top bar to test immediately with 1 click.

# FormFlow.AI
