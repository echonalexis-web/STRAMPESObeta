const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Message = require("../models/Message");
const { ensureConversationBetweenUsers } = require("./messageController");
const JobseekerProfile = require("../models/JobseekerProfile");
const User = require("../models/User");
const Follow = require("../models/Follow");
const { createNotificationForUser } = require("../services/notificationService");
const { MIN_ACCOUNT_AGE } = require("../utils/age");

const EDUCATION_LEVELS = [
  "Elementary Graduate",
  "High School Graduate",
  "Senior High School Graduate",
  "Vocational / TESDA",
  "College Undergraduate",
  "College Graduate",
  "Master's Degree",
  "Doctorate",
];

const getUserId = (req) => req.user._id || req.user.id;

const autoCloseOverdueJobsForEmployer = async (employerId, io = null) => {
  const now = new Date();

  const overdueJobs = await JobVacancy.find({
    employer: employerId,
    status: "active",
    applicationDeadline: { $ne: null, $lt: now },
  }).select("_id title");

  if (overdueJobs.length === 0) return;

  await JobVacancy.updateMany(
    { _id: { $in: overdueJobs.map((job) => job._id) } },
    { $set: { status: "closed", closedAt: now } }
  );

  await Promise.all(
    overdueJobs.map((job) =>
      createNotificationForUser({
        recipientId: employerId,
        type: "system",
        title: "Job listing auto-closed",
        message: `"${job.title}" passed its application deadline and was automatically closed.`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        metadata: { jobTitle: job.title },
        io,
      })
    )
  );
};

// Helper to format qualifications for response
const formatQualifications = (qualifications) => {
  if (!qualifications || !Array.isArray(qualifications)) return [];
  return qualifications
    .filter(q => q && q.value)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

const VALID_WORK_NATURES = ["remote", "onsite", "hybrid"];

// Builds a human-readable "PHP X - Y" (or "PHP X") string from numeric
// salaryMin/salaryMax so cards/listings still have something to display
// even though the source of truth is now the numeric fields.
const formatSalaryDisplay = (salaryMin, salaryMax) => {
  const hasMin = Number.isFinite(salaryMin);
  const hasMax = Number.isFinite(salaryMax);
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `PHP ${Number(n).toLocaleString("en-PH")}`;
  if (hasMin && hasMax && salaryMin !== salaryMax) return `${fmt(salaryMin)} - ${fmt(salaryMax)}`;
  return fmt(hasMin ? salaryMin : salaryMax);
};

// Parses salaryMin/salaryMax out of a request body. A field is only present
// on the returned object if the caller sent the key at all: an explicit
// null/"" means "clear this field" (resolves to null), while an omitted key
// means "leave the existing value alone" and is left off the result.
const parseSalaryRange = (body) => {
  const result = {};
  if (body.salaryMin !== undefined) {
    result.salaryMin = body.salaryMin === null || body.salaryMin === "" ? null : Number(body.salaryMin);
  }
  if (body.salaryMax !== undefined) {
    result.salaryMax = body.salaryMax === null || body.salaryMax === "" ? null : Number(body.salaryMax);
  }
  return result;
};

// Pulls the structured "basic requirements" block out of a request body.
// Follows parseSalaryRange's convention: a key lands on the result only if the
// caller actually sent it, so partial updates leave untouched fields alone.
// An explicit null / "" clears the field.
const parseBasicRequirements = (body) => {
  const out = {};
  const num = (v) => (v === null || v === "" || v === undefined ? null : Number(v));

  if (body.minAge !== undefined) out.minAge = num(body.minAge);
  if (body.maxAge !== undefined) out.maxAge = num(body.maxAge);
  if (body.minExperienceYears !== undefined) out.minExperienceYears = num(body.minExperienceYears);
  if (body.minEducationLevel !== undefined) {
    out.minEducationLevel = EDUCATION_LEVELS.includes(body.minEducationLevel)
      ? body.minEducationLevel
      : null;
  }
  if (body.educationOrEquivalentExperience !== undefined) {
    out.educationOrEquivalentExperience = Boolean(body.educationOrEquivalentExperience);
  }
  if (body.languageRequirements !== undefined) {
    out.languageRequirements = Array.isArray(body.languageRequirements)
      ? body.languageRequirements
          .filter((l) => l && l.language)
          .map((l) => ({
            language: String(l.language).trim(),
            read: Boolean(l.read),
            write: Boolean(l.write),
            speak: Boolean(l.speak),
            understand: Boolean(l.understand),
            required: l.required !== false,
          }))
      : [];
  }
  return out;
};

// Validates an *effective* basic-requirements object (incoming values merged
// over whatever the job already has). Returns an error string, or null if OK.
const validateBasicRequirements = (reqs) => {
  if (reqs.minAge != null && (!Number.isFinite(reqs.minAge) || reqs.minAge < MIN_ACCOUNT_AGE)) {
    return `Minimum age cannot be below ${MIN_ACCOUNT_AGE}`;
  }
  if (reqs.maxAge != null && !Number.isFinite(reqs.maxAge)) {
    return "Maximum age must be a number";
  }
  if (reqs.minAge != null && reqs.maxAge != null && reqs.minAge > reqs.maxAge) {
    return "Minimum age cannot be greater than maximum age";
  }
  if (
    reqs.minExperienceYears != null &&
    (!Number.isFinite(reqs.minExperienceYears) || reqs.minExperienceYears < 0)
  ) {
    return "Minimum experience must be zero or a positive number";
  }
  return null;
};

// ---------------------------------------------------------------------
// Get all jobs for the logged-in employer
// ---------------------------------------------------------------------
exports.getEmployerJobs = async (req, res) => {
  try {
    const employerId = getUserId(req);
    await autoCloseOverdueJobsForEmployer(employerId, req.app.get("io"));

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
    const { title, location, description, salary, qualifications, jobType, slots, applicationDeadline, industry, workNature } = req.body;

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

    const { salaryMin, salaryMax } = parseSalaryRange(req.body);
    if (salaryMin != null && !Number.isFinite(salaryMin)) {
      return res.status(400).json({ message: "Salary minimum must be a number" });
    }
    if (salaryMax != null && !Number.isFinite(salaryMax)) {
      return res.status(400).json({ message: "Salary maximum must be a number" });
    }
    if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
      return res.status(400).json({ message: "Salary minimum cannot be greater than salary maximum" });
    }

    const salaryDisplay = salary ? String(salary).trim() : formatSalaryDisplay(salaryMin, salaryMax);

    const basicRequirements = parseBasicRequirements(req.body);
    const basicReqError = validateBasicRequirements(basicRequirements);
    if (basicReqError) {
      return res.status(400).json({ message: basicReqError });
    }

    const job = await JobVacancy.create({
      title: String(title).trim(),
      location: String(location).trim(),
      description: String(description).trim(),
      salary: salaryDisplay,
      salaryMin: salaryMin !== undefined ? salaryMin : null,
      salaryMax: salaryMax !== undefined ? salaryMax : null,
      qualifications: processedQualifications,
      jobType: jobType || "Full-time",
      slots: Number(slots) > 0 ? Number(slots) : 1,
      applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
      employer: employerId,
      status: "active",
      isActive: true,
      industry: industry ? String(industry).trim() : "",
      workNature: VALID_WORK_NATURES.includes(workNature) ? workNature : null,
      ...basicRequirements,
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

    const allowedFields = ["title", "location", "description", "jobType", "slots", "status", "applicationDeadline"];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        job[field] = req.body[field];
      }
    });

    if (req.body.industry !== undefined) {
      job.industry = String(req.body.industry).trim();
    }
    if (req.body.workNature !== undefined) {
      job.workNature = VALID_WORK_NATURES.includes(req.body.workNature) ? req.body.workNature : null;
    }

    const { salaryMin, salaryMax } = parseSalaryRange(req.body);
    if (salaryMin != null && !Number.isFinite(salaryMin)) {
      return res.status(400).json({ message: "Salary minimum must be a number" });
    }
    if (salaryMax != null && !Number.isFinite(salaryMax)) {
      return res.status(400).json({ message: "Salary maximum must be a number" });
    }
    const nextMin = salaryMin !== undefined ? salaryMin : job.salaryMin;
    const nextMax = salaryMax !== undefined ? salaryMax : job.salaryMax;
    if (Number.isFinite(nextMin) && Number.isFinite(nextMax) && nextMin > nextMax) {
      return res.status(400).json({ message: "Salary minimum cannot be greater than salary maximum" });
    }
    if (salaryMin !== undefined) job.salaryMin = salaryMin;
    if (salaryMax !== undefined) job.salaryMax = salaryMax;

    if (req.body.salary !== undefined) {
      job.salary = String(req.body.salary).trim();
    } else if (salaryMin !== undefined || salaryMax !== undefined) {
      // No explicit display string provided, but the numeric range changed —
      // regenerate the display string so it doesn't go stale.
      job.salary = formatSalaryDisplay(job.salaryMin, job.salaryMax);
    }

    if (req.body.qualifications !== undefined) {
      job.qualifications = parsedQualifications;
    }

    // Structured basic requirements (age / education / experience / language).
    const basicRequirements = parseBasicRequirements(req.body);
    if (Object.keys(basicRequirements).length > 0) {
      const effective = {
        minAge: "minAge" in basicRequirements ? basicRequirements.minAge : job.minAge,
        maxAge: "maxAge" in basicRequirements ? basicRequirements.maxAge : job.maxAge,
        minExperienceYears:
          "minExperienceYears" in basicRequirements
            ? basicRequirements.minExperienceYears
            : job.minExperienceYears,
      };
      const basicReqError = validateBasicRequirements(effective);
      if (basicReqError) {
        return res.status(400).json({ message: basicReqError });
      }
      Object.entries(basicRequirements).forEach(([key, value]) => {
        job[key] = value;
      });
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

    let applications = await JobApplication.find({ vacancy: jobId })
      .populate("applicant", "name email phone address skills resume resumeFile validIdFile isActive")
      .sort({ createdAt: -1 });

    // Hide applications from jobseekers whose account is suspended/deleted.
    applications = applications.filter(
      (app) => app.applicant && app.applicant.isActive !== false
    );

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

    const io = req.app.get("io");
    await createNotificationForUser({
      recipientId: application.applicant?._id,
      actorId: employerId,
      type: "application_status",
      title: "Application status updated",
      message: `Your application for ${application.vacancy?.title || "this job"} is now ${status}.`,
      relatedEntityType: "application",
      relatedEntityId: application._id,
      actionUrl: "/dashboard",
      metadata: {
        status,
        jobTitle: application.vacancy?.title || null,
      },
      io,
    });

    // Send automated status update message to jobseeker
    if (["reviewed", "shortlisted", "rejected", "hired"].includes(status)) {
      const conversation = await ensureConversationBetweenUsers(employerId, application.applicant);

      const applicantName = application.applicant?.name || "there";
      const jobTitle = application.vacancy?.title || "this role";
      let autoContent = "";

      // Customize message based on status
      switch (status) {
        case "reviewed":
          autoContent = `Hi ${applicantName}, we've reviewed your application for ${jobTitle}. We're impressed and would like to learn more about you!`;
          break;
        case "shortlisted":
          autoContent = `Great news, ${applicantName}! Your application for ${jobTitle} has been shortlisted. We'd love to move forward with you to the next stage.`;
          break;
        case "hired":
          autoContent = `Congratulations, ${applicantName}! We're pleased to offer you the position of ${jobTitle}. Please review the details and let us know if you have any questions.`;
          break;
        case "rejected":
          autoContent = `Hi ${applicantName}, thank you for your interest in ${jobTitle}. Unfortunately, we've decided to move forward with other candidates. We appreciate your time and wish you the best in your job search.`;
          break;
        default:
          autoContent = `Hi ${applicantName}, there's an update on your application for ${jobTitle}. Please check your profile for more details.`;
      }

      const autoMessage = await Message.create({
        conversationId: conversation._id,
        sender: employerId,
        content: autoContent,
        isRead: false,
      });

      conversation.lastMessage = autoMessage.content;
      conversation.lastMessageAt = autoMessage.createdAt;
      await conversation.save();

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
    await autoCloseOverdueJobsForEmployer(employerId, req.app.get("io"));

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
// Bulk update application statuses
// ---------------------------------------------------------------------
exports.bulkUpdateApplicationStatuses = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { applicationIds, status, employerNote } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({ message: "applicationIds must be a non-empty array" });
    }

    const allowed = ["pending", "reviewed", "shortlisted", "rejected", "hired"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    // Fetch all applications with their vacancies
    const applications = await JobApplication.find({ _id: { $in: applicationIds } })
      .populate("vacancy", "title employer")
      .populate("applicant", "name");

    if (applications.length === 0) {
      return res.status(404).json({ message: "No applications found" });
    }

    // Verify ownership and filter valid applications
    const validApplications = applications.filter(app => {
      return app.vacancy && String(app.vacancy.employer) === employerId;
    });

    if (validApplications.length === 0) {
      return res.status(403).json({ message: "You can only update applications for your own jobs" });
    }

    // Update all valid applications
    const updatePromises = validApplications.map(async (application) => {
      application.status = status;
      if (typeof employerNote === "string") {
        application.employerNote = employerNote;
      }
      application.statusUpdatedAt = new Date();
      await application.save();

      // Create notification for each applicant
      const io = req.app.get("io");
      await createNotificationForUser({
        recipientId: application.applicant?._id,
        actorId: employerId,
        type: "application_status",
        title: "Application status updated",
        message: `Your application for ${application.vacancy?.title || "this job"} is now ${status}.`,
        relatedEntityType: "application",
        relatedEntityId: application._id,
        actionUrl: "/dashboard",
        metadata: {
          status,
          jobTitle: application.vacancy?.title || null,
        },
        io,
      });

      // Send automated status update message for status changes
      if (["reviewed", "shortlisted", "rejected", "hired"].includes(status)) {
        const conversation = await ensureConversationBetweenUsers(employerId, application.applicant);

        const applicantName = application.applicant?.name || "there";
        const jobTitle = application.vacancy?.title || "this role";
        let autoContent = "";

        switch (status) {
          case "reviewed":
            autoContent = `Hi ${applicantName}, we've reviewed your application for ${jobTitle}. We're impressed and would like to learn more about you!`;
            break;
          case "shortlisted":
            autoContent = `Great news, ${applicantName}! Your application for ${jobTitle} has been shortlisted. We'd love to move forward with you to the next stage.`;
            break;
          case "hired":
            autoContent = `Congratulations, ${applicantName}! We're pleased to offer you the position of ${jobTitle}. Please review the details and let us know if you have any questions.`;
            break;
          case "rejected":
            autoContent = `Hi ${applicantName}, thank you for your interest in ${jobTitle}. Unfortunately, we've decided to move forward with other candidates. We appreciate your time and wish you the best in your job search.`;
            break;
          default:
            autoContent = `Hi ${applicantName}, there's an update on your application for ${jobTitle}. Please check your profile for more details.`;
        }

        const autoMessage = await Message.create({
          conversationId: conversation._id,
          sender: employerId,
          content: autoContent,
          isRead: false,
        });

        conversation.lastMessage = autoMessage.content;
        conversation.lastMessageAt = autoMessage.createdAt;
        await conversation.save();

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

      return application._id;
    });

    const updatedIds = await Promise.all(updatePromises);

    // Refetch all updated applications with full details
    const updatedApplications = await JobApplication.find({ _id: { $in: updatedIds } })
      .populate("applicant", "name email phone address skills resume resumeFile validIdFile")
      .populate("vacancy", "title location");

    // Fetch and merge jobseeker profiles
    const applicantIds = updatedApplications.map(app => app.applicant?._id).filter(Boolean);
    const profiles = await JobseekerProfile.find({ userId: { $in: applicantIds } });
    const profileMap = profiles.reduce((map, profile) => {
      map[String(profile.userId)] = profile;
      return map;
    }, {});

    const mergedApplications = updatedApplications.map(app => {
      const appObj = app.toObject();
      if (appObj.applicant) {
        const profile = profileMap[String(appObj.applicant._id)];
        if (profile) {
          appObj.applicant.profile = profile;
        }
      }
      return appObj;
    });

    return res.json({
      updated: mergedApplications.length,
      applications: mergedApplications,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to bulk update application statuses" });
  }
};

// ---------------------------------------------------------------------
// Employer profile statistics (for onboarding/progress)
// ---------------------------------------------------------------------
exports.getEmployerProfileStats = async (req, res) => {
  try {
    const employerId = getUserId(req);
    await autoCloseOverdueJobsForEmployer(employerId, req.app.get("io"));

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

// ---------------------------------------------------------------------
// View a jobseeker's full profile — only if they've applied to one of
// this employer's jobs or follow this employer. Keeps employer access to
// jobseeker NSRP data scoped to people who've actually engaged with them,
// rather than opening every resident's profile to every employer.
// ---------------------------------------------------------------------
exports.getConnectedJobseekerProfile = async (req, res) => {
  try {
    const employerId = String(getUserId(req));
    const { userId } = req.params;

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser || targetUser.role !== "resident") {
      return res.status(404).json({ message: "Jobseeker not found" });
    }
    if (targetUser.isActive === false) {
      return res.status(404).json({ message: "This profile is unavailable" });
    }

    const employerJobIds = await JobVacancy.find({ employer: employerId }).distinct("_id");

    const [hasApplied, isFollower] = await Promise.all([
      employerJobIds.length
        ? JobApplication.exists({ applicant: userId, vacancy: { $in: employerJobIds } })
        : Promise.resolve(false),
      Follow.exists({ follower: userId, following: employerId }),
    ]);

    if (!hasApplied && !isFollower) {
      return res.status(403).json({ message: "You can only view profiles of applicants or followers" });
    }

    const profile = await JobseekerProfile.findOne({ userId: targetUser._id });

    return res.json({ user: targetUser, profile });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to fetch jobseeker profile" });
  }
};