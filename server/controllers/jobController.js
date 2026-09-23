const mongoose = require("mongoose");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const JobseekerDocument = require("../models/JobseekerDocument");
const User = require("../models/User");
const Message = require("../models/Message");
const { ensureConversationBetweenUsers } = require("./messageController");
const { getHomepageJobsPayload, getApplicationCountMap } = require("../utils/jobDisplay");
const EmployerProfile = require("../models/EmployerProfile");
const { createNotificationForUser } = require("../services/notificationService");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");

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

const normalizeApplicationStatusValue = (status) => String(status || "").trim().toLowerCase();

const getRate = (value, total) => {
  if (!total || Number(total) === 0) return 0;
  return Number(((Number(value || 0) / Number(total)) * 100).toFixed(2));
};

const toSequentialHiredCandidateIds = (hiredIds = []) => {
  const uniqueIds = [...new Set(hiredIds.filter(Boolean).map(String))];
  return uniqueIds.map((_, index) => String(index + 1));
};

exports.buildArchivedJobSnapshot = (job, metrics = {}) => {
  const totalApplicants = Number(metrics.totalApplicants || 0);
  const qualifiedCount = Number(metrics.qualifiedCount || 0);
  const shortlistedCount = Number(metrics.shortlistedCount || 0);
  const hiredIds = Array.isArray(metrics.hiredIds)
    ? metrics.hiredIds.filter(Boolean).map(String)
    : [];
  const hiredCandidateNames = Array.isArray(metrics.hiredCandidateNames)
    ? metrics.hiredCandidateNames.filter(Boolean).map(String)
    : [];
  const sequentialHiredIds = toSequentialHiredCandidateIds(hiredIds);
  const archivedAt = metrics.archivedAt ? new Date(metrics.archivedAt) : new Date(job.archivedAt || job.closedAt || new Date());
  const createdAt = job.createdAt ? new Date(job.createdAt) : new Date();
  const closedAt = job.closedAt ? new Date(job.closedAt) : new Date(archivedAt);
  const daysActive = Math.max(0, Math.ceil((new Date(archivedAt).getTime() - new Date(createdAt).getTime()) / 86400000));

  return {
    archiveReason: metrics.archiveReason || job.archiveReason || null,
    archivedAt: new Date(archivedAt),
    closedAt: new Date(closedAt),
    totalApplicants,
    qualifiedCount,
    shortlistedCount,
    hiredCount: hiredIds.length,
    hiredCandidateIds: sequentialHiredIds,
    hiredCandidateNames: hiredCandidateNames.length ? hiredCandidateNames : sequentialHiredIds,
    qualifiedRate: getRate(qualifiedCount, totalApplicants),
    shortlistedRate: getRate(shortlistedCount, totalApplicants),
    hireRate: getRate(hiredIds.length, totalApplicants),
    daysActive,
  };
};

const archiveJobRecord = async (job, archiveReason = "manual_close", io = null) => {
  if (!job || job.archived) return job;

  const applications = await JobApplication.find({ vacancy: job._id });
  const totalApplicants = applications.length;
  const qualifiedCount = applications.filter((app) => {
    const status = normalizeApplicationStatusValue(app.status);
    return ["reviewed", "shortlisted", "hired", "accepted"].includes(status);
  }).length;
  const shortlistedCount = applications.filter((app) => {
    const status = normalizeApplicationStatusValue(app.status);
    return ["shortlisted", "hired", "accepted"].includes(status);
  }).length;
  const hiredApplications = applications.filter((app) => ["hired", "accepted"].includes(normalizeApplicationStatusValue(app.status)));
  const hiredCandidateIds = hiredApplications.map((app) => String(app.applicant));
  const hiredCandidateNames = hiredApplications
    .map((app) => {
      if (app.applicant && typeof app.applicant === "object" && app.applicant.name) {
        return String(app.applicant.name);
      }
      return "";
    })
    .filter(Boolean);

  const snapshot = exports.buildArchivedJobSnapshot(job, {
    totalApplicants,
    qualifiedCount,
    shortlistedCount,
    hiredIds: hiredCandidateIds,
    hiredCandidateNames,
    archiveReason,
    archivedAt: new Date(),
  });

  job.status = "closed";
  job.closedAt = job.closedAt || snapshot.closedAt;
  job.archived = true;
  job.archivedAt = snapshot.archivedAt;
  job.archiveReason = archiveReason;
  job.archivedMetrics = {
    ...snapshot,
    archiveReason,
    archivedAt: snapshot.archivedAt,
  };

  await job.save();

  // Let applicants still in the running know the posting closed — they
  // otherwise only ever hear from the employer via an explicit status
  // change, and would never learn their pending application just went moot.
  const stillPendingApplicants = applications.filter((app) =>
    ["pending", "reviewed", "shortlisted"].includes(normalizeApplicationStatusValue(app.status))
  );
  await Promise.all(
    stillPendingApplicants.map((app) =>
      createNotificationForUser({
        recipientId: app.applicant,
        type: "system",
        title: "Job posting closed",
        message: `"${job.title}" has closed and is no longer accepting applications.`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/applications",
        metadata: { jobTitle: job.title, reason: archiveReason },
        io,
      })
    )
  );

  return job;
};

// ---------------------------------------------------------------------
// Get all active jobs (public) – with employer profiles
// Filters out closed jobs and jobs past their deadline
// Also filters out jobs where the user has applied and been hired
// ---------------------------------------------------------------------
exports.getJobs = async (req, res) => {
  try {
    let jobs = await JobVacancy.find({ isActive: true })
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone isActive profileImage")
      .sort({ createdAt: -1 });

    // Filter out closed, expired, and archived jobs
    jobs = jobs.filter(job => isJobVisibleToJobseekers(job));

    // Hide jobs whose employer account is suspended/deactivated.
    jobs = jobs.filter(job => job.employer && job.employer.isActive !== false);

    // If user is logged in as a jobseeker, filter out jobs where they've been hired
    if (req.user && req.user.role === "jobseeker") {
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
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone isActive profileImage")
      .sort({ createdAt: -1 });

    // Filter out closed, expired, and archived jobs
    jobs = jobs.filter(job => isJobVisibleToJobseekers(job));

    // Hide jobs whose employer account is suspended/deactivated.
    jobs = jobs.filter(job => job.employer && job.employer.isActive !== false);

    // If user is logged in as a jobseeker, filter out jobs where they've been hired
    if (req.user && req.user.role === "jobseeker") {
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
      .populate("employer", "name email role companyName industry companySize website businessAddress companyDescription verificationStatus phone isActive profileImage");
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Treat a suspended employer's posting as unavailable to the public.
    const viewerIsPrivileged =
      req.user && (req.user.role === "admin" || String(req.user.id) === String(job.employer?._id));
    if (job.employer && job.employer.isActive === false && !viewerIsPrivileged) {
      // The posting itself was never sensitive — surface its title so the
      // "no longer available" page can still show a breadcrumb, without
      // leaking anything about the suspended employer account.
      return res.status(404).json({ message: "This job is no longer available", title: job.title });
    }

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

// Resolves a `resumeDocumentId`/`coverLetterDocumentId` body field to the
// owning JobseekerDocument (or null), scoped to this jobseeker and kind, so
// an applicant can only ever attach a document from their own library.
const resolveOwnedDocument = async (documentId, ownerId, kind) => {
  if (!documentId || !mongoose.isValidObjectId(documentId)) return null;
  return JobseekerDocument.findOne({ _id: documentId, owner: ownerId, kind });
};

// ---------------------------------------------------------------------
// Apply to a job (jobseeker)
// ---------------------------------------------------------------------
exports.applyToJob = async (req, res) => {
  const resumeUpload = Array.isArray(req.files?.resume) ? req.files.resume[0] : req.file;
  const coverLetterUpload = Array.isArray(req.files?.coverLetterFile) ? req.files.coverLetterFile[0] : null;
  // Orphan cleanup on error is handled by the cleanupUploadedFiles middleware.
  const session = await JobApplication.startSession();

  try {
    const job = await JobVacancy.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // A saved-document reference is only used when no fresh file was
    // uploaded for that slot, so a one-off replacement always wins.
    const resumeDocument = resumeUpload
      ? null
      : await resolveOwnedDocument(req.body.resumeDocumentId, req.user.id, "resume");
    const coverLetterDocument = coverLetterUpload
      ? null
      : await resolveOwnedDocument(req.body.coverLetterDocumentId, req.user.id, "coverLetter");

    session.startTransaction();

    const existingApplication = await JobApplication.findOne({
      applicant: req.user.id,
      vacancy: job._id,
    }).session(session);

    if (existingApplication) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "You have already applied to this job" });
    }

    if (!resumeUpload && !resumeDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Please attach your resume before applying." });
    }

    const application = await JobApplication.create([{
      applicant: req.user.id,
      vacancy: job._id,
      resume: resumeUpload ? resumeUpload.storedValue : resumeDocument.storedValue,
      resumeDocumentId: resumeDocument ? resumeDocument._id : null,
      coverLetter: req.body.coverLetter || "",
      coverLetterFile: coverLetterUpload ? coverLetterUpload.storedValue : coverLetterDocument ? coverLetterDocument.storedValue : "",
      coverLetterDocumentId: coverLetterDocument ? coverLetterDocument._id : null,
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
      preferenceKey: "notifyNewApplicant",
    });

    // Fresh activity — this vacancy is no longer a candidate for the
    // "about to auto-close" warning until it goes quiet again.
    JobVacancy.updateOne({ _id: job._id }, { $set: { expiryWarnedAt: null } }).catch(() => {});

    logger.info(`Application submitted: ${application[0]._id} for job ${job._id} by user ${req.user.id}`);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "jobseeker",
      action: "job.application.created",
      targetType: "application",
      targetId: String(application[0]._id),
      severity: "info",
      metadata: { jobId: String(job._id), jobTitle: job.title },
    });

    res.json({ message: "Application submitted successfully", application: application[0] });
  } catch (error) {
    // Uploaded files are cleaned up by the cleanupUploadedFiles middleware on error responses.
    await session.abortTransaction();
    session.endSession();

    // Two near-simultaneous requests can both pass the findOne duplicate
    // check above; the unique (applicant, vacancy) index on JobApplication
    // is what actually stops the second insert, surfacing here as E11000.
    if (error.code === 11000) {
      return res.status(400).json({ message: "You have already applied to this job" });
    }

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

    let applications = await JobApplication.find({ vacancy: job._id })
      .populate("applicant", "name email about isActive")
      .sort({ appliedAt: -1 });

    // Hide applications from jobseekers whose account is suspended/deleted.
    applications = applications.filter(
      (application) => application.applicant && application.applicant.isActive !== false
    );

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
// Get current user's applications (jobseeker)
// ---------------------------------------------------------------------
const MY_APPLICATIONS_POPULATE = {
  path: "vacancy",
  select: "title location employer qualifications",
  populate: {
    path: "employer",
    select: "name email companyName isActive profileImage",
  },
};

const normalizeMyApplications = async (applications) =>
  Promise.all(
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

      // Surface a marker the client uses to show "Employer unavailable"
      // instead of a working job link when the employer is suspended.
      if (employerValue && typeof employerValue === "object" && employerValue.isActive === false) {
        vacancy.employerUnavailable = true;
      }

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

      const employerProfile = await User.findById(employerId).select("name email companyName isActive").lean();
      vacancy.employer = employerProfile || { name: "Unknown", companyName: "No company name" };
      if (employerProfile && employerProfile.isActive === false) {
        vacancy.employerUnavailable = true;
      }

      return data;
    })
  );

// Tab keys the client filters by, mapped to the raw (case-insensitive) status
// values stored on legacy and current documents.
const MY_APPLICATIONS_STATUS_TABS = {
  pending: ["pending", "applied"],
  reviewed: ["reviewed"],
  shortlisted: ["shortlisted"],
  accepted: ["accepted", "hired"],
  rejected: ["rejected"],
};

exports.getMyApplications = async (req, res) => {
  try {
    const baseFilter = { applicant: req.user.id };
    const isPaginatedRequest =
      req.query.page !== undefined || req.query.limit !== undefined || req.query.status !== undefined;

    if (!isPaginatedRequest) {
      const applications = await JobApplication.find(baseFilter)
        .populate(MY_APPLICATIONS_POPULATE)
        .sort({ appliedAt: -1 });

      return res.json(await normalizeMyApplications(applications));
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 100);
    const tab = String(req.query.status || "all").trim().toLowerCase();

    const filter = { ...baseFilter };
    if (tab !== "all" && MY_APPLICATIONS_STATUS_TABS[tab]) {
      filter.status = {
        $in: MY_APPLICATIONS_STATUS_TABS[tab].map((value) => new RegExp(`^${value}$`, "i")),
      };
    }

    const [total, applications, statusBuckets] = await Promise.all([
      JobApplication.countDocuments(filter),
      JobApplication.find(filter)
        .populate(MY_APPLICATIONS_POPULATE)
        .sort({ appliedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      JobApplication.aggregate([
        // aggregate() skips Mongoose's automatic query casting, so the
        // applicant id must be cast to ObjectId explicitly here.
        { $match: { applicant: new mongoose.Types.ObjectId(req.user.id) } },
        { $group: { _id: { $toLower: "$status" }, count: { $sum: 1 } } },
      ]),
    ]);

    const bucketCount = {};
    statusBuckets.forEach((bucket) => {
      bucketCount[bucket._id || "pending"] = bucket.count;
    });

    const counts = {
      all: statusBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
      pending: (bucketCount.pending || 0) + (bucketCount.applied || 0),
      reviewed: bucketCount.reviewed || 0,
      shortlisted: bucketCount.shortlisted || 0,
      accepted: (bucketCount.accepted || 0) + (bucketCount.hired || 0),
      rejected: bucketCount.rejected || 0,
    };

    return res.json({
      items: await normalizeMyApplications(applications),
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      currentPage: page,
      counts,
    });
  } catch (error) {
    logger.error("Get my applications error:", { userId: req.user.id, error: error.message });
    res.status(500).json({ message: "Failed to fetch your applications" });
  }
};

// ---------------------------------------------------------------------
// Update my application (jobseeker)
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
    const resumeDocument = resumeUpload
      ? null
      : await resolveOwnedDocument(req.body.resumeDocumentId, req.user.id, "resume");
    const coverLetterDocument = coverLetterUpload
      ? null
      : await resolveOwnedDocument(req.body.coverLetterDocumentId, req.user.id, "coverLetter");

    if (resumeUpload || resumeDocument) {
      const previous = application.resume;
      // Never delete storage for a file that was borrowed from the jobseeker's
      // document library — it may still back other applications there.
      const previousWasLibrary = Boolean(application.resumeDocumentId);
      application.resume = resumeUpload ? resumeUpload.storedValue : resumeDocument.storedValue;
      application.resumeDocumentId = resumeDocument ? resumeDocument._id : null;
      if (previous && previous !== application.resume && !previousWasLibrary) {
        Promise.resolve(storageService.remove(previous)).catch(() => {});
      }
    }

    if (coverLetterUpload || coverLetterDocument) {
      const previous = application.coverLetterFile;
      const previousWasLibrary = Boolean(application.coverLetterDocumentId);
      application.coverLetterFile = coverLetterUpload ? coverLetterUpload.storedValue : coverLetterDocument.storedValue;
      application.coverLetterDocumentId = coverLetterDocument ? coverLetterDocument._id : null;
      application.coverLetter = "";
      if (previous && previous !== application.coverLetterFile && !previousWasLibrary) {
        Promise.resolve(storageService.remove(previous)).catch(() => {});
      }
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

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "jobseeker",
      action: "job.application.updated",
      targetType: "application",
      targetId: String(req.params.id),
      severity: "info",
    });

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
// Delete my application (jobseeker)
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

    // Library-sourced files are never deleted here — the same saved document
    // may still back other applications, or simply still live in the
    // jobseeker's library; only the JobseekerDocument's own delete route
    // removes that storage.
    if (application.resume && !application.resumeDocumentId) {
      Promise.resolve(storageService.remove(application.resume)).catch(() => {});
    }
    if (application.coverLetterFile && !application.coverLetterDocumentId) {
      Promise.resolve(storageService.remove(application.coverLetterFile)).catch(() => {});
    }

    await JobApplication.findByIdAndDelete(application._id);
    logger.info(`Application deleted: ${req.params.id} by user ${req.user.id}`);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "jobseeker",
      action: "job.application.deleted",
      targetType: "application",
      targetId: String(application._id),
      severity: "info",
    });

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

    if (job.archived) {
      return res.json({ message: "Job already archived", job: job.toObject() });
    }

    const io = req.app.get("io");
    const isAdminActingOnAnothersJob = req.user.role === "admin" && job.employer.toString() !== req.user.id;

    job.status = "closed";
    job.closedAt = new Date();
    const archivedJob = await archiveJobRecord(job, "manual_close", io);

    if (isAdminActingOnAnothersJob) {
      await createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was closed",
        message: `An administrator closed your job posting "${job.title}".`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        io,
      });
    }

    logger.info(`Job closed and archived: ${req.params.id} by user ${req.user.id}`);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "employer.job.closed",
      targetType: "job",
      targetId: String(req.params.id),
      severity: "info",
    });

    res.json({ message: "Job closed and archived successfully", job: archivedJob.toObject() });
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

    if (job.archived) {
      return res.json({ message: "Job already archived", job: job.toObject() });
    }

    const io = req.app.get("io");
    const isAdminActingOnAnothersJob = req.user.role === "admin" && job.employer.toString() !== req.user.id;
    const wasOpenBeforeArchive = job.status !== "closed";

    if (wasOpenBeforeArchive) {
      job.status = "closed";
      job.closedAt = job.closedAt || new Date();
    }

    const archivedJob = await archiveJobRecord(job, req.body?.reason || "manual_close", io);

    if (isAdminActingOnAnothersJob && wasOpenBeforeArchive) {
      await createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was closed",
        message: `An administrator archived your job posting "${job.title}".`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        io,
      });
    }

    logger.info(`Job archived: ${req.params.id} by user ${req.user.id}`);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "employer.job.archived",
      targetType: "job",
      targetId: String(req.params.id),
      severity: "info",
    });

    res.json({ message: "Job archived successfully", job: archivedJob.toObject() });
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

    if (req.user.role === "admin" && job.employer.toString() !== req.user.id) {
      await createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was reopened",
        message: `An administrator reopened your job posting "${job.title}".`,
        relatedEntityType: "job",
        relatedEntityId: job._id,
        actionUrl: "/employer",
        io: req.app.get("io"),
      });
    }

    logger.info(`Job reopened: ${req.params.id} by user ${req.user.id}`);

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "employer.job.reopened",
      targetType: "job",
      targetId: String(req.params.id),
      severity: "info",
    });

    res.json({ message: "Job reopened successfully", job: job.toObject() });
  } catch (error) {
    logger.error("Reopen job error:", { jobId: req.params.id, error: error.message });
    res.status(500).json({ message: "Failed to reopen job" });
  }
};