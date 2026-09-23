const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const { fillForm1, fillForm2 } = require("../services/nsrpFormService");

const sendPdf = (res, filename, buffer) => {
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
};

// ---------- Self-export (jobseeker / employer download their own form) ----------

exports.exportOwnForm1 = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "jobseeker") {
      return res.status(400).json({ message: "NSRP Form I is only available to jobseeker accounts." });
    }

    const profile = await JobseekerProfile.findOne({ userId: user._id });
    const buffer = await fillForm1(profile, user);
    sendPdf(res, "NSRP-Form-1.pdf", buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.exportOwnForm2 = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "employer") {
      return res.status(400).json({ message: "NSRP Form II is only available to employer accounts." });
    }

    const profile = await EmployerProfile.findOne({ userId: user._id });
    const buffer = await fillForm2(profile, user);
    sendPdf(res, "NSRP-Form-2.pdf", buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Admin-triggered export (any user's form, by id) ----------

exports.adminExportForm1 = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "jobseeker") {
      return res.status(400).json({ message: "This user does not have an NSRP Form I (jobseeker) profile." });
    }

    const profile = await JobseekerProfile.findOne({ userId: user._id });
    const buffer = await fillForm1(profile, user);
    sendPdf(res, `NSRP-Form-1-${user._id}.pdf`, buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.adminExportForm2 = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "employer") {
      return res.status(400).json({ message: "This user does not have an NSRP Form II (employer) profile." });
    }

    const profile = await EmployerProfile.findOne({ userId: user._id });
    const buffer = await fillForm2(profile, user);
    sendPdf(res, `NSRP-Form-2-${user._id}.pdf`, buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
