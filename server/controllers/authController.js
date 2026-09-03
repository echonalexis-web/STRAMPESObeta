const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const JobApplication = require("../models/JobApplication");
const fs = require("fs");
const path = require("path");
const VALID_INDUSTRIES = require("../data/industries");
const { logAuditEvent } = require("../services/auditService");

// Helper to update or create role profile
const upsertProfile = async (userId, role, data) => {
  let Model = role === "resident" ? JobseekerProfile : EmployerProfile;
  return Model.findOneAndUpdate({ userId }, { $set: data }, { new: true, upsert: true });
};

// Helper to safely parse JSON from string or return default
const parseJSON = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ---------- Registration ----------
exports.register = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "resident",
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "resident",
      action: "auth.user.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    await JobseekerProfile.create({ userId: user._id });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        hasCompletedOnboarding: false,
        onboardingComplete: false,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.registerEmployer = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "employer",
      verificationStatus: "pending",
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "employer",
      action: "auth.employer.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    await EmployerProfile.create({ userId: user._id });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.user.login_success",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    res.status(201).json({
      message: "Employer registered. Please complete your profile.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Login ----------
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    if (user.isActive === false) {
      return res.status(403).json({ message: "Your account is deactivated. Please contact the administrator." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Get current user (basic) ----------
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Get full profile (user + role-specific profile) ----------
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    let profile = null;
    if (user.role === "resident") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
    } else if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });
    }

    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Delete account ----------
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "resident") {
      await JobseekerProfile.deleteOne({ userId });
    } else if (user.role === "employer") {
      await EmployerProfile.deleteOne({ userId });
    }

    const filesToDelete = [user.resumeFile, user.validIdFile, user.businessPermitUrl, user.registrationDocUrl].filter(Boolean);
    await Promise.all(
      filesToDelete.map((filePath) =>
        new Promise((resolve) => {
          const fileName = filePath.split("/").pop();
          if (!fileName) return resolve();
          const absolutePath = path.join(__dirname, "..", "uploads", fileName);
          fs.unlink(absolutePath, (err) => {
            if (err && err.code !== "ENOENT") console.error("Failed to delete file:", absolutePath);
            resolve();
          });
        })
      )
    );

    await JobApplication.deleteMany({ applicant: userId });
    await user.deleteOne();

    res.status(200).json({ message: "Account successfully deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete account" });
  }
};

// ---------- Unified updateProfile ----------
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const currentUser = await User.findById(userId).select("role password");
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    // ---- 1. Email uniqueness ----
    if (req.body.email) {
      const existing = await User.findOne({ email: req.body.email, _id: { $ne: userId } });
      if (existing) return res.status(400).json({ message: "Email already exists" });
    }

    // ---- 2. Admin password change ----
    if (currentUser.role === "admin" && req.body.newPassword) {
      const isCurrentValid = await bcrypt.compare(req.body.currentPassword || "", currentUser.password);
      if (!isCurrentValid) return res.status(400).json({ message: "Current password is incorrect" });
      if (req.body.newPassword.length < 8) return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    // ---- 3. Prepare common user updates ----
    const commonUpdates = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      about: req.body.about,
      address: req.body.address,
      dateOfBirth: req.body.dateOfBirth || null,
      gender: req.body.gender || null,
    };

    // For residents, also update career fields (but NOT skills – moved to profile)
    if (currentUser.role === "resident") {
      commonUpdates.desiredJobTitle = req.body.desiredJobTitle || null;
      commonUpdates.workExperience = req.body.workExperience || null;
      commonUpdates.educationalAttainment = req.body.educationalAttainment || null;
      commonUpdates.availabilityStatus = req.body.availabilityStatus || null;
      // skills are handled in profileData below
      
      // Handle industry preferences
      if (req.body.preferredIndustries) {
        const industries = parseJSON(req.body.preferredIndustries, []);
        if (Array.isArray(industries) && industries.length > 0) {
          const validSelectedIndustries = industries.filter((ind) => VALID_INDUSTRIES.includes(ind));
          if (validSelectedIndustries.length > 0) {
            commonUpdates.preferredIndustries = validSelectedIndustries;
          }
        }
      }
      if (req.body.industryPreferenceLevel) {
        const level = req.body.industryPreferenceLevel;
        if (level === "strict" || level === "flexible") {
          commonUpdates.industryPreferenceLevel = level;
        }
      }
    }

    // For employers, update company fields
    if (currentUser.role === "employer") {
      const employerCommonFields = ["companyName", "industry", "companySize", "website", "companyDescription", "businessAddress"];
      employerCommonFields.forEach(field => {
        if (req.body[field] !== undefined) commonUpdates[field] = req.body[field];
      });
    }

    // ---- 4. File uploads (handled by multer) ----
    if (req.files?.resumeFile?.[0]) commonUpdates.resumeFile = `uploads/${req.files.resumeFile[0].filename}`;
    if (req.files?.validIdFile?.[0]) commonUpdates.validIdFile = `uploads/${req.files.validIdFile[0].filename}`;
    if (req.files?.businessPermit?.[0]) commonUpdates.businessPermitUrl = `uploads/${req.files.businessPermit[0].filename}`;
    if (req.files?.registrationDoc?.[0]) commonUpdates.registrationDocUrl = `uploads/${req.files.registrationDoc[0].filename}`;
    if (req.files?.resume?.[0]) commonUpdates.resumeFile = `uploads/${req.files.resume[0].filename}`;
    if (req.files?.supportingDocument?.[0]) commonUpdates.validIdFile = `uploads/${req.files.supportingDocument[0].filename}`;

    // Onboarding completion flag
    if (req.body.onboardingComplete === true || req.body.onboardingComplete === "true") {
      commonUpdates.hasCompletedOnboarding = true;
      commonUpdates.onboardingComplete = true;
    }

    // ---- 5. Apply common updates ----
    const cleanCommon = Object.fromEntries(
      Object.entries(commonUpdates).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanCommon).length > 0) {
      await User.findByIdAndUpdate(userId, cleanCommon);
    }

    // ---- 6. Build role‑specific profile data (NSRP fields) ----
    let profileData = {};
    const allFields = req.body;

    if (currentUser.role === "resident") {
      profileData = {
        civilStatus: allFields.civilStatus || null,
        placeOfBirth: allFields.placeOfBirth || null,
        citizenship: allFields.citizenship || null,
        height: allFields.height ? parseFloat(allFields.height) : null,
        weight: allFields.weight ? parseFloat(allFields.weight) : null,
        landline: allFields.landline || null,
        mobileSecondary: allFields.mobileSecondary || null,
        presentAddress: parseJSON(allFields.presentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        permanentAddress: parseJSON(allFields.permanentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        disability: parseJSON(allFields.disability, []),
        is4psBeneficiary: allFields.is4psBeneficiary === "true",
        _4psHouseholdId: allFields._4psHouseholdId || null,
        isOfw: allFields.isOfw === "true",
        isRepatriated: allFields.isRepatriated === "true",
        repatriationIntent: allFields.repatriationIntent || null,
        employmentStatus: allFields.employmentStatus || null,
        employmentType: allFields.employmentType || null,
        unemploymentReason: allFields.unemploymentReason || null,
        laidoffCountry: allFields.laidoffCountry || null,
        // ==== FIX: skills saved to jobseeker profile ====
        skills: parseJSON(allFields.skills, []),
        // Industry preferences
        preferredIndustries: parseJSON(allFields.preferredIndustries, []),
      };
    } else if (currentUser.role === "employer") {
      profileData = {
        tradeName: allFields.tradeName || null,
        acronym: allFields.acronym || null,
        tin: allFields.tin || null,
        officeType: allFields.officeType || null,
        employerClassification: parseJSON(allFields.employerClassification, { type: null, subtype: null }),
        totalWorkforceSize: allFields.totalWorkforceSize || null,
        businessAddress: parseJSON(allFields.businessAddressStructured, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        ownerName: allFields.ownerName || null,
        contactPersonName: allFields.contactPersonName || null,
        contactPersonPosition: allFields.contactPersonPosition || null,
        fax: allFields.fax || null,
      };
    }

    // ---- 7. Upsert profile ----
    let updatedProfile = null;
    if (Object.keys(profileData).length > 0) {
      updatedProfile = await upsertProfile(userId, currentUser.role, profileData);
    }

    // ---- 8. Admin password update ----
    if (currentUser.role === "admin" && req.body.newPassword) {
      const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
      await User.findByIdAndUpdate(userId, { password: hashedPassword });
    }

    // ---- 9. Fetch updated user ----
    const updatedUser = await User.findById(userId).select("-password");

    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
      profile: updatedProfile,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: error.message });
  }
};