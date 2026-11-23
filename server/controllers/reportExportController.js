const { sendError } = require("../utils/sendError");
const { AnalyticsError } = require("../services/analytics/errors");
const service = require("../services/reports/reportService");

const respondError = (res, error, fallback) => {
  if (error instanceof AnalyticsError) return res.status(error.status).json({ message: error.message, code: error.code });
  return sendError(res, error, fallback);
};

// Sends the file. Nothing is sent unless the audit entry and the history row were written.
const sendFile = (res, result) => {
  res.set({
    "Content-Type": result.contentType,
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "X-Report-Id": result.reportId,
    "X-Record-Count": String(result.recordCount),
    // Lets the browser client read the report ID and name of the file it just downloaded.
    "Access-Control-Expose-Headers": "X-Report-Id, X-Record-Count, Content-Disposition",
    "Cache-Control": "no-store",
  });
  return res.send(result.bytes);
};

// GET /admin/report-exports/catalog
exports.getCatalog = (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(service.catalogForRole(req.user.role));
};

// POST /admin/report-exports/preview
exports.previewReport = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await service.previewReport(req.user, req.body));
  } catch (error) {
    return respondError(res, error, "Failed to preview the report");
  }
};

// POST /admin/report-exports
exports.generateReport = async (req, res) => {
  try {
    return sendFile(res, await service.generateReport(req.user, req.body, { req }));
  } catch (error) {
    return respondError(res, error, "Failed to generate the report");
  }
};

// GET /admin/report-exports
exports.listReports = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await service.listReports(req.user, req.query));
  } catch (error) {
    return respondError(res, error, "Failed to load report history");
  }
};

// GET /admin/report-exports/:reportId
exports.getReport = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await service.getReport(req.user, req.params.reportId));
  } catch (error) {
    return respondError(res, error, "Failed to load the report");
  }
};

// POST /admin/report-exports/:reportId/regenerate
exports.regenerateReport = async (req, res) => {
  try {
    return sendFile(res, await service.regenerateReport(req.user, req.params.reportId, { req }));
  } catch (error) {
    return respondError(res, error, "Failed to regenerate the report");
  }
};
