const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const User = require("../models/User");
const Message = require("../models/Message");
const { ensureConversationBetweenUsers } = require("./messageController");
const { getHomepageJobsPayload, getApplicationCountMap } = require("../utils/jobDisplay");
const EmployerProfile = require("../models/EmployerProfile");
const { createNotificationForUser } = require("../services/notificationService");
const fs = require("fs");
const path = require("path");

// Simple logger
const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  debug: (...args) => console.debug("[DEBUG]", ...args),
};

// Helper to check if a job is past its deadline
const isJobPastDeadline = (job) => {
  if (!job.applicationDeadline) return false;
  return new Date() > new Date(job.applicationDeadline);
};

// Helper to check if a job should be visible to jobseekers (not closed and not past deadline)
const isJobVisibleToJobseekers = (job) => {
  // Job must be active and not closed
  if (job.status === "closed") return false;
  
  // Job must not be past its deadline
  if (isJobPastDeadline(job)) return false;
  
  // Job must not be archived
  if (job.archived) return false;
  
  return true;
};

// Helper to format qualifications for response
const formatQualifications = (qualifications) => {
  if (!qualifications || !Array.isArray(qualifications)) return [];
  return qualifications
    .filter(q => q && q.value)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

// ---------------------------------------------------------------------
// Create a job (employer only)
// ---------------------------------------------------------------------
exports.createJob = async (req, res) => {
  try {
    const { title, description, location, salary, qualifications, jobType, slots, applicationDeadline } = req.body;
    if (!title || !description || !location) {
      return res.status(400).json({ message: "Title, description, and location are required" });
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
      description: String(description).trim(),
      location: String(location).trim(),
      salary: salary ? String(salary).trim() : "",
      qualifications: processedQualifications,
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

// ---------------------------------------------------------------------
// Get all active jobs (public) – with employer profiles
// Filters out closed jobs and jobs past their deadline
// Also filters out jobs where the user has applied and been hired
// ---------------------------------------------------------------------
exports.getJobs = async (req, res) => {
  try {
    let jobs = await JobVacancy.find({ isActive: true })
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone")
      .sort({ createdAt: -1 });

    // Filter out closed, expired, and archived jobs
    jobs = jobs.filter(job => isJobVisibleToJobseekers(job));

    // If user is logged in as a jobseeker, filter out jobs where they've been hired
    if (req.user && req.user.role === "resident") {
      const userHiredJobs = await JobApplication.find({
        applicant: req.user.id,
        status: { $in: ["hired", "Accepted"] }
      }).select("vacancy");
      
      const hiredJobIds = new Set(userHiredJobs.map(app => String(app.vacancy)));
      jobs = jobs.filter(job => !hiredJobIds.has(String(job._id)));
    }

    // Fetch employer profiles
    const employerIds = jobs.map(job => job.employer?._id).filter(Boolean);
    const profiles = await EmployerProfile.find({ userId: { $in: employerIds } });
    const profileMap = profiles.reduce((map, p) => {
      map[String(p.userId)] = p;
      return map;
    }, {});

    const countMap = await getApplicationCountMap(jobs.map((job) => job._id));
    const jobsWithCounts = jobs.map((job) => {
      const jobObj = job.toObject();
      const employer = jobObj.employer;
      if (employer && profileMap[String(employer._id)]) {
        employer.profile = profileMap[String(employer._id)];
      }
      jobObj.applicationCount = Number(countMap[String(job._id)] || 0);
      jobObj.qualifications = formatQualifications(jobObj.qualifications);
      return jobObj;
    });

    res.json(jobsWithCounts);
  } catch (error) {
    logger.error("Get jobs error:", error.message);
    res.status(500).json({ message: "Failed to fetch jobs" });
  }
};

// ---------------------------------------------------------------------
// Get featured jobs for homepage (with employer profiles)
// Filters out closed jobs, jobs past deadline, and archived jobs
// Also filters out jobs where the user has applied and been hired
// ---------------------------------------------------------------------
exports.getHomepageJobs = async (req, res) => {
  try {
    let jobs = await JobVacancy.find({ isActive: true, status: { $ne: "closed" } })
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone")
      .sort({ createdAt: -1 });

    // Filter out closed, expired, and archived jobs
    jobs = jobs.filter(job => isJobVisibleToJobseekers(job));

    // If user is logged in as a jobseeker, filter out jobs where they've been hired
    if (req.user && req.user.role === "resident") {
      const userHiredJobs = await JobApplication.find({
        applicant: req.user.id,
        status: { $in: ["hired", "Accepted"] }
      }).select("vacancy");
      
      const hiredJobIds = new Set(userHiredJobs.map(app => String(app.vacancy)));
      jobs = jobs.filter(job => !hiredJobIds.has(String(job._id)));
    }

    // Attach employer profiles
    const employerIds = jobs.map(job => job.employer?._id).filter(Boolean);
    const profiles = await EmployerProfile.find({ userId: { $in: employerIds } });
    const profileMap = profiles.reduce((map, p) => {
      map[String(p.userId)] = p;
      return map;
    }, {});

    const jobsWithProfile = jobs.map(job => {
      const jobObj = job.toObject();
      const employer = jobObj.employer;
      if (employer && profileMap[String(employer._id)]) {
        employer.profile = profileMap[String(employer._id)];
      }
      jobObj.qualifications = formatQualifications(jobObj.qualifications);
      return jobObj;
    });

    const featuredJobs = await getHomepageJobsPayload(jobsWithProfile, 4);
    res.json(featuredJobs);
  } catch (error) {
    logger.error("Get homepage jobs error:", error.message);
    res.status(500).json({ message: "Failed to fetch featured jobs" });
  }
};

// ---------------------------------------------------------------------
// Get single job by ID (with employer profile)
// ---------------------------------------------------------------------
exports.getJobById = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id)
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone");
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Attach employer profile
    const jobObj = job.toObject();
    if (jobObj.employer) {
      const profile = await EmployerProfile.findOne({ userId: jobObj.employer._id });
      if (profile) {
        jobObj.employer.profile = profile;
      }
    }

    const countMap = await getApplicationCountMap([job._id]);
    jobObj.applicationCount = Number(countMap[String(job._id)] || 0);
    jobObj.qualifications = formatQualifications(jobObj.qualifications);

    res.json(jobObj);
  } catch (error) {
    logger.error("Get job by ID error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch job details" });
  }
};

// ---------------------------------------------------------------------
// Update a job (employer or admin)
// ---------------------------------------------------------------------
exports.updateJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only update your own job postings" });
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
      
      // Validate qualifications
      if (!Array.isArray(parsedQualifications)) {
        return res.status(400).json({ message: "Qualifications must be an array" });
      }
      
      // Set order if not provided
      parsedQualifications = parsedQualifications.map((q, index) => ({
        ...q,
        order: q.order !== undefined ? q.order : index,
      }));
    }

    const updates = {
      title: req.body.title || job.title,
      description: req.body.description || job.description,
      location: req.body.location || job.location,
      salary: req.body.salary || job.salary,
      jobType: req.body.jobType || job.jobType,
      slots: Number(req.body.slots) > 0 ? Number(req.body.slots) : job.slots,
      applicationDeadline: req.body.applicationDeadline ? new Date(req.body.applicationDeadline) : job.applicationDeadline,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : job.isActive,
      // Only update qualifications if provided
      qualifications: parsedQualifications !== undefined ? parsedQualifications : job.qualifications,
    };

    // Keep legacy requirements for backward compatibility
    if (req.body.requirements !== undefined) {
      updates.requirements = req.body.requirements;
    }

    const updatedJob = await JobVacancy.findByIdAndUpdate(req.params.id, updates, { new: true });
    const jobObj = updatedJob.toObject();
    jobObj.qualifications = formatQualifications(jobObj.qualifications);
    
    logger.info(`Job updated: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job updated", job: jobObj });
  } catch (error) {
    logger.error("Update job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ 
      message: process.env.NODE_ENV === "production" 
        ? "Failed to update job" 
        : error.message 
    });
  }
};

// ---------------------------------------------------------------------
// Delete a job (employer or admin)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Apply to a job (resident)
// ---------------------------------------------------------------------
exports.applyToJob = async (req, res) => {
  const resumeUpload = Array.isArray(req.files?.resume) ? req.files.resume[0] : req.file;
  const coverLetterUpload = Array.isArray(req.files?.coverLetterFile) ? req.files.coverLetterFile[0] : null;
  const uploadedFiles = [resumeUpload, coverLetterUpload].filter(Boolean);
  const session = await JobApplication.startSession();

  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) {
      uploadedFiles.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          logger.info(`Cleaned up orphan file: ${file.path}`);
        }
      });
      return res.status(404).json({ message: "Job not found" });
    }

    session.startTransaction();

    const existingApplication = await JobApplication.findOne({
      applicant: req.user.id,
      vacancy: job._id,
    }).session(session);

    if (existingApplication) {
      uploadedFiles.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "You have already applied to this job" });
    }

    if (!resumeUpload) {
      uploadedFiles.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Please upload your resume before applying." });
    }

    const application = await JobApplication.create([{
      applicant: req.user.id,
      vacancy: job._id,
      resume: resumeUpload ? resumeUpload.path : undefined,
      coverLetter: req.body.coverLetter || "",
      coverLetterFile: coverLetterUpload ? coverLetterUpload.path : "",
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const io = req.app.get("io");
    await createNotificationForUser({
      recipientId: job.employer,
      actorId: req.user.id,
      type: "job_application",
      title: "New job application",
      message: `A candidate applied for ${job.title}.`,
      relatedEntityType: "application",
      relatedEntityId: application[0]._id,
      actionUrl: "/employer",
      metadata: {
        jobId: String(job._id),
        applicationId: String(application[0]._id),
      },
      io,
    });

    logger.info(`Application submitted: ${application[0]._id} for job ${job._id} by user ${req.user.id}`);
    res.json({ message: "Application submitted successfully", application: application[0] });
  } catch (error) {
    uploadedFiles.forEach((file) => {
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
          logger.info(`Cleaned up orphan file on error: ${file.path}`);
        } catch (unlinkError) {
          logger.error("Failed to delete uploaded file:", unlinkError);
        }
      }
    });

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

// ---------------------------------------------------------------------
// Get all applications for a job (employer/admin)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Get current user's applications (resident)
// ---------------------------------------------------------------------
exports.getMyApplications = async (req, res) => {
  try {
    const applications = await JobApplication.find({ applicant: req.user.id })
      .populate({
        path: "vacancy",
        select: "title location employer qualifications",
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

        // Format qualifications
        if (vacancy.qualifications) {
          vacancy.qualifications = formatQualifications(vacancy.qualifications);
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

// ---------------------------------------------------------------------
// Update my application (resident)
// ---------------------------------------------------------------------
exports.updateMyApplication = async (req, res) => {
  try {
    const application = await JobApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (application.applicant.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only update your own applications" });
    }

    const resumeUpload = Array.isArray(req.files?.resume) ? req.files.resume[0] : req.file;
    const coverLetterUpload = Array.isArray(req.files?.coverLetterFile) ? req.files.coverLetterFile[0] : null;

    if (resumeUpload) {
      if (application.resume && fs.existsSync(application.resume)) {
        try {
          fs.unlinkSync(application.resume);
        } catch (unlinkError) {
          logger.error("Failed to delete old resume:", unlinkError);
        }
      }
      application.resume = resumeUpload.path;
    }

    if (coverLetterUpload) {
      if (application.coverLetterFile && fs.existsSync(application.coverLetterFile)) {
        try {
          fs.unlinkSync(application.coverLetterFile);
        } catch (unlinkError) {
          logger.error("Failed to delete old cover letter file:", unlinkError);
        }
      }
      application.coverLetterFile = coverLetterUpload.path;
      application.coverLetter = "";
    }

    await application.save();

    const populated = await JobApplication.findById(application._id)
      .populate({
        path: "vacancy",
        select: "title location employer qualifications",
        populate: {
          path: "employer",
          select: "name email companyName",
        },
      });

    const normalizedApplication = populated?.toObject ? populated.toObject() : populated;
    if (normalizedApplication?.vacancy) {
      // Format qualifications
      if (normalizedApplication.vacancy.qualifications) {
        normalizedApplication.vacancy.qualifications = formatQualifications(normalizedApplication.vacancy.qualifications);
      }

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

// ---------------------------------------------------------------------
// Delete my application (resident)
// ---------------------------------------------------------------------
exports.deleteMyApplication = async (req, res) => {
  try {
    const application = await JobApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (application.applicant.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only delete your own applications" });
    }

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

// ---------------------------------------------------------------------
// Close a job (employer or admin) - marks job as closed
// If deadline is past, this happens automatically
// If no deadline, employer can manually close it
// ---------------------------------------------------------------------
exports.closeJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only close your own job postings" });
    }

    // Update job status to closed
    job.status = "closed";
    job.closedAt = new Date();
    await job.save();

    logger.info(`Job closed: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job closed successfully", job: job.toObject() });
  } catch (error) {
    logger.error("Close job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to close job" });
  }
};

// ---------------------------------------------------------------------
// Archive a job (employer or admin) - marks closed job as archived
// Archived jobs don't appear in employer's active list but are stored
// ---------------------------------------------------------------------
exports.archiveJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only archive your own job postings" });
    }

    // Only allow archiving if job is closed
    if (job.status !== "closed") {
      return res.status(400).json({ message: "Only closed jobs can be archived" });
    }

    // Mark as archived
    job.archived = true;
    await job.save();

    logger.info(`Job archived: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job archived successfully", job: job.toObject() });
  } catch (error) {
    logger.error("Archive job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to archive job" });
  }
};

// ---------------------------------------------------------------------
// Reopen a closed job (employer or admin)
// ---------------------------------------------------------------------
exports.reopenJob = async (req, res) => {
  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.employer.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only reopen your own job postings" });
    }

    // Only allow reopening if job is closed
    if (job.status !== "closed") {
      return res.status(400).json({ message: "Only closed jobs can be reopened" });
    }

    // Update job status back to active
    job.status = "active";
    job.closedAt = null;
    job.archived = false;
    await job.save();

    logger.info(`Job reopened: ${req.params.id} by user ${req.user.id}`);
    res.json({ message: "Job reopened successfully", job: job.toObject() });
  } catch (error) {
    logger.error("Reopen job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to reopen job" });
  }
};

// ---------------------------------------------------------------------
// Get jobs for the logged-in employer (employer)
// Returns ALL jobs including closed and archived (for employer management)
// Automatically closes jobs past their deadline
// Includes applicant count
// ---------------------------------------------------------------------
exports.getEmployerJobs = async (req, res) => {
  try {
    const jobs = await JobVacancy.find({ employer: req.user.id }).sort({ createdAt: -1 });
    
    // Automatically close jobs that are past their deadline
    const jobsToUpdate = jobs.filter(job => 
      job.status === "active" && isJobPastDeadline(job)
    );
    
    for (const job of jobsToUpdate) {
      job.status = "closed";
      job.closedAt = new Date();
      await job.save();
      logger.info(`Auto-closed overdue job: ${job._id}`);
    }
    
    // Re-fetch after auto-closing
    const updatedJobs = await JobVacancy.find({ employer: req.user.id }).sort({ createdAt: -1 });
    
    // Get applicant counts
    const countMap = await getApplicationCountMap(updatedJobs.map(job => job._id));
    
    const jobsWithFormatted = updatedJobs.map(job => {
      const obj = job.toObject();
      obj.qualifications = formatQualifications(obj.qualifications);
      obj.applicationCount = Number(countMap[String(job._id)] || 0);
      return obj;
    });
    
    res.json(jobsWithFormatted);
  } catch (error) {
    logger.error("Get employer jobs error:", { userId: req.user.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch your jobs" });
  }
};