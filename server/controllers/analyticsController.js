const { sendError } = require("../utils/sendError");
const { AnalyticsError } = require("../services/analytics/errors");
const { parseAnalyticsFilter } = require("../services/analytics/filters");
const { loadCatalog, getFilterOptions } = require("../services/analytics/catalog");
const { getAnalyticsSummary } = require("../services/analytics/summaryStats");

// A rejected filter or period answers 4xx with a stable code; anything else is a 500.
const respondError = (res, error, fallback) => {
  if (error instanceof AnalyticsError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  return sendError(res, error, fallback);
};

// GET /admin/analytics/filter-options
exports.getAnalyticsFilterOptions = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getFilterOptions());
  } catch (error) {
    return respondError(res, error, "Failed to load filter options");
  }
};

// GET /admin/analytics/summary?section=jobs|employers|applicants&...filters
exports.getAnalyticsSummary = async (req, res) => {
  try {
    const section = typeof req.query.section === "string" ? req.query.section : "";
    const catalog = await loadCatalog();
    const parsed = parseAnalyticsFilter(req.query, { section, catalog });
    res.set("Cache-Control", "no-store");
    return res.json(await getAnalyticsSummary(parsed));
  } catch (error) {
    return respondError(res, error, "Failed to load statistics");
  }
};

const { getEmployerRanking, getEmployerPerformanceDetail } = require("../services/analytics/employerPerformance");
const { getAnalyticsOverview, getDashboardOverview } = require("../services/analytics/overviewStats");

// GET /admin/analytics/dashboard: live numbers for "what needs a person today" (no date filter).
exports.getDashboard = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getDashboardOverview());
  } catch (error) {
    return respondError(res, error, "Failed to load the dashboard");
  }
};

// GET /admin/analytics/overview?period=7d|30d|90d|12m|custom&from=&to=&municipality=
exports.getOverview = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getAnalyticsOverview(req.query));
  } catch (error) {
    return respondError(res, error, "Failed to load the analytics");
  }
};

// GET /admin/analytics/performance/employers?period=quarter|year&year=&quarter=&limit=
exports.getEmployerPerformance = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getEmployerRanking(req.query));
  } catch (error) {
    return respondError(res, error, "Failed to load employer performance");
  }
};

// GET /admin/analytics/performance/employers/:employerId
exports.getEmployerPerformanceDetail = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(await getEmployerPerformanceDetail(req.params.employerId, req.query));
  } catch (error) {
    return respondError(res, error, "Failed to load employer performance");
  }
};
