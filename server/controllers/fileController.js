const storageService = require("../services/storageService");
const { SIGNED_URL_TTL_SECONDS } = require("../config/cloudinary");
const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");

// Does `ref` belong to this user (or is the user an admin)?
const canAccessRef = async (ref, user) => {
  if (!user) return false;
  if (user.role === "admin") return true;

  const userId = user.id;

  const [ownUser, ownJobseeker, ownEmployer, ownApplication] = await Promise.all([
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
  ]);

  return Boolean(ownUser || ownJobseeker || ownEmployer || ownApplication);
};

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

    return res.json({ url, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to resolve file" });
  }
};
