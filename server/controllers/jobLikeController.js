const JobLike = require("../models/JobLike");
const JobVacancy = require("../models/JobVacancy");

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

    // Check if already liked
    const existingLike = await JobLike.findOne({ userId, jobId });
    if (existingLike) {
      return res.status(400).json({ error: "Already liked this job" });
    }

    // Create like
    await JobLike.create({ userId, jobId });

    // Get updated like count
    const likeCount = await JobLike.countDocuments({ jobId });

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
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total liked jobs count
    const totalLikes = await JobLike.countDocuments({ userId });

    // Get paginated liked jobs
    const likedJobs = await JobLike.find({ userId })
      .populate({
        path: "jobId",
        select: "title description company location salary workNature industry qualifications postedAt"
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
