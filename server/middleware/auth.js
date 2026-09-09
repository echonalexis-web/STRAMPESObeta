const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ============================================
// STANDARD AUTH (requires valid token)
// ============================================
exports.verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // An "appeal-only" token may not be used for normal API access.
    if (decoded.scope === "appeal") {
      return res.status(403).json({
        code: "APPEAL_TOKEN_SCOPE",
        message: "This session can only be used to submit a suspension appeal",
      });
    }

    const user = await User.findById(decoded.id).select(
      "isActive role verificationStatus accountStatus suspensionReason suspendedAt"
    );

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isActive === false) {
      // Staff accounts (admin / superadmin) are disabled by a superadmin, not
      // "suspended" through moderation — they must not land on the resident
      // appeal wall. Send a plain 403 with no appeal affordance.
      if (user.role === "admin" || user.role === "superadmin") {
        return res.status(403).json({
          code: "ACCOUNT_DISABLED",
          message: "This staff account has been disabled. Contact the system superadmin.",
        });
      }
      // Structured payload so the client can route to the suspended wall
      // instead of showing a bare error toast.
      return res.status(403).json({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account has been suspended",
        accountStatus: user.accountStatus === "banned" ? "banned" : "suspended",
        suspensionReason: user.suspensionReason || null,
        suspendedAt: user.suspendedAt || null,
      });
    }

    req.user = {
      ...decoded,
      role: user.role,
      verificationStatus: user.verificationStatus,
    };
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

// ============================================
// APPEAL-ONLY AUTH
// Accepts the short-lived token issued at login when the account is
// suspended. Grants access to the appeal endpoints only.
// ============================================
exports.verifyAppealToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope !== "appeal") {
      return res.status(403).json({ message: "Invalid appeal session" });
    }

    const user = await User.findById(decoded.id).select("accountStatus isActive");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = { id: String(user._id), _id: user._id, scope: "appeal" };
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

// ============================================
// ROLE CHECKS
// ============================================
exports.isResident = (req, res, next) => {
  if (!["resident", "employee", "jobseeker"].includes(req.user.role)) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
};

exports.isEmployee = (req, res, next) => {
  if (req.user.role !== "employee") {
    return res.status(403).json({ message: "Only employees can perform this action" });
  }
  next();
};

exports.isEmployer = (req, res, next) => {
  if (req.user.role !== "employer") {
    return res.status(403).json({ message: "Only employers can perform this action" });
  }
  next();
};

exports.isVerifiedEmployer = (req, res, next) => {
  if (req.user.role !== "employer") {
    return res.status(403).json({ message: "Only employers can perform this action" });
  }
  if (req.user.verificationStatus !== "verified") {
    return res.status(403).json({
      message: "Your employer account is not yet verified. Please upload your business permit and wait for admin approval.",
    });
  }
  next();
};

exports.isEmployeeOrResident = (req, res, next) => {
  if (!["resident", "employee", "jobseeker"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only residents or employees can perform this action" });
  }
  next();
};

exports.isAdmin = (req, res, next) => {
  // A superadmin supersedes admin and can reach every admin surface.
  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    return res.status(403).json({ message: "Only admins can perform this action" });
  }
  next();
};

// The superadmin tier: the only role allowed to provision / disable / reset
// admin accounts. Deliberately does NOT accept "admin".
exports.isSuperadmin = (req, res, next) => {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ message: "Superadmin access required" });
  }
  next();
};

exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

// ============================================
// OPTIONAL AUTH (does not reject on missing token)
// ============================================
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("isActive role verificationStatus");

    if (!user || user.isActive === false) {
      req.user = null;
      return next();
    }

    req.user = {
      ...decoded,
      role: user.role,
      verificationStatus: user.verificationStatus,
    };
    next();
  } catch (error) {
    // If token is invalid, still proceed but without user
    req.user = null;
    next();
  }
};