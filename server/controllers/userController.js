const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const authController = require("./authController");

// Helper to update or create profile
const upsertProfile = async (userId, role, data) => {
  let Model = role === "resident" ? JobseekerProfile : EmployerProfile;
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

// ---------- Complete onboarding ----------
exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

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
    if (user.role === "resident") {
      commonUpdates.desiredJobTitle = req.body.desiredJobTitle || null;
      commonUpdates.workExperience = req.body.workExperience || null;
      commonUpdates.educationalAttainment = req.body.educationalAttainment || null;
      commonUpdates.availabilityStatus = req.body.availabilityStatus || null;
      // Parse skills from JSON string
      if (req.body.skills) {
        const skills = parseJSON(req.body.skills, []);
        if (Array.isArray(skills)) commonUpdates.skills = skills;
      }
    }

    // For employers, update company fields
    if (user.role === "employer") {
      const employerFields = ["companyName", "industry", "companySize", "website", "companyDescription", "businessAddress"];
      employerFields.forEach(field => {
        if (req.body[field] !== undefined) commonUpdates[field] = req.body[field];
      });
    }

    // Apply common updates
    await User.findByIdAndUpdate(userId, commonUpdates);

    // 2. Build role‑specific profile data (NSRP fields)
    let profileData = {};
    if (user.role === "resident") {
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
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const imageUrl = `/uploads/profiles/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profileImage: imageUrl },
      { new: true }
    ).select("-password");
    res.json({ message: "Profile image uploaded", profileImage: imageUrl, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.uploadResume = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const resumeUrl = `/uploads/resumes/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { resumeFile: resumeUrl },
      { new: true }
    ).select("-password");
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
    await user.save();
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    let profile = null;
    if (user.role === "resident") profile = await JobseekerProfile.findOne({ userId: user._id });
    else if (user.role === "employer") profile = await EmployerProfile.findOne({ userId: user._id });
    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    await JobseekerProfile.deleteOne({ userId: req.user.id });
    await EmployerProfile.deleteOne({ userId: req.user.id });
    res.json({ message: "Account deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Notifications (unchanged)
exports.getNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("notifications");
    res.json(user?.notifications || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const notification = user.notifications.id(req.params.notificationId);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    notification.isRead = true;
    await user.save();
    res.json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.notifications.forEach(n => (n.isRead = true));
    await user.save();
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};