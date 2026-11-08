const storageService = require("../services/storageService");
const { SIGNED_URL_TTL_SECONDS } = require("../config/cloudinary");
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const JobVacancy = require("../models/JobVacancy");
const JobseekerDocument = require("../models/JobseekerDocument");
const SpesApplication = require("../models/SpesApplication");
const { sendError } = require("../utils/sendError");
const { logAuditEvent } = require("../services/auditService");

// Does `ref` belong to this user (or is the user an admin)?
const canAccessRef = async (ref, user) => {
  if (!user) return false;
  if (user.role === "admin" || user.role === "superadmin") return true;

  const userId = user.id;

  const checks = [
    User.exists({
      _id: userId,
      $or: [
        { profileImage: ref },
        { resumeFile: ref },
        { validIdFile: ref },
        { businessPermitUrl: ref },
        { registrationDocUrl: ref },
      ],
    }),
    JobseekerProfile.exists({
      userId,
      $or: [{ resumeFile: ref }, { validIdFile: ref }],
    }),
    EmployerProfile.exists({
      userId,
      $or: [{ businessPermitUrl: ref }, { registrationDocUrl: ref }],
    }),
    JobApplication.exists({
      applicant: userId,
      $or: [{ resume: ref }, { coverLetterFile: ref }],
    }),
    // The "Resumes & Cover Letters" library (JobseekerDocument) is its own
    // storage location, separate from the single resumeFile/validIdFile
    // slots above — a document that only lives there was previously
    // unopenable by its own owner because nothing here checked it.
    JobseekerDocument.exists({ owner: userId, storedValue: ref }),
    // SPES application documents: only the applicant who owns that application
    // (staff are already allowed above). Ownership is part of the query, so a
    // ref belonging to someone else's application never matches.
    SpesApplication.exists({ applicant: userId, "documents.fileUrl": ref }),
  ];

  // An employer may open an applicant's résumé/cover letter only once that
  // applicant has formally applied to one of this employer's own vacancies —
  // never a jobseeker's wider saved document library, and never before a
  // formal application exists for that specific job.
  if (user.role === "employer") {
    checks.push(
      JobVacancy.find({ employer: userId })
        .distinct("_id")
        .then((jobIds) =>
          jobIds.length
            ? JobApplication.exists({
                vacancy: { $in: jobIds },
                $or: [{ resume: ref }, { coverLetterFile: ref }],
              })
            : false
        )
    );
  }

  const results = await Promise.all(checks);
  return results.some(Boolean);
};

exports.canAccessRef = canAccessRef;

const auditIdAccess = async (ref, req) => {
  if (!["admin", "superadmin"].includes(req.user?.role)) return;
  const owner = await User.findOne({ validIdFile: ref }).select("_id");
  if (owner) await logAuditEvent({ req, actorId: req.user.id, actorRole: req.user.role, action: "admin.id.viewed", targetType: "user", targetId: String(owner._id) });
  else {
    const Recovery = require("../models/AccountRecoveryRequest");
    const request = await Recovery.findOne({ $or: [{ governmentIdFile: ref }, { selfieFile: ref }] }).select("_id");
    if (request) await logAuditEvent({ req, actorId: req.user.id, actorRole: req.user.role, action: "admin.id.viewed", targetType: "accountRecovery", targetId: String(request._id) });
  }
};
exports.auditIdAccess = auditIdAccess;

exports.getSignedUrl = async (req, res) => {
  try {
    const ref = String(req.query.ref || "").trim();
    if (!ref) {
      return res.status(400).json({ message: "Missing ref" });
    }

    // Public URLs need no authorisation and no signing.
    if (storageService.isRemoteUrl(ref)) {
      return res.json({ url: ref, expiresIn: null });
    }

    if (!storageService.isPrivateRef(ref)) {
      return res.status(400).json({ message: "Unsupported reference" });
    }

    const allowed = await canAccessRef(ref, req.user);
    if (!allowed) {
      return res.status(403).json({ message: "You are not allowed to access this file" });
    }

    const url = await storageService.getSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
    if (!url) {
      return res.status(404).json({ message: "File not found" });
    }

    await auditIdAccess(ref, req);

    return res.json({ url, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    return sendError(res, error, "Failed to resolve file");
  }
};
