const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const { getApplicationCountMap, normalizeFeaturedOrdering } = require("../utils/jobDisplay");

const monthBuckets = () => Array.from({ length: 12 }, () => 0);

const normalizeApplicationStatus = (status = "") => {
  const value = String(status || "").toLowerCase();
  if (value === "accepted") return "hired";
  if (["pending", "reviewed", "shortlisted", "rejected", "hired"].includes(value)) {
    return value;
  }
  return null;
};

exports.getAdminAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);

    const [
      totalAccounts,
      totalEmployers,
      totalJobSeekers,
      totalVacancies,
      totalApplications,
      verifiedEmployers,
      pendingVerification,
      activeJobs,
      closedJobs,
      yearlyApplications,
      yearlyRegistrations,
      applications,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "employer" }),
      User.countDocuments({ role: "resident" }),
      JobVacancy.countDocuments(),
      JobApplication.countDocuments(),
      User.countDocuments({ role: "employer", verificationStatus: "verified" }),
      User.countDocuments({ role: "employer", verificationStatus: "pending" }),
      JobVacancy.countDocuments({ status: "active" }),
      JobVacancy.countDocuments({ status: "closed" }),
      JobApplication.find({ createdAt: { $gte: startOfYear, $lt: startOfNextYear } }).select("createdAt appliedAt"),
      User.find({ createdAt: { $gte: startOfYear, $lt: startOfNextYear } }).select("createdAt"),
      JobApplication.find().select("status"),
    ]);

    const applicationsThisMonth = monthBuckets();
    yearlyApplications.forEach((item) => {
      const sourceDate = item.createdAt || item.appliedAt;
      if (!sourceDate) return;
      applicationsThisMonth[new Date(sourceDate).getMonth()] += 1;
    });

    const registrationsThisMonth = monthBuckets();
    yearlyRegistrations.forEach((item) => {
      if (!item.createdAt) return;
      registrationsThisMonth[new Date(item.createdAt).getMonth()] += 1;
    });

    const applicationsByStatus = {
      pending: 0,
      reviewed: 0,
      shortlisted: 0,
      rejected: 0,
      hired: 0,
    };

    applications.forEach((item) => {
      const normalized = normalizeApplicationStatus(item.status);
      if (normalized) {
        applicationsByStatus[normalized] += 1;
      }
    });

    return res.json({
      totalAccounts,
      totalEmployers,
      totalJobSeekers,
      totalVacancies,
      totalApplications,
      verifiedEmployers,
      pendingVerification,
      activeJobs,
      closedJobs,
      applicationsThisMonth,
      registrationsThisMonth,
      applicationsByStatus,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch analytics" });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const role = String(req.query.role || "").trim();
    const search = String(req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);

    const filter = {};

    if (["employer", "resident", "admin"].includes(role)) {
      filter.role = role;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name email role createdAt hasCompletedOnboarding verificationStatus isActive")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      users,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      currentPage: page,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch users" });
  }
};

exports.getHomepageJobManagement = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ isActive: true, status: { $ne: "closed" } })
      .populate("employer", "name email companyName verificationStatus")
      .sort({ createdAt: -1 });

    const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
    const jobsWithCounts = jobs.map((job) => ({
      ...job.toObject(),
      applicationCount: Number(countMap[String(job._id)] || 0),
    }));

    const rankedJobs = [...jobsWithCounts].sort((left, right) => {
      if (right.applicationCount !== left.applicationCount) {
        return right.applicationCount - left.applicationCount;
      }

      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

    return res.json({
      jobs: jobsWithCounts,
      rankedJobs,
      featuredCount: jobsWithCounts.filter((job) => job.isFeatured).length,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch homepage job management data" });
  }
};

exports.toggleHomepageFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const desiredFeatured = Boolean(req.body.isFeatured);

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (!job.isActive || job.status === "closed") {
      return res.status(400).json({ message: "Only active jobs can be featured on the homepage" });
    }

    if (desiredFeatured) {
      if (!job.isFeatured) {
        const featuredCount = await JobVacancy.countDocuments({ isFeatured: true });
        if (featuredCount >= 4) {
          return res.status(400).json({ message: "You can only feature up to 4 jobs on the homepage" });
        }

        const featuredJobs = await JobVacancy.find({ isFeatured: true }).sort({ featuredOrder: 1, createdAt: -1 });
        const nextOrder = featuredJobs.length + 1;
        job.isFeatured = true;
        job.featuredOrder = nextOrder;
      }
    } else {
      job.isFeatured = false;
      job.featuredOrder = null;
    }

    job.updatedAt = new Date();
    await job.save();

    const featuredJobs = await JobVacancy.find({ isFeatured: true }).sort({ featuredOrder: 1, createdAt: -1 });
    await normalizeFeaturedOrdering(featuredJobs);

    const updatedJob = await JobVacancy.findById(id).populate("employer", "name email companyName verificationStatus");
    return res.json({
      message: desiredFeatured ? "Job featured on homepage" : "Job removed from homepage featured list",
      job: updatedJob,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update homepage feature" });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!["resident", "employer", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "admin") {
      return res.status(403).json({ message: "Cannot change role of another admin" });
    }

    user.role = role;
    await user.save();

    return res.json({
      message: "User role updated",
      user,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update role" });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: "Admin cannot deactivate their own account" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = false;
    await user.save();

    return res.json({ message: "User deactivated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to deactivate user" });
  }
};

exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = true;
    await user.save();

    return res.json({ message: "User reactivated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to reactivate user" });
  }
};

exports.updateEmployerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus } = req.body;

    if (!["unverified", "pending", "verified"].includes(verificationStatus)) {
      return res.status(400).json({ message: "Invalid verification status" });
    }

    // Use findByIdAndUpdate with $set to only update verificationStatus,
    // bypassing validation on other fields (e.g., companySize)
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { verificationStatus } },
      { new: true, runValidators: true }   // still validates the enum on verificationStatus
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "employer") {
      return res.status(400).json({ message: "Only employers can be verified" });
    }

    return res.json({ message: "Employer verification updated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update verification" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: "Admin cannot delete themselves" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const jobs = await JobVacancy.find({ employer: id }).select("_id");
    const jobIds = jobs.map((job) => job._id);

    const conversations = await Conversation.find({ participants: id }).select("_id");
    const conversationIds = conversations.map((item) => item._id);

    await Promise.all([
      JobApplication.deleteMany({
        $or: [{ applicant: id }, ...(jobIds.length ? [{ vacancy: { $in: jobIds } }] : [])],
      }),
      jobIds.length ? JobVacancy.deleteMany({ _id: { $in: jobIds } }) : Promise.resolve(),
      conversationIds.length
        ? Message.deleteMany({
            $or: [{ conversationId: { $in: conversationIds } }, { sender: id }],
          })
        : Message.deleteMany({ sender: id }),
      Conversation.deleteMany({ participants: id }),
      User.findByIdAndDelete(id),
    ]);

    return res.json({ message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete user" });
  }
};

exports.getUserProfileDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let profile = null;
    let stats = {};
    let employerJobs = [];

    if (user.role === "resident") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
      const totalApplications = await JobApplication.countDocuments({ applicant: user._id });
      stats = { totalApplications };
    }

    if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });

      const jobs = await JobVacancy.find({ employer: user._id })
        .select("title location status isActive createdAt")
        .sort({ createdAt: -1 });

      const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
      employerJobs = jobs.map((job) => ({
        ...job.toObject(),
        applicationCount: Number(countMap[String(job._id)] || 0),
      }));

      const [activeJobs, closedJobs] = await Promise.all([
        JobVacancy.countDocuments({ employer: user._id, status: { $ne: "closed" }, isActive: true }),
        JobVacancy.countDocuments({ employer: user._id, status: "closed" }),
      ]);

      const totalApplicants = employerJobs.reduce(
        (sum, job) => sum + Number(job.applicationCount || 0),
        0
      );

      stats = {
        activeJobs,
        closedJobs,
        totalApplicants,
      };
    }

    return res.json({
      user,
      profile,
      stats,
      employerJobs,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch user profile details" });
  }
};

exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await JobVacancy.findById(id);

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    await Promise.all([
      JobApplication.deleteMany({ vacancy: job._id }),
      JobVacancy.findByIdAndDelete(job._id),
    ]);

    return res.json({ message: "Job deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete job" });
  }
};

exports.updateJobStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "closed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    job.status = status;
    job.isActive = status === "active";
    job.updatedAt = new Date();

    if (status === "closed") {
      job.isFeatured = false;
      job.featuredOrder = null;
    }

    await job.save();

    return res.json({
      message: status === "closed" ? "Job closed" : "Job reopened",
      job,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update job status" });
  }
};