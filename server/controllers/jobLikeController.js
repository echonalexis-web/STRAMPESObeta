const JobLike = require("../models/JobLike");
const JobVacancy = require("../models/JobVacancy");
const User = require("../models/User");
const { notifyLike } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { withListedEmployers } = require("../utils/jobVisibility");

// Like a job
exports.likeJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Check if job exists
    const job = await JobVacancy.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    // A job of a suspended or deactivated employer is unlisted: same answer as a missing job.
    const listed = await JobVacancy.countDocuments(await withListedEmployers({ _id: job._id }));
    if (!listed) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Check if already liked
    const existingLike = await JobLike.findOne({ userId, jobId });
    if (existingLike) {
      return res.status(400).json({ error: "Already liked this job" });
    }

    // Create like
    await JobLike.create({ userId, jobId });

    // Get updated like count
    const likeCount = await JobLike.countDocuments({ jobId });

    const liker = await User.findById(userId).select("name");
    await notifyLike({
      recipientId: job.employer,
      actorId: userId,
      actorName: liker?.name || "Someone",
      relatedEntityType: "job",
      relatedEntityId: jobId,
      itemLabel: `your job posting "${job.title}"`,
      actionUrl: "/employer",
      io: req.app.get("io"),
    });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "social.job.liked",
      targetType: "job",
      targetId: String(jobId),
      severity: "info",
    });

    res.status(201).json({
      success: true,
      message: "Job liked successfully",
      data: {
        jobId,
        likeCount
      }
    });
  } catch (error) {
    console.error("Like job error:", error);
    res.status(500).json({ error: "Failed to like job" });
  }
};

// Unlike a job
exports.unlikeJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const jobLike = await JobLike.findOneAndDelete({ userId, jobId });

    if (!jobLike) {
      return res.status(404).json({ error: "Like not found" });
    }

    // Get updated like count
    const likeCount = await JobLike.countDocuments({ jobId });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "social.job.unliked",
      targetType: "job",
      targetId: String(jobId),
      severity: "info",
    });

    res.json({
      success: true,
      message: "Job unliked successfully",
      data: {
        jobId,
        likeCount
      }
    });
  } catch (error) {
    console.error("Unlike job error:", error);
    res.status(500).json({ error: "Failed to unlike job" });
  }
};

// Get all liked jobs for current user (with pagination)
exports.getLikedJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const skip = (page - 1) * limit;

    // Saved jobs of a suspended or deactivated employer are unlisted: they stay
    // saved (nothing is deleted) and reappear when the account is reactivated.
    const savedIds = await JobLike.find({ userId }).distinct("jobId");
    const listedIds = savedIds.length
      ? await JobVacancy.find(await withListedEmployers({ _id: { $in: savedIds } })).distinct("_id")
      : [];
    const likeFilter = { userId, jobId: { $in: listedIds } };

    // Get total liked jobs count
    const totalLikes = await JobLike.countDocuments(likeFilter);

    // Get paginated liked jobs
    const likedJobs = await JobLike.find(likeFilter)
      .populate({
        path: "jobId",
        select: "title description company location salary workNature industry qualifications postedAt employer",
        populate: {
          path: "employer",
          select: "name email companyName industry companySize website businessAddress companyDescription verificationStatus phone isActive profileImage"
        }
      })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const jobs = likedJobs.map((like) => like.jobId);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        total: totalLikes,
        page,
        limit,
        pages: Math.ceil(totalLikes / limit)
      }
    });
  } catch (error) {
    console.error("Get liked jobs error:", error);
    res.status(500).json({ error: "Failed to fetch liked jobs" });
  }
};

// Get like status for a job
exports.getJobLikeStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Check if user liked this job
    const like = await JobLike.findOne({ userId, jobId });

    // Get total likes for job
    const likeCount = await JobLike.countDocuments({ jobId });

    res.json({
      success: true,
      data: {
        isLiked: !!like,
        likeCount
      }
    });
  } catch (error) {
    console.error("Get job like status error:", error);
    res.status(500).json({ error: "Failed to fetch like status" });
  }
};

// Get like count for a specific job
exports.getJobLikeCount = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Check if job exists
    const job = await JobVacancy.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const likeCount = await JobLike.countDocuments({ jobId });

    res.json({
      success: true,
      data: { likeCount }
    });
  } catch (error) {
    console.error("Get job like count error:", error);
    res.status(500).json({ error: "Failed to fetch like count" });
  }
};
