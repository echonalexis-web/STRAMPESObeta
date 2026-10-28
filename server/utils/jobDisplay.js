const JobApplication = require("../models/JobApplication");

const toPlainObject = (value) => {
  if (!value) return value;
  if (typeof value.toObject === "function") {
    return value.toObject();
  }
  return value;
};

const getApplicationCountMap = async (jobIds = []) => {
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return {};
  }

  const aggregateRows = await JobApplication.aggregate([
    { $match: { vacancy: { $in: jobIds } } },
    { $group: { _id: "$vacancy", total: { $sum: 1 } } },
  ]);

  return aggregateRows.reduce((accumulator, row) => {
    accumulator[String(row._id)] = Number(row.total || 0);
    return accumulator;
  }, {});
};

// "Accepted" is a legacy casing of "hired" some older rows may still carry
// (see server/models/JobApplication.js) — matched defensively here the same
// way the rest of the codebase already does for this exact pair.
const getHiredCountMap = async (jobIds = []) => {
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return {};
  }

  const aggregateRows = await JobApplication.aggregate([
    { $match: { vacancy: { $in: jobIds }, status: { $in: ["hired", "Accepted"] } } },
    { $group: { _id: "$vacancy", total: { $sum: 1 } } },
  ]);

  return aggregateRows.reduce((accumulator, row) => {
    accumulator[String(row._id)] = Number(row.total || 0);
    return accumulator;
  }, {});
};

const attachApplicationCounts = (jobs, countMap = {}, hiredCountMap = {}) =>
  jobs.map((job) => {
    const plainJob = toPlainObject(job);
    const hiredCount = Number(hiredCountMap[String(plainJob._id)] || 0);
    return {
      ...plainJob,
      applicationCount: Number(countMap[String(plainJob._id)] || 0),
      remainingSlots: Math.max(0, Number(plainJob.slots || 0) - hiredCount),
    };
  });

const sortByFeaturedThenRecent = (jobs = [], limit = 4) => {
  const featuredJobs = jobs
    .filter((job) => job.isFeatured)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.featuredOrder)) ? Number(left.featuredOrder) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right.featuredOrder)) ? Number(right.featuredOrder) : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

  const featuredIds = new Set(featuredJobs.map((job) => String(job._id)));
  const recentJobs = jobs
    .filter((job) => !featuredIds.has(String(job._id)))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

  return [...featuredJobs, ...recentJobs].slice(0, limit);
};

const normalizeFeaturedOrdering = async (jobs = []) => {
  const featuredJobs = jobs
    .filter((job) => job.isFeatured)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.featuredOrder)) ? Number(left.featuredOrder) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right.featuredOrder)) ? Number(right.featuredOrder) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

  await Promise.all(
    featuredJobs.map((job, index) => {
      job.isFeatured = true;
      job.featuredOrder = index + 1;
      return job.save();
    })
  );
};

const getHomepageJobsPayload = async (jobs, limit = 4) => {
  const jobIds = jobs.map((job) => job._id);
  const orderedJobs = sortByFeaturedThenRecent(jobs, limit);
  const orderedIds = orderedJobs.map((job) => job._id);
  const [countMap, hiredCountMap] = await Promise.all([
    getApplicationCountMap(orderedIds),
    getHiredCountMap(orderedIds),
  ]);

  return attachApplicationCounts(orderedJobs, countMap, hiredCountMap);
};

module.exports = {
  attachApplicationCounts,
  getApplicationCountMap,
  getHiredCountMap,
  getHomepageJobsPayload,
  normalizeFeaturedOrdering,
  sortByFeaturedThenRecent,
};