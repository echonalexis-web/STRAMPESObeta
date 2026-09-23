const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const authController = require("./authController");
const VALID_INDUSTRIES = require("../data/industries"); // Import industry validation list
const { isAdultAge, MIN_ACCOUNT_AGE } = require("../utils/age");
const { logAuditEvent } = require("../services/auditService");

// Helper to update or create profile
const upsertProfile = async (userId, role, data) => {
  let Model = role === "jobseeker" ? JobseekerProfile : EmployerProfile;
  return Model.findOneAndUpdate({ userId }, { $set: data }, { new: true, upsert: true });
};

// Helper to safely parse JSON
const parseJSON = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ---------- Get full profile (user + role profile) ----------
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    let profile = null;
    if (user.role === "jobseeker") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
    } else if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });
    }

    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Complete onboarding ----------
exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Age gate — enforced here too because jobseekers supply their birth date
    // during onboarding rather than at registration.
    const dobForCheck = req.body.dateOfBirth || user.dateOfBirth;
    if (dobForCheck) {
      if (!isAdultAge(dobForCheck)) {
        return res.status(400).json({
          message: `You must be at least ${MIN_ACCOUNT_AGE} years old to use STRAM PESO.`,
        });
      }
    }

    // 1. Build common updates (fields that belong to User model)
    const commonUpdates = {
      name: req.body.name,
      phone: req.body.phone,
      about: req.body.about,
      address: req.body.address,
      dateOfBirth: req.body.dateOfBirth || null,
      gender: req.body.gender || null,
      hasCompletedOnboarding: true,
      onboardingComplete: true,
    };

    // For jobseekers, also update career fields on User
    if (user.role === "jobseeker") {
      commonUpdates.desiredJobTitle = req.body.desiredJobTitle || null;
      commonUpdates.workExperience = req.body.workExperience || null;
      commonUpdates.educationalAttainment = req.body.educationalAttainment || null;
      commonUpdates.availabilityStatus = req.body.availabilityStatus || null;
      
      // Parse skills from JSON string
      if (req.body.skills) {
        const skills = parseJSON(req.body.skills, []);
        if (Array.isArray(skills)) commonUpdates.skills = skills;
      }

      // ===== NEW: Parse and validate Industry Preferences =====
      if (req.body.preferredIndustries) {
        const industries = parseJSON(req.body.preferredIndustries, []);
        if (Array.isArray(industries) && industries.length > 0) {
          // Filter out any invalid industries submitted by the client
          const validSelectedIndustries = industries.filter((ind) => VALID_INDUSTRIES.includes(ind));
          
          // If user submitted industries but none were valid, throw an error
          if (validSelectedIndustries.length === 0) {
            return res.status(400).json({ message: "Please select at least one valid industry." });
          }
          
          commonUpdates.preferredIndustries = validSelectedIndustries;
          
          // Add preference level (strict vs flexible) - defaults to flexible
          const preferenceLevel = req.body.industryPreferenceLevel;
          commonUpdates.industryPreferenceLevel = 
            preferenceLevel === "strict" || preferenceLevel === "flexible" 
              ? preferenceLevel 
              : "flexible";
        } else if (industries.length === 0) {
          // If they explicitly passed an empty array, clear preferences
          commonUpdates.preferredIndustries = [];
        }
      }
    }

    // For employers, update company fields
    if (user.role === "employer") {
      const employerFields = ["companyName", "industry", "website", "companyDescription", "businessAddress"];
      employerFields.forEach(field => {
        if (req.body[field] !== undefined) commonUpdates[field] = req.body[field];
      });

      if (req.body.companySize !== undefined) {
        commonUpdates.companySize = User.normalizeCompanySize(req.body.companySize);
      }

      // Keep `name` (the business's display identity everywhere in the app)
      // in sync with the company name the onboarding form requires — a
      // Google sign-up otherwise leaves `name` as the personal Google
      // account name forever, since nothing else ever writes to it here.
      // See the matching fix in authController.updateProfile.
      const trimmedCompanyName = String(req.body.companyName || "").trim();
      if (trimmedCompanyName) {
        commonUpdates.name = trimmedCompanyName;
      }
    }

    // Apply common updates
    await User.findByIdAndUpdate(userId, commonUpdates);

    // 2. Build role‑specific profile data (NSRP fields)
    let profileData = {};
    if (user.role === "jobseeker") {
      profileData = {
        civilStatus: req.body.civilStatus || null,
        placeOfBirth: req.body.placeOfBirth || null,
        citizenship: req.body.citizenship || null,
        height: req.body.height ? parseFloat(req.body.height) : null,
        weight: req.body.weight ? parseFloat(req.body.weight) : null,
        landline: req.body.landline || null,
        mobileSecondary: req.body.mobileSecondary || null,
        presentAddress: parseJSON(req.body.presentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        permanentAddress: parseJSON(req.body.permanentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        disability: parseJSON(req.body.disability, []),
        is4psBeneficiary: req.body.is4psBeneficiary === "true",
        _4psHouseholdId: req.body._4psHouseholdId || null,
        isOfw: req.body.isOfw === "true",
        isRepatriated: req.body.isRepatriated === "true",
        repatriationIntent: req.body.repatriationIntent || null,
        employmentStatus: req.body.employmentStatus || null,
        employmentType: req.body.employmentType || null,
        unemploymentReason: req.body.unemploymentReason || null,
        laidoffCountry: req.body.laidoffCountry || null,
        
        // ===== NEW: Save mirror fields and extra preferences to JobseekerProfile =====
        preferredIndustries: commonUpdates.preferredIndustries || [],
        preferredJobTypes: parseJSON(req.body.preferredJobTypes, []) || [],
        preferredWorkNature: parseJSON(req.body.preferredWorkNature, []) || [],
        industrySelectionStep: req.body.industrySelectionStep === "true" || req.body.industrySelectionStep === true,
      };
    } else if (user.role === "employer") {
      profileData = {
        tradeName: req.body.tradeName || null,
        acronym: req.body.acronym || null,
        tin: req.body.tin || null,
        officeType: req.body.officeType || null,
        employerClassification: parseJSON(req.body.employerClassification, { type: null, subtype: null }),
        totalWorkforceSize: req.body.totalWorkforceSize || null,
        businessAddress: parseJSON(req.body.businessAddressStructured, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        ownerName: req.body.ownerName || null,
        contactPersonName: req.body.contactPersonName || null,
        contactPersonPosition: req.body.contactPersonPosition || null,
        fax: req.body.fax || null,
      };
    }

    // Remove undefined fields
    Object.keys(profileData).forEach(key => profileData[key] === undefined && delete profileData[key]);

    let updatedProfile = null;
    if (Object.keys(profileData).length > 0) {
      updatedProfile = await upsertProfile(userId, user.role, profileData);
    }

    const updatedUser = await User.findById(userId).select("-password");

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: user.role,
      action: "user.profile.onboarding_completed",
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    });

    res.json({
      message: "Onboarding completed",
      user: updatedUser,
      profile: updatedProfile,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Update profile (re‑exports authController.updateProfile) ----------
exports.updateProfile = authController.updateProfile;

// ---------- Other user operations ----------
exports.uploadProfileImage = async (req, res) => {
  try {
    if (!req.file?.storedValue) return res.status(400).json({ message: "No file uploaded" });
    const imageUrl = req.file.storedValue;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profileImage: imageUrl },
      { new: true }
    ).select("-password");

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "user.profile_image.uploaded",
      targetType: "user",
      targetId: String(req.user.id),
      severity: "info",
    });

    res.json({ message: "Profile image uploaded", profileImage: imageUrl, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.uploadResume = async (req, res) => {
  try {
    if (!req.file?.storedValue) return res.status(400).json({ message: "No file uploaded" });
    const resumeUrl = req.file.storedValue;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { resumeFile: resumeUrl },
      { new: true }
    ).select("-password");

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "user.resume.uploaded",
      targetType: "user",
      targetId: String(req.user.id),
      severity: "info",
    });

    res.json({ message: "Resume uploaded", resume: resumeUrl, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "Current password is incorrect" });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    // Invalidates every other token issued before this change.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

