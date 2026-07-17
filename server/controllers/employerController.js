const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Message = require("../models/Message");
const { ensureConversationBetweenUsers } = require("./messageController");
const JobseekerProfile = require("../models/JobseekerProfile");

const getUserId = (req) => req.user._id || req.user.id;

// Helper to format qualifications for response
const formatQualifications = (qualifications) => {
  if (!qualifications || !Array.isArray(qualifications)) return [];
  return qualifications
    .filter(q => q && q.value)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

// ---------------------------------------------------------------------
// Get all jobs for the logged-in employer
// ---------------------------------------------------------------------
exports.getEmployerJobs = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const jobs = await JobVacancy.find({ employer: employerId }).sort({ createdAt: -1 });

    const jobsWithCounts = await Promise.all(
      jobs.map(async (job) => {
        const applicantCount = await JobApplication.countDocuments({ vacancy: job._id });
        const jobObj = job.toObject();
        jobObj.qualifications = formatQualifications(jobObj.qualifications);
        return {
          ...jobObj,
          applicantCount,
        };
      })
    );

    return res.json(jobsWithCounts);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch employer jobs" });
  }
};

// ---------------------------------------------------------------------
// Create a new job
// ---------------------------------------------------------------------
exports.createJob = async (req, res) => {
  try {
    const employerId = getUserId(req);
    const { title, location, description, salary, qualifications, jobType, slots, applicationDeadline } = req.body;

    if (!title || !location || !description) {
      return res.status(400).json({ message: "title, location, and description are required" });
    }

    // Parse qualifications from JSON string if needed
    let parsedQualifications = [];
    if (qualifications) {
      try {
        parsedQualifications = typeof qualifications === "string" 
          ? JSON.parse(qualifications) 
          : qualifications;
      } catch (e) {
        return res.status(400).json({ message: "Invalid qualifications format" });
      }
    }

    // Validate qualifications
    if (!Array.isArray(parsedQualifications)) {
      return res.status(400).json({ message: "Qualifications must be an array" });
    }

    // Set order if not provided
    const processedQualifications = parsedQualifications.map((q, index) => ({
      ...q,
      order: q.order !== undefined ? q.order : index,
    }));

    const job = await JobVacancy.create({
      title: String(title).trim(),
      location: String(location).trim(),
      description: String(description).trim(),
      salary: salary ? String(salary).trim() : "",
      qualifications: processedQualifications,
      jobType: jobType || "Full-time",
      slots: Number(slots) > 0 ? Number(slots) : 1,
      applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
      employer: employerId,
      status: "active",
      isActive: true,
      updatedAt: new Date(),
    });

    const jobObj = job.toObject();
    jobObj.qualifications = formatQualifications(jobObj.qualifications);

    return res.status(201).json(jobObj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create job" });
  }
};

// ---------------------------------------------------------------------
// Update an existing job
// ---------------------------------------------------------------------
exports.updateJob = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { id } = req.params;

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (String(job.employer) !== employerId) {
      return res.status(403).json({ message: "You can only update your own job" });
    }

    // Parse qualifications from JSON string if needed
    let parsedQualifications = undefined;
    if (req.body.qualifications !== undefined) {
      try {
        parsedQualifications = typeof req.body.qualifications === "string" 
          ? JSON.parse(req.body.qualifications) 
          : req.body.qualifications;
      } catch (e) {
        return res.status(400).json({ message: "Invalid qualifications format" });
      }
      
      if (!Array.isArray(parsedQualifications)) {
        return res.status(400).json({ message: "Qualifications must be an array" });
      }
      
      parsedQualifications = parsedQualifications.map((q, index) => ({
        ...q,
        order: q.order !== undefined ? q.order : index,
      }));
    }

    const allowedFields = ["title", "location", "description", "salary", "jobType", "slots", "status", "applicationDeadline"];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        job[field] = req.body[field];
      }
    });

    if (req.body.qualifications !== undefined) {
      job.qualifications = parsedQualifications;
    }

    if (req.body.status === "closed") {
      job.isActive = false;
    }
    if (req.body.status === "active") {
      job.isActive = true;
    }

    job.updatedAt = new Date();

    await job.save();
    const jobObj = job.toObject();
    jobObj.qualifications = formatQualifications(jobObj.qualifications);

    return res.json(jobObj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update job" });
  }
};

// ---------------------------------------------------------------------
// Permanently delete a job and its applications
// ---------------------------------------------------------------------
exports.deleteJob = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { id } = req.params;

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (String(job.employer) !== employerId) {
      return res.status(403).json({ message: "You can only delete your own job" });
    }

    // Delete all applications for this job
    await JobApplication.deleteMany({ vacancy: id });

    // Delete the job itself
    await JobVacancy.findByIdAndDelete(id);

    return res.json({ message: "Job permanently deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete job" });
  }
};

// ---------------------------------------------------------------------
// Get applicants for a specific job (with jobseeker profiles)
// ---------------------------------------------------------------------
exports.getApplicantsForJob = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { jobId } = req.params;

    const job = await JobVacancy.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (String(job.employer) !== employerId) {
      return res.status(403).json({ message: "You can only view applicants for your own jobs" });
    }

    const applications = await JobApplication.find({ vacancy: jobId })
      .populate("applicant", "name email phone address skills resume resumeFile validIdFile")
      .sort({ createdAt: -1 });

    // Fetch jobseeker profiles for all applicants
    const applicantIds = applications.map(app => app.applicant?._id).filter(Boolean);
    const profiles = await JobseekerProfile.find({ userId: { $in: applicantIds } });
    const profileMap = profiles.reduce((map, profile) => {
      map[String(profile.userId)] = profile;
      return map;
    }, {});

    // Merge profile into each application
    const mergedApplications = applications.map(app => {
      const appObj = app.toObject();
      const applicant = appObj.applicant;
      if (applicant) {
        const profile = profileMap[String(applicant._id)];
        if (profile) {
          applicant.profile = profile;
        }
      }
      return appObj;
    });

    return res.json(mergedApplications);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch applicants" });
  }
};

// ---------------------------------------------------------------------
// Update application status (and auto-start conversation)
// ---------------------------------------------------------------------
exports.updateApplicationStatus = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { applicationId } = req.params;
    const { status, employerNote } = req.body;

    const allowed = ["pending", "reviewed", "shortlisted", "rejected", "hired"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const application = await JobApplication.findById(applicationId)
      .populate("vacancy", "title employer")
      .populate("applicant", "name");
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (!application.vacancy || String(application.vacancy.employer) !== employerId) {
      return res.status(403).json({ message: "You can only update applications for your own jobs" });
    }

    application.status = status;
    if (typeof employerNote === "string") {
      application.employerNote = employerNote;
    }
    application.statusUpdatedAt = new Date();

    await application.save();

    if (["reviewed", "shortlisted", "hired"].includes(status)) {
      const conversation = await ensureConversationBetweenUsers(employerId, application.applicant);

      const hasExistingMessage = await Message.exists({ conversationId: conversation._id });
      if (!hasExistingMessage) {
        const applicantName = application.applicant?.name || "there";
        const jobTitle = application.vacancy?.title || "this role";
        const autoContent = `Hi ${applicantName}, we've reviewed your application for ${jobTitle}. We'd like to get in touch with you.`;

        const autoMessage = await Message.create({
          conversationId: conversation._id,
          sender: employerId,
          content: autoContent,
          isRead: false,
        });

        conversation.lastMessage = autoMessage.content;
        conversation.lastMessageAt = autoMessage.createdAt;
        await conversation.save();

        const io = req.app.get("io");
        if (io) {
          io.to(String(conversation._id)).emit("receive_message", {
            _id: autoMessage._id,
            conversationId: conversation._id,
            sender: employerId,
            content: autoMessage.content,
            createdAt: autoMessage.createdAt,
            isRead: false,
          });
        }
      }
    }

    // Refetch with full details and profile
    const updatedApplication = await JobApplication.findById(applicationId)
      .populate("applicant", "name email phone address skills resume resumeFile validIdFile")
      .populate("vacancy", "title location");

    if (updatedApplication.applicant) {
      const profile = await JobseekerProfile.findOne({ userId: updatedApplication.applicant._id });
      if (profile) {
        const appObj = updatedApplication.toObject();
        appObj.applicant.profile = profile;
        return res.json(appObj);
      }
    }

    return res.json(updatedApplication);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update application status" });
  }
};

// ---------------------------------------------------------------------
// Employer dashboard statistics
// ---------------------------------------------------------------------
exports.getEmployerStats = async (req, res) => {
  try {
    const employerId = getUserId(req);

    const jobs = await JobVacancy.find({ employer: employerId }).select("_id status");
    const jobIds = jobs.map((job) => job._id);

    const [totalApplicants, pendingReview, shortlisted, hired] = await Promise.all([
      JobApplication.countDocuments({ vacancy: { $in: jobIds } }),
      JobApplication.countDocuments({
        vacancy: { $in: jobIds },
        status: { $in: ["pending", "Applied"] },
      }),
      JobApplication.countDocuments({
        vacancy: { $in: jobIds },
        status: "shortlisted",
      }),
      JobApplication.countDocuments({
        vacancy: { $in: jobIds },
        status: { $in: ["hired", "Accepted"] },
      }),
    ]);

    const totalJobs = jobs.length;
    const activeJobs = jobs.filter((job) => job.status !== "closed").length;

    return res.json({
      totalJobs,
      activeJobs,
      totalApplicants,
      pendingReview,
      shortlisted,
      hired,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch employer stats" });
  }
};

// ---------------------------------------------------------------------
// Employer profile statistics (for onboarding/progress)
// ---------------------------------------------------------------------
exports.getEmployerProfileStats = async (req, res) => {
  try {
    const employerId = getUserId(req);

    const jobs = await JobVacancy.find({ employer: employerId }).select("_id status");
    const jobIds = jobs.map((job) => job._id);

    const totalApplicants = await JobApplication.countDocuments({ vacancy: { $in: jobIds } });
    const activeJobs = jobs.filter((job) => job.status !== "closed").length;
    const closedJobs = jobs.filter((job) => job.status === "closed").length;

    return res.json({
      activeJobs,
      totalApplicants,
      closedJobs,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch employer profile stats" });
  }
};