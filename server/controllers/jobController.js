const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const User = require("../models/User");
const Message = require("../models/Message");
const { ensureConversationBetweenUsers } = require("./messageController");
const { getHomepageJobsPayload, getApplicationCountMap } = require("../utils/jobDisplay");
const fs = require("fs");
const path = require("path");

// Simple logger that uses console (no external dependency)
const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  debug: (...args) => console.debug("[DEBUG]", ...args),
};

exports.createJob = async (req, res) => {
  try {
    const { title, description, location, salary, requirements, jobType, slots, applicationDeadline } = req.body;
    if (!title || !description || !location) {
      return res.status(400).json({ message: "Title, description, and location are required" });
    }

    const job = await JobVacancy.create({
      title: String(title).trim(),
      description: String(description).trim(),
      location: String(location).trim(),
      salary: salary ? String(salary).trim() : "",
      requirements: requirements ? String(requirements).trim() : "",
      jobType: jobType || "Full-time",
      slots: Number(slots) > 0 ? Number(slots) : 1,
      applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
      employer: req.user.id,
    });

    logger.info(`Job created: ${job._id} by user ${req.user.id}`);
    res.json({ message: "Job posted successfully", job });
  } catch (error) {
    logger.error("Create job error:", { userId: req.user?.id, error: error.message });
    res.status(500).json({ 
      message: process.env.NODE_ENV === "production" 
        ? "Failed to create job posting" 
        : error.message 
    });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ isActive: true })
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone")
      .sort({ createdAt: -1 });

    const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
    const jobsWithCounts = jobs.map((job) => ({
      ...job.toObject(),
      applicationCount: Number(countMap[String(job._id)] || 0),
    }));

    res.json(jobsWithCounts);
  } catch (error) {
    logger.error("Get jobs error:", error.message);
    res.status(500).json({ message: "Failed to fetch jobs" });
  }
};

exports.getHomepageJobs = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ isActive: true, status: { $ne: "closed" } })
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone")
      .sort({ createdAt: -1 });

    const featuredJobs = await getHomepageJobsPayload(jobs, 4);
    res.json(featuredJobs);
  } catch (error) {
    logger.error("Get homepage jobs error:", error.message);
    res.status(500).json({ message: "Failed to fetch featured jobs" });
  }
};

exports.getJobById = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id)
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone");
    if (!job) return res.status(404).json({ message: "Job not found" });

    const countMap = await getApplicationCountMap([job._id]);
    res.json({
      ...job.toObject(),
      applicationCount: Number(countMap[String(job._id)] || 0),
    });
  } catch (error) {
    logger.error("Get job by ID error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch job details" });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only update your own job postings" });
    }

    const updates = {
      title: req.body.title || job.title,
      description: req.body.description || job.description,
      location: req.body.location || job.location,
      salary: req.body.salary || job.salary,
      requirements: typeof req.body.requirements === "string" ? req.body.requirements : job.requirements,
      jobType: req.body.jobType || job.jobType,
      slots: Number(req.body.slots) > 0 ? Number(req.body.slots) : job.slots,
      applicationDeadline: req.body.applicationDeadline ? new Date(req.body.applicationDeadline) : job.applicationDeadline,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : job.isActive,
    };

    const updatedJob = await JobVacancy.findByIdAndUpdate(req.params.id, updates, { new: true });
    logger.info(`Job updated: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job updated", job: updatedJob });
  } catch (error) {
    logger.error("Update job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ 
      message: process.env.NODE_ENV === "production" 
        ? "Failed to update job" 
        : error.message 
    });
  }
};

exports.deleteJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only delete your own job postings" });
    }

    await JobVacancy.findByIdAndDelete(req.params.id);
    logger.info(`Job deleted: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job posting removed" });
  } catch (error) {
    logger.error("Delete job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to delete job" });
  }
};

exports.applyToJob = async (req, res) => {
  let uploadedFile = req.file;
  const session = await JobApplication.startSession();

  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) {
      // Clean up uploaded file if job not found
      if (uploadedFile && fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
        logger.info(`Cleaned up orphan file: ${uploadedFile.path}`);
      }
      return res.status(404).json({ message: "Job not found" });
    }

    session.startTransaction();

    // Check for existing application with write lock
    const existingApplication = await JobApplication.findOne({
      applicant: req.user.id,
      vacancy: job._id,
    }).session(session);

    if (existingApplication) {
      // Clean up uploaded file
      if (uploadedFile && fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "You have already applied to this job" });
    }

    // Create application
    const application = await JobApplication.create([{
      applicant: req.user.id,
      vacancy: job._id,
      resume: req.file ? req.file.path : undefined,
      coverLetter: req.body.coverLetter || "",
    }], { session });

    await session.commitTransaction();
    session.endSession();

    logger.info(`Application submitted: ${application[0]._id} for job ${job._id} by user ${req.user.id}`);
    res.json({ message: "Application submitted successfully", application: application[0] });
  } catch (error) {
    // Clean up uploaded file on error
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      try {
        fs.unlinkSync(uploadedFile.path);
        logger.info(`Cleaned up orphan file on error: ${uploadedFile.path}`);
      } catch (unlinkError) {
        logger.error("Failed to delete uploaded file:", unlinkError);
      }
    }

    await session.abortTransaction();
    session.endSession();

    logger.error("Application submission error:", { 
      userId: req.user?.id, 
      jobId: req.params.id, 
      error: error.message,
      stack: error.stack 
    });

    res.status(500).json({ 
      message: process.env.NODE_ENV === "production" 
        ? "Failed to submit application. Please try again later." 
        : error.message 
    });
  }
};

exports.getApplicationsForJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const applications = await JobApplication.find({ vacancy: job._id })
      .populate("applicant", "name email about")
      .sort({ appliedAt: -1 });

    if (String(job.employer) === String(req.user.id)) {
      for (const application of applications) {
        const conversation = await ensureConversationBetweenUsers(req.user.id, application.applicant?._id);
        const hasExistingMessage = await Message.exists({ conversationId: conversation._id });

        if (!hasExistingMessage) {
          const applicantName = application.applicant?.name || "there";
          const autoContent = `Hi ${applicantName}, we've reviewed your application for ${job.title}. We'd like to get in touch with you.`;

          const autoMessage = await Message.create({
            conversationId: conversation._id,
            sender: req.user.id,
            content: autoContent,
            isRead: false,
          });

          conversation.lastMessage = autoMessage.content;
          conversation.lastMessageAt = autoMessage.createdAt;
          await conversation.save();
        }
      }
    }

    res.json(applications);
  } catch (error) {
    logger.error("Get applications error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch applications" });
  }
};

exports.getMyApplications = async (req, res) => {
  try {
    const applications = await JobApplication.find({ applicant: req.user.id })
      .populate({
        path: "vacancy",
        select: "title location employer",
        populate: {
          path: "employer",
          select: "name email companyName",
        },
      })
      .sort({ appliedAt: -1 });

    const normalized = await Promise.all(
      applications.map(async (application) => {
        const data = application.toObject();
        const vacancy = data?.vacancy;

        if (!vacancy) {
          return data;
        }

        const employerValue = vacancy.employer;
        const alreadyPopulated = employerValue && typeof employerValue === "object" && employerValue.name;

        if (alreadyPopulated) {
          return data;
        }

        const employerId =
          typeof employerValue === "string"
            ? employerValue
            : employerValue?._id
              ? String(employerValue._id)
              : null;

        if (!employerId) {
          vacancy.employer = { name: "Unknown", companyName: "No company name" };
          return data;
        }

        const employerProfile = await User.findById(employerId).select("name email companyName").lean();
        vacancy.employer = employerProfile || { name: "Unknown", companyName: "No company name" };

        return data;
      })
    );

    res.json(normalized);
  } catch (error) {
    logger.error("Get my applications error:", { userId: req.user.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch your applications" });
  }
};

exports.updateMyApplication = async (req, res) => {
  try {
    const application = await JobApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (application.applicant.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only update your own applications" });
    }

    if (typeof req.body.coverLetter === "string") {
      application.coverLetter = req.body.coverLetter;
    }

    if (req.file) {
      // Delete old resume if exists
      if (application.resume && fs.existsSync(application.resume)) {
        try {
          fs.unlinkSync(application.resume);
        } catch (unlinkError) {
          logger.error("Failed to delete old resume:", unlinkError);
        }
      }
      application.resume = req.file.path;
    }

    await application.save();

    const populated = await JobApplication.findById(application._id)
      .populate({
        path: "vacancy",
        select: "title location employer",
        populate: {
          path: "employer",
          select: "name email companyName",
        },
      });

    const normalizedApplication = populated?.toObject ? populated.toObject() : populated;
    if (normalizedApplication?.vacancy) {
      const employerValue = normalizedApplication.vacancy.employer;
      const alreadyPopulated = employerValue && typeof employerValue === "object" && employerValue.name;

      if (!alreadyPopulated) {
        const employerId =
          typeof employerValue === "string"
            ? employerValue
            : employerValue?._id
              ? String(employerValue._id)
              : null;

        if (employerId) {
          const employerProfile = await User.findById(employerId).select("name email companyName").lean();
          normalizedApplication.vacancy.employer = employerProfile || { name: "Unknown", companyName: "No company name" };
        }
      }
    }

    logger.info(`Application updated: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Application updated successfully", application: normalizedApplication });
  } catch (error) {
    logger.error("Update application error:", { applicationId: req.params.id, error: error.message });
    res.status(500).json({ 
      message: process.env.NODE_ENV === "production" 
        ? "Failed to update application" 
        : error.message 
    });
  }
};

exports.deleteMyApplication = async (req, res) => {
  try {
    const application = await JobApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (application.applicant.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only delete your own applications" });
    }

    // Delete resume file if exists
    if (application.resume && fs.existsSync(application.resume)) {
      try {
        fs.unlinkSync(application.resume);
      } catch (unlinkError) {
        logger.error("Failed to delete resume on application deletion:", unlinkError);
      }
    }

    await JobApplication.findByIdAndDelete(application._id);
    logger.info(`Application deleted: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Application withdrawn successfully", id: application._id });
  } catch (error) {
    logger.error("Delete application error:", { applicationId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to delete application" });
  }
};

exports.getEmployerJobs = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ employer: req.user.id }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    logger.error("Get employer jobs error:", { userId: req.user.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch your jobs" });
  }
};