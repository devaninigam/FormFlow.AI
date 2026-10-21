/**
 * JSON Document Generator
 * Outputs clean, standardized document analysis data
 */
class JsonExporter {
  static formatJson(docData) {
    const fields = (docData.fields || []).map(f => ({
      id: f.id,
      label: f.label || '',
      value: f.value !== undefined ? f.value : '',
      originalOcrValue: f.originalOcrValue !== undefined ? f.originalOcrValue : f.value,
      page: f.page || 1,
      confidence: Number((f.confidence || 0).toFixed(4)),
      verified: !!f.verified,
      type: f.type || 'text',
      isHandwritten: f.isHandwritten !== undefined ? f.isHandwritten : true,
      bounds: f.bounds || { x: 0, y: 0, width: 0, height: 0 },
      ...(f.labelBounds ? { labelBounds: f.labelBounds } : {})
    }));

    const verifiedCount = fields.filter(f => f.verified).length;
    const allVerified = fields.length > 0 && verifiedCount === fields.length;

    // Clean page metadata WITHOUT raw binary image buffers
    const pages = (docData.pages || []).map(p => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
      pdfPointsWidth: p.pdfPointsWidth,
      pdfPointsHeight: p.pdfPointsHeight,
      originalType: p.originalType
    }));

    return {
      document: {
        id: docData.id,
        filename: docData.filename,
        pageCount: docData.pageCount || pages.length || 1,
        pages,
        engineUsed: docData.engineUsed || 'builtin',
        status: allVerified ? 'verified' : (docData.status || 'needs_review'),
        extractedAt: docData.extractedAt || new Date().toISOString(),
        summary: {
          totalFields: fields.length,
          verifiedCount,
          highConfidenceCount: fields.filter(f => f.confidence >= 0.85).length,
          needsReviewCount: fields.filter(f => f.confidence < 0.85 && f.confidence >= 0.50).length,
          unreadableCount: fields.filter(f => f.confidence < 0.50 || f.isUnreadable).length,
          tablesCount: (docData.tables || []).length
        }
      },
      fields,
      tables: docData.tables || []
    };
  }
}

module.exports = JsonExporter;
