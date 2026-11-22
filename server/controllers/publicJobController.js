// Public job list and detail for signed-out visitors (see services/publicJobsService.js).
// Responses are never cached: a job that is closed, archived, expired or unlisted must
// stop appearing at once, so every response says `Cache-Control: no-store`.
const logger = require("../utils/logger");
const { parsePublicQuery, searchPublicJobs, findPublicJob } = require("../services/publicJobsService");

const noStore = (res) => res.set("Cache-Control", "no-store");

// GET /jobs/public
exports.listPublicJobs = async (req, res) => {
  try {
    noStore(res);
    const parsed = await parsePublicQuery(req.query);
    if (parsed.error) return res.status(400).json(parsed.error);
    return res.json(await searchPublicJobs(parsed));
  } catch (error) {
    logger.error("Public jobs list error:", error.message);
    return res.status(500).json({ message: "Failed to fetch jobs" });
  }
};

// GET /jobs/public/:id. A job that is not publicly available answers exactly like one
// that does not exist.
exports.getPublicJob = async (req, res) => {
  try {
    noStore(res);
    const job = await findPublicJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json(job);
  } catch (error) {
    logger.error("Public job detail error:", error.message);
    return res.status(500).json({ message: "Failed to fetch job" });
  }
};
