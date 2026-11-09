const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const bcrypt = require("bcryptjs");
const authController = require("./authController");
const { sendError } = require("../utils/sendError");
const { getActiveValues } = require("../services/systemOptionService");
const { validateDobInput } = require("../utils/age");
const { DOB_ERROR_MESSAGES } = require("../utils/dobPolicy");
const { logAuditEvent } = require("../services/auditService");
const { normalizeHeightUnit, normalizeWeightUnit } = require("../utils/unitFields");

// Same exclusions as authController: the owner never needs backup codes, the
// recovery-email token or the raw ID OCR text back from these endpoints.
const CLIENT_UNSAFE_FIELDS = "-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText";

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
    const user = await User.findById(req.user.id).select(CLIENT_UNSAFE_FIELDS);
    if (!user) return res.status(404).json({ message: "User not found" });

    let profile = null;
    if (user.role === "jobseeker") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
    } else if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });
    }

    res.json({ user, profile });
  } catch (error) {
    sendError(res, error);
  }
};

// ---------- Complete onboarding ----------
exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Age gate. The date of birth is set once and then locked: onboarding never
    // overwrites an existing value (and never writes null over it). A jobseeker
    // with no date of birth yet (legacy account) must supply a valid one here.
    // Employers never have a date of birth stored.
    let dobUpdate = null;
    if (user.role !== "employer" && !user.dateOfBirth) {
      const dob = validateDobInput(req.body.dateOfBirth);
      if (!dob.ok) {
        return res.status(400).json({ code: dob.code, message: DOB_ERROR_MESSAGES[dob.code] });
      }
      dobUpdate = { dateOfBirth: dob.date, dobLockedAt: new Date(), dobSource: "onboarding" };
    }

    // 1. Build common updates (fields that belong to User model)
    const commonUpdates = {
      name: req.body.name,
      phone: req.body.phone,
      about: req.body.about,
      address: req.body.address,
      ...(dobUpdate || {}),
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
          // Filter out any invalid industries submitted by the client —
          // validated dynamically against the SystemOption catalog (item 11)
          // rather than a static list.
          const activeIndustries = await getActiveValues("industry");
          const validSelectedIndustries =
            activeIndustries.size === 0
              ? industries
              : industries.filter((ind) => activeIndustries.has(ind));

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
        // "Other, please specify" fallback (items 14/15) — mirrors
        // governmentIdTypeOther's clearing: only kept when civilStatus is
        // actually "Other".
        civilStatusOther: req.body.civilStatus === "Other" ? (req.body.civilStatusOther || null) : null,
        placeOfBirth: req.body.placeOfBirth || null,
        citizenship: req.body.citizenship || null,
        height: req.body.height ? parseFloat(req.body.height) : null,
        heightUnit: normalizeHeightUnit(req.body.heightUnit),
        weight: req.body.weight ? parseFloat(req.body.weight) : null,
        weightUnit: normalizeWeightUnit(req.body.weightUnit),
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

    const updatedUser = await User.findById(userId).select(CLIENT_UNSAFE_FIELDS);

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
    sendError(res, error);
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
    ).select(CLIENT_UNSAFE_FIELDS);

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
    sendError(res, error);
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
    ).select(CLIENT_UNSAFE_FIELDS);

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
    sendError(res, error);
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.password) {
      return res.status(400).json({ message: "Set a password before changing it." });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "Current password is incorrect" });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    // Invalidates every other token issued before this change.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await user.save({ validateModifiedOnly: true });
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    sendError(res, error);
  }
};


// ---------- Legacy accounts: set the date of birth once ----------
// For accounts created before the date of birth was required. Accepted only
// while no date is stored; the value is then locked. Under the minimum age the
// date is NOT stored: the account is flagged for admin review instead (nothing
// is deleted automatically).
exports.setMyDateOfBirth = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("role dateOfBirth ageReviewRequired");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "employer") {
      return res.status(400).json({ code: "DOB_NOT_APPLICABLE", message: "Employer accounts do not store a date of birth." });
    }
    if (user.dateOfBirth) {
      return res.status(409).json({ code: "DOB_LOCKED", message: DOB_ERROR_MESSAGES.DOB_LOCKED });
    }

    const dob = validateDobInput(req.body.dateOfBirth);
    if (!dob.ok) {
      if (dob.code === "AGE_UNDER_MINIMUM") {
        await User.updateOne({ _id: userId }, { $set: { ageReviewRequired: true } });
        await logAuditEvent({
          req,
          actorId: userId,
          actorRole: user.role,
          action: "user.age_review.flagged",
          targetUserId: userId,
          targetType: "user",
          targetId: String(userId),
          severity: "warning",
          metadata: { tier: "under15", source: "legacy_prompt" },
        });
      }
      return res.status(dob.code === "AGE_UNDER_MINIMUM" ? 403 : 400).json({
        code: dob.code,
        message: DOB_ERROR_MESSAGES[dob.code],
      });
    }

    await User.updateOne(
      { _id: userId },
      { $set: { dateOfBirth: dob.date, dobLockedAt: new Date(), dobSource: "legacy_prompt", ageReviewRequired: false } }
    );
    return res.json({ message: "Date of birth saved.", ageTier: dob.tier });
  } catch (error) {
    return sendError(res, error);
  }
};
