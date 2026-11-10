// The ONE place that decides what one person may see of another person's profile.
// Controllers never pick profile fields themselves: they load the documents,
// resolve the relationship, and call projectJobseeker / projectEmployer. Every
// field a viewer may not see is ABSENT from the result (not null, not hidden by
// the client). See COVER_PHOTO_PLAN.md sections 14 to 17.
//
//   viewer        { id, role } of the signed-in person, or null when signed out
//   target        the User document (or plain object) being viewed
//   profile       the JobseekerProfile / EmployerProfile document, or null
//   relationship  from resolveRelationship()
//   cover         the already-resolved cover descriptor (see section 4.1), optional

const { getAgeTier, TIERS } = require("../utils/age");

const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];
const STAFF_ROLES = ["admin", "superadmin"];

const normalizeRole = (role) => (JOBSEEKER_ROLES.includes(role) ? "jobseeker" : role);
const idOf = (value) => String(value && value._id ? value._id : value);
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc ? { ...doc } : null);

const pick = (source, keys) => {
  const out = {};
  if (!source) return out;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
};
const omit = (source, keys) => {
  const out = { ...source };
  for (const key of keys) delete out[key];
  return out;
};

// ---------------------------------------------------------------- field groups

// Never in any projection for any viewer. (The owner's own account endpoints use
// CLIENT_UNSAFE_FIELDS; this list is the stricter one for OTHER people's data.)
const SECRET_USER_FIELDS = [
  "password",
  "tokenVersion",
  "loginLock",
  "knownDevices",
  "emailCode",
  "googleId",
  "googleSignInDisabled",
  "passwordResetToken",
  "passwordResetExpires",
  "emailVerificationToken",
  "emailVerificationExpires",
  "emailChangeToken",
  "emailChangeExpires",
  "pendingEmail",
  "recoveryEmail",
  "recoveryEmailVerifiedAt",
  "recoveryEmailToken",
  "recoveryEmailExpires",
  "backupCodes",
  "backupCodesGeneratedAt",
  "staffRecoveryToken",
  "staffRecoveryExpires",
  "staffRecoveryRequest",
  "staffRecoveryVersion",
  "staffRecoveryPending",
  "idUploadWindowStartedAt",
  "idUploadCount",
  "mustChangePassword",
  "__v",
];

// Extra fields only the owner or staff may see (internal, not secrets).
const INTERNAL_USER_FIELDS = [
  "staffNote",
  "suspensionReason",
  "suspendedAt",
  "suspendedBy",
  "createdBySuperadmin",
  "notificationPreferences",
  "emailNotificationPreferences",
  "acceptedTermsAt",
  "termsVersion",
  "lastLoginAt",
  "usernameChangedAt",
];

const JOBSEEKER_HIRING_USER = [
  "_id",
  "name",
  "role",
  "profileImage",
  "desiredJobTitle",
  "about",
  "skills",
  "educationalAttainment",
  "workExperience",
  "availabilityStatus",
  "preferredIndustries",
  "industryPreferenceLevel",
];

// What another jobseeker (a peer) sees of an ADULT public profile: a short, friendly
// card, not the hiring view. No contact, no salary, no preferences, no languages,
// no training or licences, no dates of birth. A 15 to 17 year old stays name, photo,
// headline and municipality only.
const JOBSEEKER_PEER_USER = ["_id", "name", "role", "profileImage", "desiredJobTitle", "about", "skills", "educationalAttainment"];
const JOBSEEKER_PEER_PROFILE = ["skills", "schoolAttended", "schoolAttendedOther", "course", "yearGraduated"];
// Work history for a peer: the role, the company and the dates, nothing else.
const PEER_WORK_FIELDS = ["position", "companyName", "dateFrom", "dateTo"];

const JOBSEEKER_HIRING_PROFILE = [
  "skills",
  "preferredIndustries",
  "preferredJobTypes",
  "preferredWorkNature",
  "preferredOccupations",
  "preferredWorkLocationLocal",
  "preferredWorkLocationOverseas",
  "expectedSalaryMin",
  "expectedSalaryMax",
  "schoolAttended",
  "schoolAttendedOther",
  "course",
  "yearGraduated",
  "languageProficiency",
  "languageOthersLabel",
  "workHistory",
  "vocationalTrainings",
  "eligibilities",
  "professionalLicenses",
];

// Contact lives on the account (phone, email) and the profile (landline,
// secondary mobile). An application or a contact share opens only the fields
// listed for it.
const CONTACT_USER_FIELDS = { phone: "phone", email: "email" };

const EMPLOYER_PUBLIC_USER = ["_id", "name", "role", "companyName", "profileImage", "industry", "companySize", "website", "businessAddress", "companyDescription"];
const EMPLOYER_PUBLIC_PROFILE = ["tradeName", "acronym"];
// The employer profile holds company registration and contact-person data that
// is not public.
const EMPLOYER_PRIVATE_PROFILE = ["tin", "fax", "ownerName", "contactPersonName", "contactPersonPosition"];

// ---------------------------------------------------------------- relationship

// What the viewer has to do with the target, computed once per request.
// Employer viewing a jobseeker: an active (not withdrawn) application to one of
// the employer's jobs, a contact share for a conversation with the employer, and
// whether the jobseeker follows the employer. Models are required lazily so unit
// tests can mock them.
const resolveRelationship = async ({ viewer, target }) => {
  const none = { appliedActive: false, includePhoto: false, sharedFields: { phone: false, email: false }, followsEmployer: false };
  if (!viewer || !target) return none;
  const viewerRole = normalizeRole(viewer.role);
  const targetRole = normalizeRole(target.role);
  if (viewerRole !== "employer" || targetRole !== "jobseeker") return none;

  const JobVacancy = require("../models/JobVacancy");
  const JobApplication = require("../models/JobApplication");
  const Follow = require("../models/Follow");
  const ContactShare = require("../models/ContactShare");

  const employerId = idOf(viewer.id || viewer._id);
  const targetId = idOf(target);

  const jobIds = await JobVacancy.find({ employer: employerId }).distinct("_id");
  const [applications, shares, follows] = await Promise.all([
    jobIds.length
      ? JobApplication.find({ applicant: targetId, vacancy: { $in: jobIds }, status: { $ne: "withdrawn" } })
          .select("includePhoto")
          .lean()
      : Promise.resolve([]),
    ContactShare.find({ employer: employerId, jobseeker: targetId, revokedAt: null }).select("fields").lean(),
    Follow.exists({ follower: targetId, following: employerId }),
  ]);

  const sharedFields = { phone: false, email: false };
  for (const share of shares || []) {
    if (share.fields?.phone) sharedFields.phone = true;
    if (share.fields?.email) sharedFields.email = true;
  }
  return {
    appliedActive: Array.isArray(applications) && applications.length > 0,
    includePhoto: Array.isArray(applications) && applications.some((a) => a.includePhoto === true),
    sharedFields,
    followsEmployer: Boolean(follows),
  };
};

// ---------------------------------------------------------------- who may view

const viewerClass = (viewer, target) => {
  if (!viewer) return "none";
  if (STAFF_ROLES.includes(viewer.role)) return "staff";
  if (target && idOf(viewer.id || viewer._id) === idOf(target)) return "owner";
  const role = normalizeRole(viewer.role);
  return role === "jobseeker" || role === "employer" ? role : "none";
};

const isUnavailable = (target) =>
  !target || target.isActive === false || ["suspended", "banned"].includes(target.accountStatus);

// Returns the mode a jobseeker profile is shown in to this viewer:
//   "full" owner, "staff", "hiring" employer, "peer" other jobseeker,
//   "applicationOnly" employer + hidden profile + active application, "none".
const jobseekerMode = ({ viewer, target, relationship }) => {
  const cls = viewerClass(viewer, target);
  if (cls === "owner") return "full";
  if (cls === "staff") return "staff";
  if (cls === "none") return "none";
  if (isUnavailable(target)) return "none";

  const visibility = target.privacy?.profileVisibility || "public";
  const tier = getAgeTier(target.dateOfBirth);
  const minor = tier === TIERS.MINOR || tier === TIERS.UNDER_15;

  if (cls === "employer") {
    // Employers cannot see a 15 to 17 year old in the portal (PESO decides the final rule).
    if (minor) return "none";
    if (visibility === "hidden") return relationship?.appliedActive ? "applicationOnly" : "none";
    return "hiring";
  }
  // Another jobseeker: only a public profile, and a minor only if public.
  if (visibility !== "public") return "none";
  return "peer";
};

const municipalityOf = (profile) => {
  const address = profile?.presentAddress;
  if (!address) return null;
  const parts = [address.municipality, address.province].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(", ") : null;
};

// Phone and email an employer may see: an active application shares both; an
// explicit contact share shares the ticked fields.
const allowedContact = (relationship) => {
  const applied = Boolean(relationship?.appliedActive);
  return {
    phone: applied || Boolean(relationship?.sharedFields?.phone),
    email: applied || Boolean(relationship?.sharedFields?.email),
  };
};

// ---------------------------------------------------------------- projections

const projectJobseeker = ({ viewer, target, profile, relationship, cover }) => {
  const mode = jobseekerMode({ viewer, target, relationship });
  if (mode === "none") return null;

  const user = plain(target);
  const prof = plain(profile) || null;
  const tier = getAgeTier(user.dateOfBirth);

  if (mode === "full") {
    return { mode, user: { ...omit(user, SECRET_USER_FIELDS), ageTier: tier, ...(cover ? { cover } : {}) }, profile: prof };
  }
  if (mode === "staff") {
    return {
      mode,
      user: { ...omit(user, SECRET_USER_FIELDS), ageTier: tier, ...(cover ? { cover } : {}) },
      profile: prof,
    };
  }

  if (mode === "peer") {
    const place = municipalityOf(prof) ? { presentAddress: { municipality: prof.presentAddress.municipality || "" } } : {};
    if (tier === TIERS.MINOR || tier === TIERS.UNDER_15) {
      return {
        mode,
        user: { ...pick(user, ["_id", "name", "role", "profileImage", "desiredJobTitle"]), ...(cover ? { cover } : {}) },
        profile: place,
      };
    }
    const workHistory = (Array.isArray(prof?.workHistory) ? prof.workHistory : [])
      .map((job) => pick(job, PEER_WORK_FIELDS))
      .filter((job) => job.position || job.companyName);
    return {
      mode,
      user: { ...pick(user, JOBSEEKER_PEER_USER), ...(cover ? { cover } : {}) },
      profile: { ...pick(prof, JOBSEEKER_PEER_PROFILE), ...place, ...(workHistory.length ? { workHistory } : {}) },
    };
  }

  const contact = allowedContact(relationship);

  if (mode === "applicationOnly") {
    // A hidden profile with an application: the application's data and the name,
    // nothing else. No cover. The photo only when the applicant ticked "Include my photo".
    const out = pick(user, ["_id", "name", "role"]);
    if (relationship?.includePhoto && user.profileImage !== undefined) out.profileImage = user.profileImage;
    if (contact.phone && user.phone !== undefined) out.phone = user.phone;
    if (contact.email && user.email !== undefined) out.email = user.email;
    return { mode, user: out, profile: {} };
  }

  // "hiring"
  const outUser = { ...pick(user, JOBSEEKER_HIRING_USER), ageTier: tier };
  if (cover) outUser.cover = cover;
  const location = municipalityOf(prof);
  if (location) outUser.address = location;
  if (contact.phone && user.phone !== undefined) outUser.phone = user.phone;
  if (contact.email && user.email !== undefined) outUser.email = user.email;

  const outProfile = pick(prof, JOBSEEKER_HIRING_PROFILE);
  if (prof?.presentAddress) {
    outProfile.presentAddress = { municipality: prof.presentAddress.municipality || "", province: prof.presentAddress.province || "" };
  }
  return { mode, user: outUser, profile: outProfile };
};

// An applicant as shown inside an application list (the employer owns the job and
// the person applied, so contact is allowed). Hidden profiles show only the name
// and the application's own data.
const projectApplicant = ({ user, profile, includePhoto = false }) => {
  const u = plain(user);
  const p = plain(profile);
  const base = { _id: u._id, name: u.name, email: u.email, phone: u.phone, isActive: u.isActive };
  if (u.privacy?.profileVisibility === "hidden") {
    return includePhoto && u.profileImage !== undefined ? { ...base, profileImage: u.profileImage } : base;
  }
  const out = { ...base, skills: u.skills, profile: pick(p, JOBSEEKER_HIRING_PROFILE) };
  const location = municipalityOf(p);
  if (location) out.address = location;
  if (u.workExperience !== undefined) out.workExperience = u.workExperience;
  if (u.educationalAttainment !== undefined) out.educationalAttainment = u.educationalAttainment;
  return out;
};

// Public view of an employer account.
const projectEmployer = ({ viewer, target, profile, cover }) => {
  const cls = viewerClass(viewer, target);
  if (cls === "none") return null;
  if (cls !== "staff" && cls !== "owner" && isUnavailable(target)) return null;

  const user = plain(target);
  const prof = plain(profile) || null;
  if (cls === "owner" || cls === "staff") {
    return { mode: cls === "owner" ? "full" : "staff", user: { ...omit(user, SECRET_USER_FIELDS), ...(cover ? { cover } : {}) }, profile: prof };
  }
  const out = { ...pick(user, EMPLOYER_PUBLIC_USER), verified: user.verificationStatus === "verified" };
  if (cover) out.cover = cover;
  return { mode: "public", user: out, profile: pick(prof, EMPLOYER_PUBLIC_PROFILE) };
};

// For job payloads that embed the employer: signed-out visitors get no email or
// phone, and the employer's registration and contact-person data is never public.
// The employer themself and staff see everything.
const scrubEmployerForJobPayload = (employer, viewer) => {
  if (!employer) return employer;
  const privileged = viewer && (STAFF_ROLES.includes(viewer.role) || idOf(viewer.id || viewer._id) === idOf(employer));
  if (privileged) return employer;
  const out = { ...employer };
  if (!viewer) {
    delete out.email;
    delete out.phone;
  }
  if (out.profile && typeof out.profile === "object") out.profile = omit(out.profile, EMPLOYER_PRIVATE_PROFILE);
  return out;
};

module.exports = {
  JOBSEEKER_ROLES,
  STAFF_ROLES,
  SECRET_USER_FIELDS,
  INTERNAL_USER_FIELDS,
  JOBSEEKER_HIRING_USER,
  JOBSEEKER_HIRING_PROFILE,
  EMPLOYER_PRIVATE_PROFILE,
  CONTACT_USER_FIELDS,
  normalizeRole,
  resolveRelationship,
  viewerClass,
  jobseekerMode,
  allowedContact,
  municipalityOf,
  projectJobseeker,
  projectApplicant,
  projectEmployer,
  scrubEmployerForJobPayload,
};
