const jwt = require("jsonwebtoken");
const User = require("../models/User");

exports.verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("isActive role verificationStatus");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "Your account is deactivated" });
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
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can perform this action" });
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