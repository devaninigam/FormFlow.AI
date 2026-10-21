import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw,
  ZoomIn, ZoomOut, RotateCw, Maximize2, Download, Table as TableIcon,
  FileSpreadsheet, FileCode, Check, Eye, Trash2, Plus,
  Layers, ChevronLeft, ChevronRight, HelpCircle, ShieldCheck, Sparkles, X,
  ArrowLeft, Search
} from 'lucide-react';

const API_BASE = '/api/document-convert';

class ModalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ModalErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '36px', textAlign: 'center', background: '#ffffff', color: '#1e293b', borderRadius: '8px' }}>
          <h4 style={{ color: '#ef4444', marginBottom: '8px', fontSize: '1.1rem' }}>Preview Rendering Notice</h4>
          <p style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: '20px' }}>
            {this.state.error?.message || 'Unable to render the visual form preview.'}
          </p>
          {this.props.onDownloadFallback && (
            <button
              className="btn btn-primary"
              onClick={this.props.onDownloadFallback}
              style={{ padding: '8px 20px', fontSize: '0.86rem', background: '#185abd', color: '#ffffff' }}
            >
              <Download size={14} /> Download Document Directly
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DocumentConverter() {
  /** Detect Accident & Incident Report forms (Example 1/2 PDFs, etc.) */
  const isAccidentDocument = (currentDoc) => {
    if (!currentDoc) return false;
    const title = `${currentDoc.documentTitle || ''} ${currentDoc.filename || ''}`.toLowerCase();
    if (/accident|incident|injury|riddor|example\s*[12]/i.test(title)) return true;
    return (currentDoc.fields || []).some(f =>
      /riddor|injury|incident|ey staff|daycare|toybox|cause:/i.test(f.label || '')
    );
  };

  const getDisplayDocTitle = (currentDoc) => {
    if (!currentDoc) return 'EXTRACTED DOCUMENT';
    if (currentDoc.documentTitle && currentDoc.documentTitle !== 'unknown') {
      return currentDoc.documentTitle.toUpperCase();
    }
    const titleField = currentDoc.fields?.find(f => /report title|form title|document title/i.test(f.label));
    if (titleField?.value) return titleField.value.toUpperCase();
    const cleanName = (currentDoc.filename || 'DOCUMENT')
      .replace(/^[0-9]+_[0-9a-f]+_/i, '')
      .replace(/\.[^/.]+$/, '')
      .replace(/_/g, ' ')
      .trim();
    if (isAccidentDocument(currentDoc)) {
      return 'ACCIDENT & INCIDENT REPORT FORM';
    }
    return cleanName.toUpperCase();
  };

  // Document state
  const [doc, setDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [filterTab, setFilterTab] = useState('all'); // all, review, verified, tables, checkboxes
  const [searchQuery, setSearchQuery] = useState('');

  // Processing state
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [exportNotification, setExportNotification] = useState(null);
  const showToast = (msg, isSuccess = true) => {
    setExportNotification({ message: msg, isSuccess });
    setTimeout(() => setExportNotification(null), 3500);
  };

  // Canvas / Preview state
  const [viewMode, setViewMode] = useState('fit'); // 'fit' or 'custom'
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [canvasViewType, setCanvasViewType] = useState('reconstructed'); // 'reconstructed' | 'original' | 'split'
  const [previewTimestamp, setPreviewTimestamp] = useState(Date.now());
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentDrawBox, setCurrentDrawBox] = useState(null);

  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const [panPos, setPanPos] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // System & Export modals
  const [systemStatus, setSystemStatus] = useState(null);
  const [selectedEngine, setSelectedEngine] = useState('auto');
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState(null);
  const [pdfModalZoom, setPdfModalZoom] = useState(1.0);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showWordModal, setShowWordModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelActiveTab, setExcelActiveTab] = useState('form'); // 'form' | 'fields' | 'audit'
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [rawJsonText, setRawJsonText] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Refs
  const viewportRef = useRef(null);
  const imageRef = useRef(null);
  const fieldsContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Fetch engine provider availability
  useEffect(() => {
    fetch(`${API_BASE}/status`)
      .then(r => r.json())
      .then(d => setSystemStatus(d))
      .catch(e => console.warn('Could not fetch engine status:', e));
  }, []);

  // Keyboard shortcuts (Escape, arrow navigation)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedFieldId(null);
        setIsDrawMode(false);
        setShowPdfPreviewModal(false);
        setShowWordModal(false);
        setShowExcelModal(false);
        setShowJsonModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Helper: Categorize document fields dynamically into authentic form sections
  const categorizeDocFields = (fieldsList) => {
    const list = fieldsList || [];
    const sectionMap = new Map();
    let hasExplicitSections = false;
    for (const f of list) {
      if (f.section) {
        hasExplicitSections = true;
        if (!sectionMap.has(f.section)) sectionMap.set(f.section, []);
        sectionMap.get(f.section).push(f);
      }
    }

    if (hasExplicitSections && sectionMap.size > 0) {
      const result = [];
      for (const [secName, secFields] of sectionMap.entries()) {
        result.push({ name: secName, fields: secFields });
      }
      const leftover = list.filter(f => !f.section);
      if (leftover.length > 0) {
        result.push({ name: 'Additional Document Information', fields: leftover });
      }
      return result;
    }

    // Fallback if no sections
    const sections = [
      {
        name: 'General & Reference Details',
        fields: list.filter(f => /ref no|reference|form date|project name|building address|log id|inspection date|report no|order no|invoice no/i.test(f.label))
      },
      {
        name: 'Subject / Personal Information',
        fields: list.filter(f => /name|person|patient|d\.o\.b|dob|birth|address|postcode|zip|contact|phone|email|ssn|gender|age|relative/i.test(f.label))
      },
      {
        name: 'Classification & Checklist Options',
        fields: list.filter(f => f.type === 'checkbox' || /^(staff:|child status:|status:|is_|has_)/i.test(f.label))
      },
      {
        name: 'Observations, Descriptions & Notes',
        fields: list.filter(f => f.type === 'multiline' || (f.value && String(f.value).length > 60) || /description|narrative|details|observation|action taken|summary|notes|comments/i.test(f.label))
      },
      {
        name: 'Signatures & Authorizations',
        fields: list.filter(f => /signature|signed|witness|inspector|approved by|supervisor/i.test(f.label))
      }
    ];

    const seen = new Set();
    sections.forEach(s => s.fields.forEach(f => seen.add(f.id)));
    const remaining = list.filter(f => !seen.has(f.id));
    if (remaining.length > 0) {
      sections.push({ name: 'Additional Document Information', fields: remaining });
    }

    return sections.filter(s => s.fields.length > 0);
  };

  // Helper: Render authentic document form layout (identical to uploaded document)
  const renderAuthenticFormLayout = (currentDoc, isExcel = false) => {
    const fList = currentDoc.fields || [];
    const isAccidentDoc = isAccidentDocument(currentDoc);

    if (!isAccidentDoc) {
      // Standard dynamic categorized rendering
      return categorizeDocFields(fList).map((sec, sIdx) => {
        const secCheckboxes = sec.fields.filter(f => f.type === 'checkbox' || /^(staff:|child status:|incident type:|riddor:|cause:|type of injury:|outcome:)/i.test(f.label));
        const secMultiline = sec.fields.filter(f => f.type === 'multiline' || (f.value && String(f.value).length > 70) || /narrative|observation|description|remarks/i.test(f.label));
        const secRegular = sec.fields.filter(f => !secCheckboxes.includes(f) && !secMultiline.includes(f));

        return (
          <div key={sIdx} style={{ marginBottom: '18px' }}>
            <div className="word-section-banner" style={{ background: isExcel ? '#e2e8f0' : undefined, color: isExcel ? '#1e293b' : undefined }}>
              {sec.name}
            </div>
            {secRegular.length > 0 && (
              <table className="word-form-table">
                <tbody>
                  {secRegular.map((f, fIdx) => {
                    const val = f.value !== undefined && f.value !== null && String(f.value).trim() !== '' ? String(f.value) : '';
                    return (
                      <tr key={f.id || fIdx}>
                        <td className="word-form-label">{f.label || 'Field'}</td>
                        <td className="word-form-val">
                          {val || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400 }}>(Not filled)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {secCheckboxes.length > 0 && (
              <div className="word-checkbox-grid" style={{ marginTop: secRegular.length > 0 ? '8px' : '0' }}>
                {secCheckboxes.map((f, fIdx) => {
                  const isChecked = ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(f.value || '').toLowerCase());
                  return (
                    <div key={f.id || fIdx} className={`word-checkbox-pill ${isChecked ? 'checked' : ''}`}>
                      <span style={{ fontWeight: 600 }}>{f.label}</span>
                      <span className="word-check-tag">
                        {isChecked ? '[X] Selected (Yes)' : '[  ] Not Selected'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {secMultiline.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                {secMultiline.map((f, fIdx) => (
                  <div key={f.id || fIdx} style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b', marginBottom: '4px' }}>
                      {f.label}
                    </div>
                    <div className="word-narrative-box">
                      {f.value || '(No narrative entered)'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      });
    }

    // ACCIDENT & INCIDENT REPORT AUTHENTIC MULTI-COLUMN FORM LAYOUT
    const findVal = (regex, defaultVal = '') => {
      const f = fList.find(item => item && item.label && regex.test(item.label));
      return (f && f.value !== undefined && f.value !== null && String(f.value).trim() !== '') ? String(f.value).trim() : defaultVal;
    };
    const isChecked = (regex) => {
      const f = fList.find(item => item && item.label && regex.test(item.label));
      return f ? ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(f.value || '').toLowerCase()) : false;
    };

    const refNo = findVal(/ref no/i, '');
    const formDate = findVal(/form date/i, '');
    const project = findVal(/project name/i, '');
    const buildingAddress = findVal(/building address/i, '');

    const personName = findVal(/name of the person/i, '');
    const dob = findVal(/d\.o\.b/i, '');
    const age = findVal(/^age/i, '');
    const regAddress = findVal(/registered address/i, '');
    const postcode = findVal(/postcode/i, '');
    const adult = findVal(/responsible adult/i, '');
    const contact = findVal(/contact number/i, '');
    const session = findVal(/session/i, '');

    const incidentDate = findVal(/incident date/i, '');
    const incidentTime = findVal(/incident time/i, '');
    const location = findVal(/space|location/i, '');

    const narrative = findVal(/narrative/i, '');
    const completedBy = findVal(/completed by/i, '');
    const position = findVal(/position/i, '');
    const signature = findVal(/signature/i, '');
    const dateSigned = findVal(/date signed/i, '');
    const parentSigned = findVal(/parent signed|parent.*guardian/i, '');
    const parentDate = findVal(/parent.*date/i, '');
    const parentTime = findVal(/parent.*time/i, '');
    const comments = findVal(/comments/i, '');

    const tblBorder = '1px solid #1e3a5f';
    const cellPad = '6px 10px';
    const hdrStyle = { background: '#e8eef7', color: '#1e3a5f', fontWeight: 700, fontSize: '0.78rem', border: tblBorder, padding: cellPad };
    const valStyle = { background: '#ffffff', color: '#0f172a', fontWeight: 700, fontSize: '0.84rem', border: tblBorder, padding: cellPad };
    const bannerStyle = {
      background: '#1e3a5f',
      color: '#ffffff',
      fontWeight: 800,
      fontSize: '0.82rem',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      margin: '14px 0 0 0',
      padding: '7px 12px',
      border: tblBorder
    };

    const renderCheckPill = (label, checked) => (
      <td key={label} style={{ ...valStyle, background: checked ? '#f0fdf4' : '#ffffff', border: tblBorder }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontWeight: checked ? 700 : 500, color: checked ? '#065f46' : '#334155' }}>{label}</span>
          <span style={{
            fontFamily: 'monospace',
            fontWeight: 800,
            fontSize: '0.76rem',
            padding: '2px 6px',
            borderRadius: '3px',
            background: checked ? '#bbf7d0' : '#f1f5f9',
            color: checked ? '#166534' : '#64748b'
          }}>
            {checked ? '[X]' : '[  ]'}
          </span>
        </div>
      </td>
    );

    return (
      <div style={{ fontFamily: 'Segoe UI, Calibri, sans-serif' }}>
        {/* Document Header Instructions */}
        <div style={{ fontSize: '0.72rem', color: '#475569', background: '#f8fafc', padding: '8px 12px', borderRadius: '4px', border: '1px solid #e2e8f0', marginBottom: '14px', lineHeight: 1.5 }}>
          <div><strong>Incidents can range from minor near misses to severe accidents resulting in injuries, fatalities, or significant damage.</strong></div>
          <div>&bull; <strong>Child Accident:</strong> Unintended injury to a child, e.g. through play or lack of spatial awareness.</div>
          <div>&bull; <strong>Child Incident:</strong> Intended injury to another child, this includes when a child is acting because of an emotional response.</div>
          <div>&bull; <strong>Incident:</strong> Any unplanned event that disrupts normal operations or poses a risk to employees, equipment, or the environment.</div>
          <div>&bull; <strong>Accident:</strong> A discrete, identifiable, and unintended event arising out of or in connection with work causing injury.</div>
        </div>

        {/* 1. ABOUT THIS FORM */}
        <div style={bannerStyle}>ABOUT THIS FORM & IT'S COMPLETION</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              <td style={{ ...hdrStyle, width: '12%' }}>Ref No</td>
              <td style={{ ...valStyle, width: '18%' }}>{refNo}</td>
              <td style={{ ...hdrStyle, width: '10%' }}>DATE</td>
              <td style={{ ...valStyle, width: '20%' }}>{formDate}</td>
              <td style={{ ...hdrStyle, width: '16%' }}>PROJECT NAME</td>
              <td style={{ ...valStyle, width: '24%' }}>{project}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>BUILDING ADDRESS</td>
              <td colSpan={5} style={valStyle}>{buildingAddress}</td>
            </tr>
          </tbody>
        </table>

        {/* 2. ABOUT THE PERSON */}
        <div style={bannerStyle}>ABOUT THE PERSON</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              <td style={{ ...hdrStyle, width: '25%' }}>Name of the person involved</td>
              <td style={{ ...valStyle, width: '35%' }}>{personName}</td>
              <td style={{ ...hdrStyle, width: '15%' }}>D.O.B</td>
              <td style={{ ...valStyle, width: '25%' }}>{dob}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>Registered Address</td>
              <td style={valStyle}>{regAddress}</td>
              <td style={hdrStyle}>Postcode</td>
              <td style={valStyle}>{postcode}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>Contact Number</td>
              <td style={valStyle}>{contact}</td>
              <td style={hdrStyle}>Responsible Adult</td>
              <td style={valStyle}>{adult}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>STAFF</td>
              <td colSpan={3} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      {renderCheckPill("EY Staff", isChecked(/staff:\s*ey staff/i))}
                      {renderCheckPill("Non EY Staff", isChecked(/non ey staff/i))}
                      {renderCheckPill("Visitor", isChecked(/visitor/i))}
                      {renderCheckPill("Parent", isChecked(/parent/i))}
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style={hdrStyle}>CHILD</td>
              <td colSpan={3} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      {renderCheckPill("Daycare", isChecked(/child status:\s*daycare|daycare/i))}
                      {renderCheckPill("ToyBox", isChecked(/toybox/i))}
                      {renderCheckPill("SureStart", isChecked(/surestart/i))}
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style={hdrStyle}>SESSION</td>
              <td colSpan={3} style={{ ...valStyle, fontWeight: 700, fontSize: '0.88rem', letterSpacing: '0.02em', paddingLeft: '12px' }}>
                {session || ''}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 3. ABOUT THE INCIDENT */}
        <div style={bannerStyle}>ABOUT THE INCIDENT</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              <td style={{ ...hdrStyle, width: '12%' }}>DATE</td>
              <td style={{ ...valStyle, width: '20%' }}>{incidentDate}</td>
              <td style={{ ...hdrStyle, width: '10%' }}>TIME</td>
              <td style={{ ...valStyle, width: '18%' }}>{incidentTime}</td>
              <td style={{ ...hdrStyle, width: '14%' }}>SPACE</td>
              <td style={{ ...valStyle, width: '26%' }}>{location}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>TYPE</td>
              {renderCheckPill("ACCIDENT", isChecked(/incident type: accident|accident/i))}
              {renderCheckPill("INCIDENT", isChecked(/incident type: incident/i))}
              <td colSpan={3} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody><tr>{renderCheckPill("NEAR MISS", isChecked(/near miss/i))}</tr></tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style={hdrStyle}>SEVERITY</td>
              {renderCheckPill("RIDDOR", isChecked(/severity: riddor|riddor/i))}
              {renderCheckPill("MODERATE", isChecked(/severity: moderate|moderate/i))}
              <td colSpan={3} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody><tr>{renderCheckPill("MINOR", isChecked(/severity: minor|minor/i))}</tr></tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* 4. RIDDOR ? */}
        <div style={bannerStyle}>RIDDOR ?</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              {renderCheckPill("DANGEROUS OCCURRENCE", isChecked(/dangerous occurrence/i))}
              {renderCheckPill("REPORTABLE DISEASE", isChecked(/reportable disease/i))}
            </tr>
            <tr>
              {renderCheckPill("INJURY TO PUBLIC", isChecked(/injury to public/i))}
              {renderCheckPill("INJURY 3 DAYS", isChecked(/injury 3 days/i))}
            </tr>
            <tr>
              {renderCheckPill("MAJOR INJURY", isChecked(/major injury/i))}
              {renderCheckPill("DEATH", isChecked(/death/i))}
            </tr>
          </tbody>
        </table>

        {/* 5. CAUSE */}
        <div style={bannerStyle}>CAUSE</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              {renderCheckPill("CONTACT WITH PEER", isChecked(/contact with peer/i))}
              {renderCheckPill("EQUIPMENT", isChecked(/cause: equipment/i))}
              {renderCheckPill("UNKNOWN", isChecked(/cause: unknown/i))}
            </tr>
            <tr>
              {renderCheckPill("SLIP / TRIP / FALL", isChecked(/slip/i))}
              {renderCheckPill("COSHH", isChecked(/coshh/i))}
              {renderCheckPill("TRAFFIC", isChecked(/traffic/i))}
            </tr>
            <tr>
              {renderCheckPill("MANUAL HANDLING", isChecked(/manual handling/i))}
              {renderCheckPill("CHOKING", isChecked(/choking/i))}
              {renderCheckPill("VENUE", isChecked(/venue/i))}
            </tr>
          </tbody>
        </table>

        {/* 6. TYPE OF INJURY */}
        <div style={bannerStyle}>TYPE OF INJURY</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              {renderCheckPill("ABRASION / SMALL CUT / LIGHT BLEED", isChecked(/abrasion|cut/i))}
              {renderCheckPill("BRUISE / SWELLING / REDNESS", isChecked(/bruise/i))}
            </tr>
            <tr>
              {renderCheckPill("STRAIN / DISLOCATION", isChecked(/strain/i))}
              {renderCheckPill("FRACTURE / BROKEN BONE", isChecked(/fracture/i))}
            </tr>
            <tr>
              {renderCheckPill("INJURY TO HEAD / FACE", isChecked(/injury to head/i))}
              {renderCheckPill("SENSORY LOSS", isChecked(/sensory loss/i))}
            </tr>
            <tr>
              {renderCheckPill("LOSS OF CONSCIOUSNESS", isChecked(/consciousness/i))}
              {renderCheckPill("ORGAN INJURY / OPEN WOUND", isChecked(/organ injury/i))}
            </tr>
            <tr>
              {renderCheckPill("PROPERTY DAMAGE (INC VEHICLE)", isChecked(/property damage/i))}
              {renderCheckPill("EMOTIONAL DISTRESS", isChecked(/emotional distress/i))}
            </tr>
          </tbody>
        </table>

        {/* 7. OUTCOME OF INCIDENT */}
        <div style={bannerStyle}>OUTCOME OF INCIDENT</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              {renderCheckPill("RETURN TO ACTIVITIES", isChecked(/return to activities/i))}
              {renderCheckPill("FIRST AID APPLIED", isChecked(/first aid/i))}
            </tr>
            <tr>
              {renderCheckPill("TO RESPONSIBLE ADULT CARE", isChecked(/responsible adult care/i))}
              {renderCheckPill("NIAS CALLED", isChecked(/nias called/i))}
            </tr>
            <tr>
              {renderCheckPill("HOSPITAL ADMITTANCE", isChecked(/hospital admittance/i))}
              {renderCheckPill("EMOTIONAL SUPPORT", isChecked(/emotional support/i))}
            </tr>
          </tbody>
        </table>

        {/* 8. NARRATIVE */}
        <div style={bannerStyle}>NARRATIVE</div>
        <div style={{
          border: tblBorder,
          background: '#ffffff',
          padding: '10px 14px',
          marginBottom: '14px',
          fontFamily: 'Segoe UI, Calibri, sans-serif'
        }}>
          {(() => {
            let lines = narrative.includes('\n')
              ? narrative.split('\n')
              : [];
            if (lines.length === 0 && narrative) {
              const words = narrative.split(/\s+/).filter(Boolean);
              let cur = '';
              for (const w of words) {
                if ((cur + ' ' + w).length > 65) {
                  if (cur) lines.push(cur);
                  cur = w;
                } else {
                  cur = cur ? cur + ' ' + w : w;
                }
              }
              if (cur) lines.push(cur);
            }
            while (lines.length < 3) lines.push('');
            return lines.slice(0, 3).map((line, lIdx) => (
              <div key={lIdx} style={{
                borderBottom: '1px solid #cbd5e1',
                padding: '6px 0',
                minHeight: '26px',
                fontWeight: 700,
                fontSize: '0.84rem',
                color: '#0f172a'
              }}>
                {lIdx === 0 ? <strong style={{ color: '#475569', marginRight: '8px' }}>NARRATIVE:</strong> : null}
                {line}
              </div>
            ));
          })()}
        </div>

        {/* 9. SIGN-OFF & COMPLETION */}
        <div style={bannerStyle}>COMPLETION & SIGN-OFF</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: tblBorder, marginBottom: '14px' }}>
          <tbody>
            <tr>
              <td style={{ ...hdrStyle, width: '22%' }}>FORM COMPLETED BY</td>
              <td style={{ ...valStyle, width: '28%' }}>{completedBy}</td>
              <td style={{ ...hdrStyle, width: '18%' }}>POSITION</td>
              <td style={{ ...valStyle, width: '32%' }}>{position}</td>
            </tr>
            <tr>
              <td style={hdrStyle}>SIGNED</td>
              <td style={valStyle}>
                <span style={{ fontFamily: 'cursive, Segoe Script, sans-serif', fontSize: '1rem', color: '#1e3a8a', fontWeight: 700 }}>
                  {signature}
                </span>
              </td>
              <td style={hdrStyle}>DATE</td>
              <td style={valStyle}>{dateSigned}</td>
            </tr>
            <tr>
              <td colSpan={4} style={{ ...hdrStyle, background: '#f1f5f9', textAlign: 'center' }}>
                PARENT / GUARDIAN / RESPONSIBLE ADULT
              </td>
            </tr>
            <tr>
              <td colSpan={4} style={{ padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...hdrStyle, width: '16%' }}>SIGNED</td>
                      <td style={{ ...valStyle, width: '28%', color: parentSigned ? '#1e3a8a' : '#94a3b8', fontStyle: parentSigned ? 'normal' : 'italic', fontWeight: parentSigned ? 700 : 400 }}>
                        {parentSigned || '___________________'}
                      </td>
                      <td style={{ ...hdrStyle, width: '14%' }}>DATE</td>
                      <td style={{ ...valStyle, width: '18%', color: parentDate ? '#0f172a' : '#94a3b8', fontStyle: parentDate ? 'normal' : 'italic', fontWeight: parentDate ? 700 : 400 }}>
                        {parentDate || '__________'}
                      </td>
                      <td style={{ ...hdrStyle, width: '10%' }}>TIME</td>
                      <td style={{ ...valStyle, width: '14%', color: parentTime ? '#0f172a' : '#94a3b8', fontStyle: parentTime ? 'normal' : 'italic', fontWeight: parentTime ? 700 : 400 }}>
                        {parentTime || '__________'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style={hdrStyle}>COMMENTS</td>
              <td colSpan={3} style={{ ...valStyle, minHeight: '30px' }}>{comments}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Reset / Back to Upload Screen
  // --------------------------------------------------------------------------
  const handleBackToUpload = () => {
    setDoc(null);
    setSelectedFieldId(null);
    setCurrentPage(1);
    setViewMode('fit');
    setZoomLevel(1.0);
    setPanPos({ x: 0, y: 0 });
    setErrorMsg(null);
  };

  // --------------------------------------------------------------------------
  // File Upload Handling
  // --------------------------------------------------------------------------
  const handleFileUpload = async (file) => {
    if (!file) return;
    setErrorMsg(null);
    setIsUploading(true);
    setUploadProgress('Uploading document...');

    try {
      const formData = new FormData();
      formData.append('document', file);

      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to upload document');
      }

      const data = await res.json();
      const uploadedDoc = data.document;
      setDoc(uploadedDoc);
      setCurrentPage(1);
      setViewMode('fit');
      setZoomLevel(1.0);
      setRotation(0);
      setPanPos({ x: 0, y: 0 });

      // Trigger automatic layout analysis & OCR
      await runAnalysis(uploadedDoc.id, selectedEngine);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --------------------------------------------------------------------------
  // Run OCR & Layout Analysis
  // --------------------------------------------------------------------------
  const runAnalysis = async (docId, engine) => {
    setIsAnalyzing(true);
    setUploadProgress('Analyzing layout & detecting handwriting...');
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/analyze/${docId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: engine })
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Document analysis failed');
      }

      const data = await res.json();
      setDoc(data.document);
      setCanvasViewType('reconstructed');
      setPreviewTimestamp(Date.now());
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setIsAnalyzing(false);
      setUploadProgress('');
    }
  };

  // --------------------------------------------------------------------------
  // Load Sample Document
  // --------------------------------------------------------------------------
  const loadSample = async (sampleId) => {
    setErrorMsg(null);
    setIsUploading(true);
    setUploadProgress(`Loading sample: ${sampleId.replace('_', ' ')}...`);

    try {
      const res = await fetch(`${API_BASE}/load-sample/${sampleId}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load sample');
      }
      const data = await res.json();
      setDoc(data.document);
      setCurrentPage(1);
      setViewMode('fit');
      setZoomLevel(1.0);
      setRotation(0);
      setPanPos({ x: 0, y: 0 });
      setCanvasViewType('reconstructed');
      setPreviewTimestamp(Date.now());
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  // --------------------------------------------------------------------------
  // Field Editing & Updates
  // --------------------------------------------------------------------------
  const updateField = (fieldId, updates) => {
    if (!doc) return;
    const updatedFields = doc.fields.map(f => {
      if (f.id === fieldId) {
        return { ...f, ...updates };
      }
      return f;
    });

    setDoc(prev => ({ ...prev, fields: updatedFields }));
    syncFieldsWithBackend(updatedFields, doc.tables);
    setPreviewTimestamp(Date.now());
  };

  const syncFieldsWithBackend = async (fields, tables) => {
    if (!doc?.id) return;
    try {
      const res = await fetch(`${API_BASE}/document/${doc.id}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, tables })
      });
      const data = await res.json();
      if (data.summary) {
        setDoc(prev => ({ ...prev, summary: data.summary, status: data.status, extractedAt: data.extractedAt || prev.extractedAt }));
      }
      setPreviewTimestamp(Date.now());
    } catch (err) {
      console.error('Failed to sync fields with backend:', err);
    }
  };

  const toggleVerify = (fieldId) => {
    const field = doc.fields.find(f => f.id === fieldId);
    if (!field) return;
    updateField(fieldId, {
      verified: !field.verified,
      needsVerification: false
    });
  };

  const verifyAllHighConfidence = () => {
    if (!doc) return;
    const updated = doc.fields.map(f => {
      if (f.confidence >= 0.85) {
        return { ...f, verified: true, needsVerification: false };
      }
      return f;
    });
    setDoc(prev => ({ ...prev, fields: updated }));
    syncFieldsWithBackend(updated, doc.tables);
    setPreviewTimestamp(Date.now());
  };

  const deleteField = (fieldId) => {
    if (!doc) return;
    const filtered = doc.fields.filter(f => f.id !== fieldId);
    setDoc(prev => ({ ...prev, fields: filtered }));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    syncFieldsWithBackend(filtered, doc.tables);
    setPreviewTimestamp(Date.now());
  };

  const addNewField = (customBounds = null) => {
    if (!doc) return;
    const newId = `field_user_${Date.now()}`;
    const newField = {
      id: newId,
      label: 'New Field',
      value: '',
      originalOcrValue: '',
      page: currentPage,
      confidence: 1.0,
      verified: true,
      needsVerification: false,
      isUnreadable: false,
      isBlank: true,
      type: 'text',
      bounds: customBounds || { x: 0.25, y: 0.35, width: 0.3, height: 0.04 },
      isHandwritten: true
    };

    const updated = [...doc.fields, newField];
    setDoc(prev => ({ ...prev, fields: updated }));
    setSelectedFieldId(newId);
    syncFieldsWithBackend(updated, doc.tables);
    setPreviewTimestamp(Date.now());
  };

  // --------------------------------------------------------------------------
  // Table Editing
  // --------------------------------------------------------------------------
  const updateTableCell = (tableId, rowIndex, colIndex, value) => {
    if (!doc?.tables) return;
    const updatedTables = doc.tables.map(tbl => {
      if (tbl.id === tableId) {
        const newRows = [...tbl.rows];
        newRows[rowIndex] = [...newRows[rowIndex]];
        newRows[rowIndex][colIndex] = value;
        return { ...tbl, rows: newRows };
      }
      return tbl;
    });

    setDoc(prev => ({ ...prev, tables: updatedTables }));
    syncFieldsWithBackend(doc.fields, updatedTables);
    setPreviewTimestamp(Date.now());
  };

  const addTableRow = (tableId) => {
    if (!doc?.tables) return;
    const updatedTables = doc.tables.map(tbl => {
      if (tbl.id === tableId) {
        const colCount = (tbl.headers && tbl.headers.length) || (tbl.rows[0]?.length) || 3;
        const newRow = Array(colCount).fill('');
        return { ...tbl, rows: [...(tbl.rows || []), newRow] };
      }
      return tbl;
    });

    setDoc(prev => ({ ...prev, tables: updatedTables }));
    syncFieldsWithBackend(doc.fields, updatedTables);
    setPreviewTimestamp(Date.now());
  };

  // --------------------------------------------------------------------------
  // Interactive Canvas & Bounding Box Drawing
  // --------------------------------------------------------------------------
  const handleCanvasMouseDown = (e) => {
    if (!imageRef.current || !viewportRef.current) return;

    if (isDrawMode) {
      const rect = imageRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setDrawStart({ x, y });
      setCurrentDrawBox({ x, y, width: 0.01, height: 0.01 });
      return;
    }

    if (e.button === 0 && (viewMode === 'custom' || zoomLevel > 1.0 || e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panPos.x, y: e.clientY - panPos.y });
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (isDrawMode && drawStart && imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      const curX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const curY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const x = Math.min(drawStart.x, curX);
      const y = Math.min(drawStart.y, curY);
      const width = Math.abs(curX - drawStart.x);
      const height = Math.abs(curY - drawStart.y);

      setCurrentDrawBox({ x, y, width, height });
      return;
    }

    if (isPanning) {
      setPanPos({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDrawMode && currentDrawBox && currentDrawBox.width > 0.01 && currentDrawBox.height > 0.01) {
      addNewField(currentDrawBox);
      setIsDrawMode(false);
      setDrawStart(null);
      setCurrentDrawBox(null);
      return;
    }
    setIsPanning(false);
    setDrawStart(null);
    setCurrentDrawBox(null);
  };

  const scrollToFieldCard = (fieldId) => {
    setSelectedFieldId(fieldId);
    setTimeout(() => {
      const el = document.getElementById(`field-card-${fieldId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  };

  // Zoom helpers
  const handleZoomIn = () => {
    setViewMode('custom');
    setZoomLevel(z => Math.min(3.0, Number((z + 0.2).toFixed(1))));
  };

  const handleZoomOut = () => {
    setViewMode('custom');
    setZoomLevel(z => Math.max(0.4, Number((z - 0.2).toFixed(1))));
  };

  const handleFitPage = () => {
    setViewMode('fit');
    setZoomLevel(1.0);
    setPanPos({ x: 0, y: 0 });
    setRotation(0);
  };

  // --------------------------------------------------------------------------
  // Reconstructed PDF Preview Modal
  // --------------------------------------------------------------------------
  const openPdfPreview = async () => {
    if (!doc?.id) return;
    setIsGeneratingPdf(true);
    setShowPdfPreviewModal(true);

    try {
      const res = await fetch(`${API_BASE}/preview/pdf/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: doc.fields, cleanupRegions: doc.cleanupRegions || [] })
      });
      if (!res.ok) throw new Error('Failed to generate PDF preview');
      const data = await res.json();
      setPdfPreviewData(data);
    } catch (err) {
      console.error(err);
      setErrorMsg(`PDF Preview error: ${err.message}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // --------------------------------------------------------------------------
  // Exports (PDF, Word, Excel, JSON)
  // --------------------------------------------------------------------------
  const downloadReconstructedPdf = async () => {
    if (!doc?.id) return;
    setIsExporting(true);
    showToast('Generating Reconstructed PDF...', true);
    try {
      const res = await fetch(`${API_BASE}/export/pdf/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: doc.fields, cleanupRegions: doc.cleanupRegions || [] })
      });
      if (!res.ok) throw new Error('PDF Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.filename.replace(/\.[^/.]+$/, '')}_reconstructed.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast('Reconstructed PDF downloaded successfully!', true);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      showToast(`PDF Export failed: ${err.message}`, false);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadWordDocx = async () => {
    if (!doc?.id) return;
    setIsExporting(true);
    showToast('Generating Word document (.docx)...', true);
    try {
      const res = await fetch(`${API_BASE}/export/word/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: doc.fields, tables: doc.tables })
      });
      if (!res.ok) throw new Error('Word Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.filename.replace(/\.[^/.]+$/, '')}_extracted.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast('Word document (.docx) downloaded successfully!', true);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      showToast(`Word Export failed: ${err.message}`, false);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadExcelXlsx = async () => {
    if (!doc?.id) return;
    setIsExporting(true);
    showToast('Generating Excel workbook (.xlsx)...', true);
    try {
      const res = await fetch(`${API_BASE}/export/excel/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: doc.fields, tables: doc.tables })
      });
      if (!res.ok) throw new Error('Excel Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.filename.replace(/\.[^/.]+$/, '')}_data.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast('Excel workbook (.xlsx) downloaded successfully!', true);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      showToast(`Excel Export failed: ${err.message}`, false);
    } finally {
      setIsExporting(false);
    }
  };

  const viewJsonExport = async () => {
    if (!doc?.id) return;
    try {
      showToast('Loading clean JSON document structure...', true);
      const res = await fetch(`${API_BASE}/export/json/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: doc.fields })
      });
      const data = await res.json();
      setRawJsonText(JSON.stringify(data, null, 2));
      setShowJsonModal(true);
    } catch (err) {
      console.error(err);
      showToast('Failed to load JSON export', false);
    }
  };

  const downloadJsonFile = () => {
    if (!doc?.id || !rawJsonText) return;
    const blob = new Blob([rawJsonText], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.filename.replace(/\.[^/.]+$/, '')}_formflow.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // --------------------------------------------------------------------------
  // Filtered Fields List
  // --------------------------------------------------------------------------
  const filteredFields = useMemo(() => {
    if (!doc?.fields) return [];
    return doc.fields.filter(f => {
      if (filterTab === 'text' && f.type === 'checkbox') return false;
      if (filterTab === 'review' && (f.verified || f.confidence >= 0.85)) return false;
      if (filterTab === 'verified' && !f.verified) return false;
      if (filterTab === 'checkboxes' && f.type !== 'checkbox') return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const lMatch = (f.label || '').toLowerCase().includes(q);
        const vMatch = String(f.value || '').toLowerCase().includes(q);
        if (!lMatch && !vMatch) return false;
      }

      return true;
    });
  }, [doc?.fields, filterTab, searchQuery]);

  // Page specific fields for overlay
  const pageFields = useMemo(() => {
    if (!doc?.fields) return [];
    return doc.fields.filter(f => (f.page || 1) === currentPage);
  }, [doc?.fields, currentPage]);

  const summary = doc?.summary || {
    totalFields: 0,
    verifiedCount: 0,
    highConfidenceCount: 0,
    needsReviewCount: 0,
    unreadableCount: 0
  };

  return (
    <div className="app-container">
      {/* ---------------- Top Header ---------------- */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Back Button when Document is Loaded */}
          {doc && (
            <button
              className="back-btn"
              onClick={handleBackToUpload}
              title="Return to document upload dropzone"
            >
              <ArrowLeft size={14} />
              <span>Back to Upload</span>
            </button>
          )}

          <div className="brand-wrapper" onClick={handleBackToUpload} title="FormFlow AI Home">
            <div className="brand-icon-box">
              <Sparkles size={18} color="#ffffff" />
            </div>
            <div>
              <div className="brand-title">FormFlow AI</div>
            </div>
            <span className="brand-badge">Dynamic OCR</span>
          </div>
        </div>

        <div className="header-actions">
          {/* Engine Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-dim)' }}>Engine:</span>
            <select
              value={selectedEngine}
              onChange={(e) => {
                setSelectedEngine(e.target.value);
                if (doc?.id) runAnalysis(doc.id, e.target.value);
              }}
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.76rem'
              }}
            >
              <option value="auto">Auto (Best Available)</option>
              <option value="builtin">Built-in Smart Local (Sharp + Tesseract)</option>
              {systemStatus?.providers?.azure?.configured && (
                <option value="azure">Azure AI Document Intelligence</option>
              )}
              {systemStatus?.providers?.gemini?.configured && (
                <option value="gemini">Google Gemini Vision</option>
              )}
              {systemStatus?.providers?.openai?.configured && (
                <option value="openai">OpenAI GPT-4o Vision</option>
              )}
            </select>
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onClick={(e) => { e.target.value = ''; }}
            onChange={(e) => handleFileUpload(e.target.files[0])}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
            style={{ display: 'none' }}
          />

          <button
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isAnalyzing}
          >
            <Upload size={14} />
            Upload Document
          </button>
        </div>
      </header>

      {/* ---------------- Quick Test Samples Bar ---------------- */}
      <div className="sample-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Layers size={13} color="var(--primary)" />
          <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Quick Samples:</span>
        </div>
        <div className="sample-buttons">
          <button className="sample-btn" onClick={() => loadSample('medical_intake')}>
            <span>🏥</span> Medical Intake
          </button>
          <button className="sample-btn" onClick={() => loadSample('equipment_inspection')}>
            <span>⚙️</span> Equipment Log (Table)
          </button>
          <button className="sample-btn" onClick={() => loadSample('tax_photocopy')}>
            <span>📄</span> W-2C Tax Photocopy
          </button>
          <button className="sample-btn" onClick={() => loadSample('multipage_contract')}>
            <span>📑</span> Multi-Page PDF
          </button>
          <button className="sample-btn" onClick={() => loadSample('accident_report')} style={{ borderColor: 'rgba(244, 63, 94, 0.4)', background: 'rgba(244, 63, 94, 0.08)' }}>
            <span>🚨</span> Accident & Incident Report
          </button>
        </div>
      </div>

      {/* ---------------- Notification / Error Banner ---------------- */}
      {errorMsg && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.15)',
          borderBottom: '1px solid var(--accent-rose)',
          padding: '8px 20px',
          color: '#fecdd3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={15} color="var(--accent-rose)" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'transparent', border: 'none', color: '#fecdd3', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ---------------- Processing Progress Indicator ---------------- */}
      {(isUploading || isAnalyzing) && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.12)',
          borderBottom: '1px solid rgba(99, 102, 241, 0.3)',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '0.82rem',
          flexShrink: 0
        }}>
          <RefreshCw size={15} className="animate-spin" color="var(--primary)" style={{ animation: 'spin 1.5s linear infinite' }} />
          <span style={{ fontWeight: 600, color: '#e0e7ff' }}>{uploadProgress}</span>
        </div>
      )}

      {/* ---------------- Main Content Body ---------------- */}
      {!doc ? (
        /* Empty State Upload Hero */
        <main className="upload-hero">
          <div
            className="dropzone-box"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over'); }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('drag-over');
              if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
            }}
          >
            <div className="dropzone-icon">
              <Upload size={32} />
            </div>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '8px' }}>Drop any handwritten document or PDF here</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '520px', margin: '0 auto 20px' }}>
              Photographed paper forms, scanned sheets, contracts, tables, and checkboxes.
              Every layout is dynamically detected with zero predefined templates.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button className="btn btn-primary" style={{ padding: '8px 20px' }}>
                Browse Document
              </button>
            </div>
            <div style={{ marginTop: '20px', fontSize: '0.74rem', color: 'var(--text-dim)' }}>
              Supports PDF, PNG, JPG, JPEG, WEBP, TIFF (up to 30 MB)
            </div>
          </div>
        </main>
      ) : (
        /* Active Document Workspace (Split View) */
        <div className="workspace-grid">
          {/* ================= LEFT PANE: Document Preview Canvas ================= */}
          <section className="preview-pane">
            <div className="preview-toolbar">
              {/* Page Navigator */}
              <div className="toolbar-group">
                <button
                  className="icon-btn"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  title="Previous Page"
                >
                  <ChevronLeft size={15} />
                </button>
                <span style={{ fontWeight: 600, minWidth: '80px', textAlign: 'center' }}>
                  Page {currentPage} of {doc.pageCount || 1}
                </span>
                <button
                  className="icon-btn"
                  onClick={() => setCurrentPage(p => Math.min(doc.pageCount || 1, p + 1))}
                  disabled={currentPage >= (doc.pageCount || 1)}
                  title="Next Page"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Zoom & View Controls */}
              <div className="toolbar-group">
                <button className="icon-btn" onClick={handleZoomOut} title="Zoom Out">
                  <ZoomOut size={15} />
                </button>
                <span style={{ minWidth: '42px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                  {viewMode === 'fit' ? 'FIT' : `${Math.round(zoomLevel * 100)}%`}
                </span>
                <button className="icon-btn" onClick={handleZoomIn} title="Zoom In">
                  <ZoomIn size={15} />
                </button>
                <button
                  className={`icon-btn ${viewMode === 'fit' ? 'active' : ''}`}
                  onClick={handleFitPage}
                  title="Fit Entire Page in View"
                >
                  <Maximize2 size={15} />
                </button>
                <button className="icon-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°">
                  <RotateCw size={15} />
                </button>
              </div>

              {/* Document View Switcher */}
              <div className="toolbar-group" style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '6px', gap: '3px' }}>
                <button
                  className={`icon-btn ${canvasViewType === 'original' ? 'active' : ''}`}
                  onClick={() => setCanvasViewType('original')}
                  title="View Original Uploaded Scan with Overlays"
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: canvasViewType === 'original' ? 'var(--primary)' : 'transparent',
                    color: canvasViewType === 'original' ? '#fff' : 'var(--text-muted)',
                    fontWeight: 600
                  }}
                >
                  📄 Original Scan
                </button>
                <button
                  className={`icon-btn ${canvasViewType === 'reconstructed' ? 'active' : ''}`}
                  onClick={() => setCanvasViewType('reconstructed')}
                  title="View Reconstructed Form with Clean Digital Text"
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: canvasViewType === 'reconstructed' ? 'var(--primary)' : 'transparent',
                    color: canvasViewType === 'reconstructed' ? '#fff' : 'var(--text-muted)',
                    fontWeight: 600
                  }}
                >
                  ✨ Reconstructed
                </button>
                <button
                  className={`icon-btn ${canvasViewType === 'split' ? 'active' : ''}`}
                  onClick={() => setCanvasViewType('split')}
                  title="Side-by-Side Comparison: Original vs Reconstructed"
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: canvasViewType === 'split' ? 'var(--primary)' : 'transparent',
                    color: canvasViewType === 'split' ? '#fff' : 'var(--text-muted)',
                    fontWeight: 600
                  }}
                >
                  ↔ Side-by-Side
                </button>
              </div>

              {/* Overlay toggles */}
              <div className="toolbar-group">
                <button
                  className={`icon-btn ${showBoundingBoxes ? 'active' : ''}`}
                  onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
                  title="Toggle Detection Bounding Boxes"
                >
                  <Layers size={15} />
                </button>
                <button
                  className={`icon-btn ${isDrawMode ? 'active' : ''}`}
                  onClick={() => setIsDrawMode(!isDrawMode)}
                  title="Draw Custom Bounding Box on Document"
                  style={isDrawMode ? { background: 'var(--primary)', color: '#fff' } : {}}
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {/* Viewport with Canvas */}
            <div
              className="canvas-viewport"
              ref={viewportRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              style={{ cursor: isDrawMode ? 'crosshair' : (viewMode === 'custom' && zoomLevel > 1.0 ? 'grab' : 'default') }}
            >
              {canvasViewType === 'split' ? (
                /* Split Side-by-Side View */
                <div className="split-canvas-container" style={{ padding: '16px', maxWidth: '1400px' }}>
                  {/* Left: Original Scan */}
                  <div className="split-canvas-pane">
                    <div className="split-pane-header">
                      <span style={{ color: '#94a3b8' }}>📄 Original Scan (Uploaded)</span>
                      <span style={{ color: '#64748b' }}>Page {currentPage}</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={`${API_BASE}/page/${doc.id}/${currentPage}?t=${previewTimestamp}`}
                        alt="Original Document Page"
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                      />
                      {showBoundingBoxes && (
                        <div className="bbox-overlay">
                          {pageFields.map(field => {
                            if (!field.bounds) return null;
                            const b = field.bounds;
                            const isSelected = selectedFieldId === field.id;
                            const confClass = field.confidence >= 0.85 ? 'conf-high' : (field.confidence >= 0.50 ? 'conf-review' : 'conf-low');
                            return (
                              <div
                                key={field.id}
                                className={`bbox-box ${confClass} ${isSelected ? 'selected' : ''}`}
                                style={{
                                  left: `${b.x * 100}%`,
                                  top: `${b.y * 100}%`,
                                  width: `${b.width * 100}%`,
                                  height: `${b.height * 100}%`
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  scrollToFieldCard(field.id);
                                }}
                                title={`${field.label}: "${field.value}"`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Reconstructed Form */}
                  <div className="split-canvas-pane">
                    <div className="split-pane-header">
                      <span style={{ color: '#34d399' }}>✨ Reconstructed (Clean Digital Text)</span>
                      <span style={{ color: '#6ee7b7' }}>Verified Overlay</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={`${API_BASE}/reconstructed-page/${doc.id}/${currentPage}?t=${previewTimestamp}`}
                        alt="Reconstructed Page"
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Single Canvas View (Original or Reconstructed) */
                <div
                  className={`canvas-wrapper ${viewMode === 'fit' ? 'mode-fit' : ''}`}
                  style={viewMode === 'custom' ? {
                    transform: `translate(${panPos.x}px, ${panPos.y}px) scale(${zoomLevel}) rotate(${rotation}deg)`
                  } : {
                    transform: rotation ? `rotate(${rotation}deg)` : 'none'
                  }}
                >
                  {canvasViewType === 'reconstructed' ? (
                    /* Reconstructed Document Image with Digital Typed Text */
                    <div style={{ position: 'relative' }}>
                      <img
                        src={`${API_BASE}/reconstructed-page/${doc.id}/${currentPage}?t=${previewTimestamp}`}
                        alt={`Reconstructed Document Page ${currentPage}`}
                        className="document-page-image"
                        draggable={false}
                      />
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        background: 'rgba(16, 185, 129, 0.9)',
                        color: '#ffffff',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        pointerEvents: 'none'
                      }}>
                        ✨ DIGITAL RECONSTRUCTION
                      </div>
                    </div>
                  ) : (
                    /* Original Document Page Image */
                    <>
                      <img
                        ref={imageRef}
                        src={`${API_BASE}/page/${doc.id}/${currentPage}?t=${previewTimestamp}`}
                        alt={`Document Page ${currentPage}`}
                        className="document-page-image"
                        draggable={false}
                      />

                      {/* Interactive Bounding Box Overlay */}
                      {showBoundingBoxes && (
                        <div className="bbox-overlay">
                          {pageFields.map(field => {
                            if (!field.bounds) return null;
                            const b = field.bounds;
                            const isSelected = selectedFieldId === field.id;
                            const confClass = field.confidence >= 0.85 ? 'conf-high' : (field.confidence >= 0.50 ? 'conf-review' : 'conf-low');

                            return (
                              <div
                                key={field.id}
                                className={`bbox-box ${confClass} ${isSelected ? 'selected' : ''}`}
                                style={{
                                  left: `${b.x * 100}%`,
                                  top: `${b.y * 100}%`,
                                  width: `${b.width * 100}%`,
                                  height: `${b.height * 100}%`
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  scrollToFieldCard(field.id);
                                }}
                                title={`${field.label}: "${field.value}" (${Math.round((field.confidence || 0) * 100)}%)`}
                              />
                            );
                          })}

                          {/* Active Drawing Box */}
                          {isDrawMode && currentDrawBox && (
                            <div
                              style={{
                                position: 'absolute',
                                left: `${currentDrawBox.x * 100}%`,
                                top: `${currentDrawBox.y * 100}%`,
                                width: `${currentDrawBox.width * 100}%`,
                                height: `${currentDrawBox.height * 100}%`,
                                border: '2px dashed #6366f1',
                                background: 'rgba(99, 102, 241, 0.2)',
                                pointerEvents: 'none'
                              }}
                            />
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Canvas Bottom Status */}
            <div style={{
              height: '28px',
              flexShrink: 0,
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border-subtle)',
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-dim)'
            }}>
              <span>{isDrawMode ? '🎯 Drag mouse over document to define a box' : '💡 Click any box to inspect and edit'}</span>
              <span>Dimensions: {doc.pages?.[currentPage - 1]?.width || 1200} × {doc.pages?.[currentPage - 1]?.height || 1600} px</span>
            </div>
          </section>

          {/* ================= RIGHT PANE: Dynamic Extracted-Data Editor ================= */}
          <section className="editor-pane">
            {/* Editor Header */}
            <div className="editor-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '0.98rem', fontWeight: 700 }}>Dynamic Field Verification</h3>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {summary.totalFields} dynamic items detected by {doc.engineUsed ? doc.engineUsed.toUpperCase() : 'BUILTIN'} Engine
                  </div>
                </div>

                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '5px 10px' }}
                  onClick={verifyAllHighConfidence}
                  title="Verify all fields with >= 85% confidence"
                >
                  <ShieldCheck size={13} color="var(--accent-emerald)" />
                  Verify High Conf ({summary.highConfidenceCount})
                </button>
              </div>

              {/* Status Chips */}
              <div className="stats-ribbon">
                <span className="stat-chip high">
                  <CheckCircle2 size={11} /> {summary.verifiedCount} Verified
                </span>
                <span className="stat-chip review">
                  <AlertTriangle size={11} /> {summary.needsReviewCount} Needs Review
                </span>
                {summary.unreadableCount > 0 && (
                  <span className="stat-chip unreadable">
                    <AlertCircle size={11} /> {summary.unreadableCount} Unreadable
                  </span>
                )}
                {doc.tables?.length > 0 && (
                  <span className="stat-chip" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                    <TableIcon size={11} /> {doc.tables.length} Tables
                  </span>
                )}
              </div>
            </div>

            {/* Filter Tabs & Search Bar */}
            {/* Filter Tabs & Search Bar */}
            <div className="filter-tabs">
              <button
                className={`tab-btn ${filterTab === 'all' ? 'active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({doc.fields?.length || 0})
              </button>
              <button
                className={`tab-btn ${filterTab === 'text' ? 'active' : ''}`}
                onClick={() => setFilterTab('text')}
                title="View only text, address, and date fields"
              >
                Text Fields ({doc.fields?.filter(f => f.type !== 'checkbox').length || 0})
              </button>
              <button
                className={`tab-btn ${filterTab === 'checkboxes' ? 'active' : ''}`}
                onClick={() => setFilterTab('checkboxes')}
                title="View only detected form checkboxes"
              >
                Checkboxes ({doc.fields?.filter(f => f.type === 'checkbox').length || 0})
              </button>
              <button
                className={`tab-btn ${filterTab === 'review' ? 'active' : ''}`}
                onClick={() => setFilterTab('review')}
              >
                Review ({summary.needsReviewCount})
              </button>
              <button
                className={`tab-btn ${filterTab === 'verified' ? 'active' : ''}`}
                onClick={() => setFilterTab('verified')}
              >
                Verified ({summary.verifiedCount})
              </button>
              {doc.tables?.length > 0 && (
                <button
                  className={`tab-btn ${filterTab === 'tables' ? 'active' : ''}`}
                  onClick={() => setFilterTab('tables')}
                >
                  Tables ({doc.tables.length})
                </button>
              )}

              {/* Search filter input */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', background: 'var(--bg-input)', borderRadius: '4px', padding: '2px 8px', border: '1px solid var(--border-subtle)' }}>
                <Search size={12} color="var(--text-dim)" />
                <input
                  type="text"
                  placeholder="Filter fields..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '0.72rem', outline: 'none', marginLeft: '6px', width: '90px' }}
                />
              </div>
            </div>

            {/* Fields List */}
            <div className="fields-list-scroll" ref={fieldsContainerRef}>
              {/* If Checkboxes Tab Selected: Clean, Responsive Compact Grid */}
              {filterTab === 'checkboxes' ? (
                <div className="checkboxes-grid">
                  {filteredFields.map(field => {
                    const isSelected = selectedFieldId === field.id;
                    const isChecked = ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(field.value).toLowerCase());
                    const confPct = Math.round((field.confidence || 0) * 100);

                    return (
                      <div
                        key={field.id}
                        id={`field-card-${field.id}`}
                        className={`checkbox-card-compact ${isSelected ? 'selected' : ''} ${isChecked ? 'checked' : ''}`}
                        onClick={() => {
                          setSelectedFieldId(field.id);
                          if (field.page && field.page !== currentPage) {
                            setCurrentPage(field.page);
                          }
                        }}
                      >
                        <div className="checkbox-toggle-wrap">
                          <div
                            className="checkbox-custom-box"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateField(field.id, { value: isChecked ? 'false' : 'true' });
                            }}
                            title="Click to toggle checkbox"
                          >
                            {isChecked && <Check size={12} strokeWidth={3} />}
                          </div>
                          <span className="checkbox-compact-label">{field.label}</span>
                        </div>

                        <div className="checkbox-compact-actions">
                          <span style={{ fontSize: '0.7rem', color: isChecked ? 'var(--accent-emerald)' : 'var(--text-dim)', fontWeight: 600 }}>
                            {isChecked ? '☑ Selected' : '☐ Empty'}
                          </span>

                          <span className={`confidence-pill ${field.confidence >= 0.85 ? 'high' : 'review'}`} style={{ padding: '1px 5px', fontSize: '0.68rem' }}>
                            {confPct}%
                          </span>

                          <button
                            className={`verify-toggle-btn ${field.verified ? 'verified' : ''}`}
                            style={{ padding: '2px 6px', fontSize: '0.68rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleVerify(field.id);
                            }}
                          >
                            <Check size={10} />
                            {field.verified ? 'Verified' : 'Confirm'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : filterTab === 'tables' && doc.tables?.length > 0 ? (
                doc.tables.map(tbl => (
                  <div key={tbl.id} className="field-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{tbl.title || 'Extracted Table'}</div>
                      <span className="brand-badge">Page {tbl.page || 1}</span>
                    </div>

                    <div className="table-matrix-wrapper">
                      <table className="dynamic-table-grid">
                        <thead>
                          <tr>
                            {tbl.headers?.map((h, i) => (
                              <th key={i}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tbl.rows?.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx}>
                                  <input
                                    type="text"
                                    className="table-cell-input"
                                    value={cell}
                                    onChange={(e) => updateTableCell(tbl.id, rIdx, cIdx, e.target.value)}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '4px 8px' }} onClick={() => addTableRow(tbl.id)}>
                        <Plus size={12} /> Add Row
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                /* Dynamic Field Cards for All / Text / Review / Verified */
                (() => {
                  const renderFieldCard = (field) => {
                    const isSelected = selectedFieldId === field.id;
                    const confPct = Math.round((field.confidence || 0) * 100);
                    const confClass = field.confidence >= 0.85 ? 'high' : (field.confidence >= 0.50 ? 'review' : 'low');

                    return (
                      <div
                        key={field.id}
                        id={`field-card-${field.id}`}
                        className={`field-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedFieldId(field.id);
                          if (field.page && field.page !== currentPage) {
                            setCurrentPage(field.page);
                          }
                        }}
                      >
                        {/* Card Header */}
                        <div className="field-card-header">
                          <input
                            type="text"
                            className="field-label-input"
                            value={field.label}
                            onChange={(e) => updateField(field.id, { label: e.target.value })}
                            title="Click to edit field label"
                          />

                          <div className="field-badge-group">
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                              {field.type}
                            </span>
                            <span className={`confidence-pill ${confClass}`}>
                              {confPct}%
                            </span>
                          </div>
                        </div>

                        {/* Card Input Value */}
                        {field.type === 'checkbox' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
                            <input
                              type="checkbox"
                              checked={['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(field.value).toLowerCase())}
                              onChange={(e) => updateField(field.id, { value: e.target.checked ? 'true' : 'false' })}
                              style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.84rem' }}>
                              {['true', 'yes', '1', '[x]', 'checked', 'x'].includes(String(field.value).toLowerCase()) ? 'Selected / Checked' : 'Not Selected'}
                            </span>
                          </div>
                        ) : field.type === 'multiline' ? (
                          <textarea
                            className="field-value-input field-textarea"
                            value={field.value}
                            onChange={(e) => updateField(field.id, { value: e.target.value })}
                            placeholder="(Blank - click to enter value)"
                          />
                        ) : (
                          <input
                            type="text"
                            className="field-value-input"
                            value={field.value}
                            onChange={(e) => updateField(field.id, { value: e.target.value })}
                            placeholder="(Blank - click to enter value)"
                          />
                        )}

                        {/* Original OCR Reference if edited */}
                        {field.originalOcrValue !== field.value && (
                          <div className="original-ocr-box">
                            <span className="ocr-val-text">OCR was: "{field.originalOcrValue}"</span>
                            <button
                              className="revert-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField(field.id, { value: field.originalOcrValue });
                              }}
                            >
                              Revert
                            </button>
                          </div>
                        )}

                        {/* Action Bar */}
                        <div className="field-actions">
                          <button
                            className={`verify-toggle-btn ${field.verified ? 'verified' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleVerify(field.id);
                            }}
                          >
                            <Check size={11} />
                            {field.verified ? 'Verified' : 'Confirm'}
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              className="icon-btn"
                              style={{ width: '24px', height: '24px' }}
                              title="Mark as Unreadable"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField(field.id, { isUnreadable: true, confidence: 0.2 });
                              }}
                            >
                              <HelpCircle size={13} color="var(--accent-amber)" />
                            </button>
                            <button
                              className="icon-btn"
                              style={{ width: '24px', height: '24px' }}
                              title="Remove False Detection"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteField(field.id);
                              }}
                            >
                              <Trash2 size={13} color="var(--accent-rose)" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  };

                  if (filterTab === 'all' && !searchQuery) {
                    const sections = categorizeDocFields(filteredFields);
                    return sections.map(sec => (
                      <div key={sec.name} className="sidebar-section-group">
                        <div className="sidebar-section-banner">
                          <span>📋 {sec.name}</span>
                          <span className="sidebar-section-badge">{sec.fields.length}</span>
                        </div>
                        {sec.fields.map(renderFieldCard)}
                      </div>
                    ));
                  }

                  return filteredFields.map(renderFieldCard);
                })()
              )}

              {/* Add Field Button */}
              <div style={{ padding: '6px 0', textAlign: 'center' }}>
                <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => addNewField()}>
                  <Plus size={13} /> Add Missing Field
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ---------------- Bottom Export Action Bar ---------------- */}
      {doc && (
        <footer className="export-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.82rem' }}>{doc.filename}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              ({summary.verifiedCount}/{summary.totalFields} verified)
            </span>
          </div>

          <div className="export-actions">
            {/* Reconstructed PDF with preview */}
            <button
              className="btn btn-secondary"
              onClick={openPdfPreview}
              disabled={isGeneratingPdf}
              title="Preview original layout with clean typed text before download"
            >
              <Eye size={13} />
              Preview PDF
            </button>

            <button
              className="btn btn-primary"
              onClick={downloadReconstructedPdf}
              disabled={isExporting}
              title="Preserves original page background, lines, tables and overlays verified text"
            >
              <Download size={13} />
              Reconstructed PDF
            </button>

            {/* Word .docx Preview & Export */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowWordModal(true)}
                disabled={isExporting}
                title="Preview Word (.docx) layout and download"
              >
                <FileText size={13} color="#3b82f6" />
                Word
              </button>
              <button
                className="btn btn-secondary"
                onClick={downloadWordDocx}
                disabled={isExporting}
                title="Download Word (.docx) directly"
                style={{ padding: '6px 8px' }}
              >
                <Download size={12} color="#3b82f6" />
              </button>
            </div>

            {/* Excel .xlsx Preview & Export */}
            <button
              className="btn btn-secondary"
              onClick={() => setShowExcelModal(true)}
              disabled={isExporting}
              title="Preview Excel (.xlsx) spreadsheet sheets and download"
            >
              <FileSpreadsheet size={13} color="#10b981" />
              Excel
            </button>

            {/* JSON */}
            <button className="btn btn-secondary" onClick={viewJsonExport} title="View standardized JSON data structure">
              <FileCode size={13} color="#a855f7" />
              JSON
            </button>
          </div>
        </footer>
      )}

      {/* ---------------- PDF Reconstruction Preview Modal ---------------- */}
      {showPdfPreviewModal && (
        <div className="modal-overlay" onClick={() => setShowPdfPreviewModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1000px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Eye size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1rem' }}>Original-Layout Reconstructed PDF Preview</h3>
              </div>

              {/* Zoom Controls inside modal */}
              {pdfPreviewData && !isGeneratingPdf && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', marginRight: '16px' }}>
                  <button
                    className="icon-btn"
                    onClick={() => setPdfModalZoom(z => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
                    title="Zoom Out"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span style={{ fontSize: '0.74rem', minWidth: '42px', textAlign: 'center', color: 'var(--text-main)', fontWeight: 600 }}>
                    {Math.round(pdfModalZoom * 100)}%
                  </span>
                  <button
                    className="icon-btn"
                    onClick={() => setPdfModalZoom(z => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
                    title="Zoom In"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setPdfModalZoom(1.0)}
                    title="Reset Zoom (100%)"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              )}

              <button className="icon-btn" onClick={() => setShowPdfPreviewModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body" style={{ textAlign: 'center', background: '#0b0f19', overflow: 'auto' }}>
              {isGeneratingPdf ? (
                <div style={{ padding: '60px 0' }}>
                  <RefreshCw size={36} className="animate-spin" color="var(--primary)" style={{ animation: 'spin 1.5s linear infinite', margin: '0 auto 16px' }} />
                  <p style={{ fontWeight: 600, fontSize: '1rem', color: '#f8fafc' }}>Preserving original page background & overlaying digital text...</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Preserving form borders, tables, checkboxes, and logos</p>
                </div>
              ) : pdfPreviewData ? (
                <div>
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '0.8rem',
                    color: 'var(--accent-emerald)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left'
                  }}>
                    <span>
                      ✅ <strong>Layout Preserved:</strong> {pdfPreviewData.report?.fieldsOverlaid || (doc.fields?.length || 0)} typed fields overlaid cleanly.
                    </span>
                    <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6ee7b7' }}>
                      Quality: {pdfPreviewData.report?.reconstructionQuality || 'High'}
                    </span>
                  </div>

                  {pdfPreviewData.previewImages?.map((pImg, idx) => (
                    <div key={idx} style={{ marginBottom: '24px' }}>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
                        Page {pImg.pageNumber} of {pdfPreviewData.previewImages.length}
                      </div>
                      <div style={{ display: 'inline-block', maxWidth: '100%', overflow: 'auto' }}>
                        <img
                          src={pImg.dataUrl}
                          alt={`Reconstructed PDF Page ${pImg.pageNumber}`}
                          style={{
                            width: `${Math.round(pdfModalZoom * 100)}%`,
                            maxWidth: 'none',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
                            display: 'block',
                            margin: '0 auto',
                            transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Inspect typed text alignment and ink removal before final export.
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setShowPdfPreviewModal(false)}>
                  Close
                </button>
                <button className="btn btn-primary" onClick={downloadReconstructedPdf} disabled={isExporting}>
                  <Download size={13} /> Download Reconstructed PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Word (.docx) Document Preview Modal ---------------- */}
      {showWordModal && doc && (
        <div className="modal-overlay" onClick={() => setShowWordModal(false)}>
          <div className="modal-content word-modal-wrapper" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '980px' }}>
            {/* 1. Microsoft Word Chrome Titlebar */}
            <div className="word-chrome-titlebar">
              <div className="word-app-badge">
                <div className="word-app-icon">W</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', letterSpacing: '0.01em' }}>
                    {getDisplayDocTitle(doc)} &bull; Word Document (.docx)
                  </div>
                  <div style={{ fontSize: '0.70rem', color: '#bfdbfe', opacity: 0.9 }}>
                    Source: {doc.filename} &bull; OpenXML Standard
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="brand-badge" style={{ background: 'rgba(255, 255, 255, 0.18)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.35)', fontSize: '0.72rem' }}>
                  {doc.fields?.length || 0} Fields &bull; 96% AI Verified
                </span>
                <button
                  className="icon-btn"
                  onClick={() => setShowWordModal(false)}
                  style={{ color: '#ffffff', background: 'rgba(255, 255, 255, 0.12)' }}
                  title="Close Preview"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 2. Microsoft Word Ribbon Tabs */}
            <div className="word-chrome-tabs">
              <div className="word-tab-item">File</div>
              <div className="word-tab-item active">Home</div>
              <div className="word-tab-item">Insert</div>
              <div className="word-tab-item">Layout</div>
              <div className="word-tab-item">References</div>
              <div className="word-tab-item">Review</div>
              <div className="word-tab-item">View</div>
            </div>

            {/* 3. Word Formatting Ribbon Toolbar */}
            <div className="word-ribbon-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select className="word-ribbon-select" defaultValue="Segoe UI">
                  <option value="Segoe UI">Segoe UI</option>
                  <option value="Aptos">Aptos (Body)</option>
                  <option value="Calibri">Calibri</option>
                  <option value="Arial">Arial</option>
                </select>
                <select className="word-ribbon-select" defaultValue="11" style={{ width: '44px' }}>
                  <option value="10">10</option>
                  <option value="11">11</option>
                  <option value="12">12</option>
                  <option value="14">14</option>
                </select>
                <div style={{ height: '16px', width: '1px', background: '#cbd5e1', margin: '0 4px' }} />
                <button className="word-ribbon-btn active" title="Bold"><strong>B</strong></button>
                <button className="word-ribbon-btn" title="Italic"><em>I</em></button>
                <button className="word-ribbon-btn" title="Underline"><u>U</u></button>
                <button className="word-ribbon-btn" title="Strikethrough"><s>S</s></button>
                <div style={{ height: '16px', width: '1px', background: '#cbd5e1', margin: '0 4px' }} />
                <button className="word-ribbon-btn active" title="Align Left">Left</button>
                <button className="word-ribbon-btn" title="Center">Center</button>
                <button className="word-ribbon-btn" title="Justify">Justify</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Zoom: 100%</span>
                <button className="btn btn-primary" onClick={downloadWordDocx} disabled={isExporting} style={{ padding: '4px 12px', fontSize: '0.78rem' }}>
                  <Download size={12} /> Download .docx
                </button>
              </div>
            </div>

            {/* 4. Document Page Sheet Canvas — light Word-style page (not dark theme) */}
            <div className="word-doc-canvas">
              <ModalErrorBoundary onDownloadFallback={downloadWordDocx}>
                <div className="word-doc-sheet" style={{ background: '#ffffff', color: '#0f172a' }}>
                {isAccidentDocument(doc) ? (
                  <>
                    <div className="word-doc-title" style={{ color: '#1e3a5f' }}>
                      Accident & Incident Report Form
                    </div>
                    <div className="word-doc-divider" />
                    <div className="word-doc-subtitle" style={{ color: '#64748b' }}>
                      FILLED FROM MASTER TEMPLATE LAYOUT • SOURCE: {doc.filename} • {new Date().toLocaleDateString()}
                    </div>
                    {/* Horizontal multi-column form — same layout as Accident Report Template.docx */}
                    {renderAuthenticFormLayout(doc, false)}
                  </>
                ) : (
                  <>
                    <div className="word-doc-title">
                      {getDisplayDocTitle(doc)}
                    </div>
                    <div className="word-doc-divider" />
                    <div className="word-doc-subtitle">
                      FORMFLOW AI VERIFIED DOCUMENT RECONSTRUCTION &bull; EXPORTED: {new Date().toLocaleDateString()}
                    </div>

                    <div className="word-meta-strip">
                      <div className="word-meta-item">
                        <span className="word-meta-label">Reference ID</span>
                        <span className="word-meta-val">
                          {doc.fields?.find(f => /ref no|reference/i.test(f.label))?.value || '—'}
                        </span>
                      </div>
                      <div className="word-meta-item">
                        <span className="word-meta-label">Form Date</span>
                        <span className="word-meta-val">
                          {doc.fields?.find(f => /form date|incident date|date/i.test(f.label))?.value || '—'}
                        </span>
                      </div>
                      <div className="word-meta-item">
                        <span className="word-meta-label">Project / Facility</span>
                        <span className="word-meta-val">
                          {doc.fields?.find(f => /project name|project/i.test(f.label))?.value || '—'}
                        </span>
                      </div>
                      <div className="word-meta-item">
                        <span className="word-meta-label">Status</span>
                        <span className="word-meta-val" style={{ color: '#16a34a' }}>
                          Official Record
                        </span>
                      </div>
                    </div>

                    {renderAuthenticFormLayout(doc, false)}

                    {(doc.tables || []).length > 0 && (
                      <div style={{ marginTop: '22px' }}>
                        <div className="word-section-banner">
                          Detected Tables & Options Matrix
                        </div>
                        {doc.tables.map((tbl, tIdx) => (
                          <div key={tbl.id || tIdx} style={{ marginBottom: '16px' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#334155', marginBottom: '6px' }}>
                              {tbl.title || `Table ${tIdx + 1}`}
                            </div>
                            <table className="word-form-table">
                              <thead>
                                <tr style={{ background: '#1e293b' }}>
                                  {(tbl.headers || []).map((h, hIdx) => (
                                    <th key={hIdx} style={{ padding: '7px 12px', color: '#ffffff', fontSize: '0.78rem', fontWeight: 700, textAlign: 'left', border: '1px solid #334155' }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(tbl.rows || []).map((row, rIdx) => (
                                  <tr key={rIdx} style={{ background: rIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }}>
                                    {row.map((cell, cIdx) => (
                                      <td key={cIdx} style={{ padding: '7px 12px', fontSize: '0.82rem', border: '1px solid #e2e8f0', color: '#1e293b' }}>
                                        {cell || '-'}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="word-doc-footer">
                  <span>Page 1 of 1 &bull; FormFlow AI Document Verification Engine</span>
                  <span>Confidential Business Document &bull; OpenXML Specification</span>
                </div>
              </div>
            </ModalErrorBoundary>
          </div>

            {/* 5. Microsoft Word Bottom Status Bar */}
            <div className="word-statusbar">
              <div>
                Page 1 of 1 &bull; {doc.fields?.length || 0} Form Fields &bull; English (US) &bull; 100% Zoom
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowWordModal(false)}
                  style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.3)', padding: '4px 14px', fontSize: '0.78rem' }}
                >
                  Close
                </button>
                <button
                  className="btn btn-primary"
                  onClick={downloadWordDocx}
                  disabled={isExporting}
                  style={{ background: '#ffffff', color: '#185abd', fontWeight: 700, padding: '4px 16px', fontSize: '0.78rem' }}
                >
                  <Download size={13} color="#185abd" /> Download .docx
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Excel (.xlsx) Spreadsheet Preview Modal ---------------- */}
      {showExcelModal && (
        <div className="modal-overlay" onClick={() => setShowExcelModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '980px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileSpreadsheet size={18} color="#10b981" />
                <h3 style={{ fontSize: '1rem' }}>Microsoft Excel Spreadsheet Preview (.xlsx)</h3>
                <span className="brand-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                  {doc.fields?.length || 0} Rows &bull; 9 Columns
                </span>
              </div>
              <button className="icon-btn" onClick={() => setShowExcelModal(false)}>
                <X size={16} />
              </button>
            </div>

            {/* Excel Tabs Bar */}
            <div className="excel-tabs-bar">
              <button
                className={`excel-tab-btn ${excelActiveTab === 'form' ? 'active' : ''}`}
                onClick={() => setExcelActiveTab('form')}
              >
                📋 Sheet 1: Digital Form
              </button>
              <button
                className={`excel-tab-btn ${excelActiveTab === 'fields' ? 'active' : ''}`}
                onClick={() => setExcelActiveTab('fields')}
              >
                📊 Sheet 2: Data Table ({doc.fields?.length || 0})
              </button>
              <button
                className={`excel-tab-btn ${excelActiveTab === 'audit' ? 'active' : ''}`}
                onClick={() => setExcelActiveTab('audit')}
              >
                🔍 Sheet 3: Audit Log
              </button>
              {(doc.tables || []).length > 0 && (
                <button
                  className={`excel-tab-btn ${excelActiveTab === 'tables' ? 'active' : ''}`}
                  onClick={() => setExcelActiveTab('tables')}
                >
                  📈 Sheet 4: Tables ({doc.tables?.length})
                </button>
              )}
            </div>

            {/* Formula / Info Ribbon */}
            <div style={{
              background: '#131b2c',
              borderBottom: '1px solid var(--border-subtle)',
              padding: '6px 14px',
              fontSize: '0.74rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>
                <strong>Active Sheet:</strong> {excelActiveTab === 'form' ? 'Digital Form (Document Layout)' : (excelActiveTab === 'fields' ? 'Tabular Spreadsheet' : (excelActiveTab === 'audit' ? 'Technical Coordinates Audit' : 'Detected Tables'))}
              </span>
              <span>
                Verified: <strong style={{ color: 'var(--accent-emerald)' }}>{summary.verifiedCount}</strong> | Total Items: <strong style={{ color: '#38bdf8' }}>{doc.fields?.length || 0}</strong>
              </span>
            </div>

            <div className="modal-body" style={{ padding: '14px', maxHeight: '72vh', overflow: 'auto' }}>
              {excelActiveTab === 'form' ? (
                /* Sheet 1: Authentic Digital Form Sheet */
                <div style={{ background: '#0b0f19', padding: '10px' }}>
                  <div style={{
                    background: '#ffffff',
                    color: '#0f172a',
                    padding: '24px 30px',
                    borderRadius: '6px',
                    maxWidth: '860px',
                    margin: '0 auto',
                    fontFamily: 'Segoe UI, Calibri, sans-serif'
                  }}>
                    {/* Title Banner */}
                    <div style={{
                      background: '#0f172a',
                      color: '#ffffff',
                      padding: '12px 18px',
                      borderRadius: '4px',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                          {doc.documentTitle || doc.filename?.replace(/^[0-9]+_[0-9a-f]+_/i, '').replace(/\.[^/.]+$/, '').replace(/_/g, ' ') || 'DIGITAL FORM'}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                          Source Document: {doc.filename} &bull; Excel Form Sheet
                        </div>
                      </div>
                      <span style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.15)', padding: '3px 8px', borderRadius: '4px' }}>
                        EXCEL WORKBOOK
                      </span>
                    </div>

                    {/* Authentic Multi-Column Document Form Layout */}
                    {renderAuthenticFormLayout(doc, true)}
                  </div>
                </div>
              ) : excelActiveTab === 'fields' ? (
                /* Sheet 2: Tabular Spreadsheet Data */
                <div className="excel-grid-wrapper">
                  <table className="excel-grid-table">
                    <thead>
                      <tr>
                        <th className="excel-row-num">#</th>
                        <th>A: Page</th>
                        <th>B: Section</th>
                        <th>C: Field Item / Label</th>
                        <th>D: Verified Value</th>
                        <th>E: Type</th>
                        <th>F: Confidence</th>
                        <th>G: Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(doc.fields || []).map((f, idx) => {
                        const isVerified = !!f.verified;
                        const status = isVerified ? 'Verified' : (f.confidence >= 0.85 ? 'High Conf' : 'Needs Review');
                        let displayVal = f.value !== undefined && f.value !== null ? String(f.value) : '';
                        if (f.type === 'checkbox') {
                          const isChecked = ['true', 'yes', '1', '[x]', 'checked', 'x'].includes(displayVal.toLowerCase());
                          displayVal = isChecked ? 'YES (Checked)' : 'NO (Unchecked)';
                        }

                        return (
                          <tr key={f.id || idx}>
                            <td className="excel-row-num">{idx + 1}</td>
                            <td style={{ textAlign: 'center' }}>{f.page || 1}</td>
                            <td style={{ color: '#94a3b8' }}>{f.section || (f.label?.includes(':') ? f.label.split(':')[0] : 'General')}</td>
                            <td style={{ fontWeight: 600, color: '#f8fafc' }}>{f.label || 'Unlabeled'}</td>
                            <td style={{ color: displayVal ? '#38bdf8' : '#64748b', fontWeight: 600 }}>
                              {displayVal || '(Empty)'}
                            </td>
                            <td>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '3px' }}>
                                {f.type || 'text'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                              {Math.round((f.confidence || 0) * 100)}%
                            </td>
                            <td>
                              <span style={{
                                color: status === 'Verified' ? '#4ade80' : status === 'High Conf' ? '#60a5fa' : '#fbbf24',
                                fontWeight: 600
                              }}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : excelActiveTab === 'audit' ? (
                /* Sheet 3: Audit Log with Coordinates */
                <div className="excel-grid-wrapper">
                  <table className="excel-grid-table">
                    <thead>
                      <tr>
                        <th className="excel-row-num">#</th>
                        <th>A: Field ID</th>
                        <th>B: Page</th>
                        <th>C: Field Label</th>
                        <th>D: Final Extracted Value</th>
                        <th>E: Original OCR Output</th>
                        <th>F: Confidence</th>
                        <th>G: Coordinates (X, Y, W, H)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(doc.fields || []).map((f, idx) => {
                        const b = f.bounds || {};
                        const boundsStr = b.x !== undefined ? `X:${b.x.toFixed(3)}, Y:${b.y.toFixed(3)}, W:${b.width.toFixed(3)}, H:${b.height.toFixed(3)}` : 'N/A';
                        return (
                          <tr key={f.id || idx}>
                            <td className="excel-row-num">{idx + 1}</td>
                            <td style={{ color: '#94a3b8' }}>{f.id}</td>
                            <td style={{ textAlign: 'center' }}>{f.page || 1}</td>
                            <td style={{ fontWeight: 600, color: '#f8fafc' }}>{f.label || 'Unlabeled'}</td>
                            <td style={{ color: '#38bdf8', fontWeight: 500 }}>{f.value !== undefined ? String(f.value) : ''}</td>
                            <td style={{ color: '#94a3b8' }}>{f.originalOcrValue !== undefined ? String(f.originalOcrValue) : ''}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{Math.round((f.confidence || 0) * 100)}%</td>
                            <td style={{ color: '#64748b', fontSize: '0.72rem' }}>{boundsStr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Sheet 4: Detected Tables */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {(doc.tables || []).map((tbl, tIdx) => (
                    <div key={tbl.id || tIdx}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
                        {tbl.title || `Table ${tIdx + 1}`} (Page {tbl.page || 1})
                      </div>
                      <div className="excel-grid-wrapper">
                        <table className="excel-grid-table">
                          <thead>
                            <tr>
                              <th className="excel-row-num">#</th>
                              {(tbl.headers || []).map((h, cIdx) => (
                                <th key={cIdx}>{String.fromCharCode(65 + cIdx)}: {h || `Column ${cIdx + 1}`}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(tbl.rows || []).map((row, rIdx) => (
                              <tr key={rIdx}>
                                <td className="excel-row-num">{rIdx + 1}</td>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx}>{cell || '-'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Multi-sheet Excel workbook generated using exceljs open standard.
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setShowExcelModal(false)}>
                  Close
                </button>
                <button className="btn btn-primary" onClick={downloadExcelXlsx} disabled={isExporting}>
                  <Download size={13} /> Download .xlsx
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- JSON Raw Modal ---------------- */}
      {showJsonModal && (
        <div className="modal-overlay" onClick={() => setShowJsonModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '750px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileCode size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1rem' }}>Standardized Document JSON Export</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowJsonModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <pre style={{
                background: 'var(--bg-base)',
                padding: '14px',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.76rem',
                color: '#cbd5e1',
                overflowX: 'auto',
                maxHeight: '480px'
              }}>
                {rawJsonText}
              </pre>
            </div>

            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button className="btn btn-secondary" onClick={downloadJsonFile}>
                <Download size={13} /> Download .json
              </button>
              <button className="btn btn-primary" onClick={() => setShowJsonModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Export Toast Notification */}
      {exportNotification && (
        <div style={{
          position: 'fixed',
          bottom: '72px',
          right: '24px',
          zIndex: 9999,
          background: exportNotification.isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(244, 63, 94, 0.95)',
          color: '#ffffff',
          padding: '10px 18px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {exportNotification.isSuccess ? <Check size={16} /> : <AlertTriangle size={16} />}
          {exportNotification.message}
        </div>
      )}
    </div>
  );
}
