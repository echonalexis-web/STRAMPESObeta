import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FaEnvelope,
  FaMapMarkerAlt,
  FaPhone,
  FaBookmark,
  FaFilePdf,
  FaDownload,
  FaBriefcase,
  FaEdit,
  FaUsers,
  FaHeart,
  FaRegNewspaper,
  FaBuilding,
  FaGraduationCap,
  FaIdCard,
  FaGlobe,
  FaLanguage,
  FaCheckCircle,
  FaClock,
  FaTimesCircle,
  FaUserTie,
  FaInfoCircle,
  FaUser,
  FaSlidersH,
  FaEllipsisH,
  FaChevronDown,
  FaChevronUp,
  FaPlus,
  FaCheck,
  FaCamera,
  FaArrowLeft,
  FaSpinner,
} from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { adminAPI, authAPI, employerAPI, jobLikeAPI, messageAPI, followAPI, newsLikeAPI, resolveAssetUrl } from "../services/api";
import SecureFileLink from "../components/SecureFileLink";
import ImageEditorModal from "../components/ImageEditorModal";
import "../styles/profile-redesign.css";

const formatStructuredAddress = (addr) => {
  if (!addr) return "";
  const parts = [addr.street, addr.barangay, addr.municipality, addr.province, addr.region].filter(Boolean);
  return parts.join(", ");
};

const formatAddress = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return formatStructuredAddress(value);
};

const formatDate = (value, options) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", options || { year: "numeric", month: "long", day: "numeric" });
};

const formatMonthYear = (value) => {
  if (!value) return "";
  // Accepts "YYYY-MM" (month input) or a full date string
  const date = value.length <= 7 ? new Date(`${value}-01`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
};

const formatList = (arr) => (Array.isArray(arr) && arr.length ? arr.join(", ") : "");

const formatSalaryRange = (min, max) => {
  const hasMin = min !== null && min !== undefined && min !== "";
  const hasMax = max !== null && max !== undefined && max !== "";
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `₱${Number(n).toLocaleString()}`;
  if (hasMin && hasMax) return `${fmt(min)} – ${fmt(max)}`;
  return hasMin ? `From ${fmt(min)}` : `Up to ${fmt(max)}`;
};

const UNEMPLOYMENT_LABELS = {
  fresh_grad: "fresh graduate",
  finished_contract: "finished contract",
  resigned: "resigned",
  retired: "retired",
  laidoff_local: "laid off (local)",
  laidoff_abroad: "laid off (abroad)",
};

const hasAnyWorkHistory = (profile) =>
  Array.isArray(profile?.workHistory) && profile.workHistory.some((entry) => entry && (entry.companyName || entry.position));

const hasAnyJobPreference = (profile) =>
  Boolean(
    (Array.isArray(profile?.preferredOccupations) && profile.preferredOccupations.length) ||
    (Array.isArray(profile?.preferredJobTypes) && profile.preferredJobTypes.length) ||
    (Array.isArray(profile?.preferredWorkNature) && profile.preferredWorkNature.length) ||
    (Array.isArray(profile?.preferredIndustries) && profile.preferredIndustries.length) ||
    profile?.expectedSalaryMin ||
    profile?.expectedSalaryMax
  );

const hasAnyLanguage = (profile) => {
  const proficiency = profile?.languageProficiency || {};
  return ["English", "Filipino", "Others"].some(
    (lang) => proficiency[lang] && Object.values(proficiency[lang]).some(Boolean)
  );
};

const hasAnyCredential = (profile) =>
  Boolean(
    (Array.isArray(profile?.vocationalTrainings) && profile.vocationalTrainings.some((e) => e && (e.course || e.institution || e.institutionOther))) ||
    (Array.isArray(profile?.eligibilities) && profile.eligibilities.some((e) => e && e.name)) ||
    (Array.isArray(profile?.professionalLicenses) && profile.professionalLicenses.some((e) => e && e.name))
  );

const hasAnyGovId = (profile) =>
  Boolean(profile?.tin || profile?.sssGsisNo || profile?.pagibigNo || profile?.philhealthNo);

const completionForRole = (profile, role) => {
  const checksByRole = {
    resident: [
      Boolean(profile?.name),
      Boolean(profile?.email),
      Boolean(profile?.phone),
      Boolean(profile?.about),
      Boolean(profile?.address),
      Boolean(profile?.dateOfBirth),
      Boolean(profile?.gender),
      Boolean(profile?.civilStatus),
      Boolean(profile?.citizenship),
      Array.isArray(profile?.skills) && profile.skills.length > 0,
      Boolean(profile?.desiredJobTitle),
      Boolean(profile?.educationalAttainment),
      Boolean(profile?.workExperience),
      Boolean(profile?.availabilityStatus),
      Boolean(profile?.resumeFile),
      Boolean(formatStructuredAddress(profile?.presentAddress)),
      Boolean(formatStructuredAddress(profile?.permanentAddress)),
      Boolean(profile?.placeOfBirth),
      hasAnyWorkHistory(profile),
      hasAnyJobPreference(profile),
      hasAnyLanguage(profile),
      hasAnyCredential(profile),
      hasAnyGovId(profile),
    ],
    employer: [
      Boolean(profile?.name),
      Boolean(profile?.email),
      Boolean(profile?.phone),
      Boolean(profile?.companyName),
      Boolean(profile?.industry),
      Boolean(profile?.businessAddressStructured && formatStructuredAddress(profile.businessAddressStructured)),
      Boolean(profile?.website),
      Boolean(profile?.companyDescription),
      Boolean(profile?.tradeName),
      Boolean(profile?.tin),
      Boolean(profile?.contactPersonName),
      Boolean(profile?.businessPermitUrl),
      Boolean(profile?.registrationDocUrl),
      Boolean(profile?.companySize),
      Boolean(profile?.totalWorkforceSize),
      Boolean(profile?.officeType),
      Boolean(profile?.employerClassification?.type),
      Boolean(profile?.ownerName),
    ],
    admin: [Boolean(profile?.name), Boolean(profile?.email), Boolean(profile?.phone)],
  };

  const checks = checksByRole[role] || checksByRole.resident;
  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
};

const RESIDENT_TABS = [
  ["sec-about", "About"],
  ["sec-contact", "Contact & identity"],
  ["sec-personal", "Personal details"],
  ["sec-education", "Education"],
  ["sec-experience", "Work experience"],
  ["sec-preferences", "Job preferences"],
  ["sec-skills", "Skills & languages"],
  ["sec-more", "More"],
];

const EMPLOYER_TABS = [
  ["sec-about", "About"],
  ["sec-company", "Company profile"],
  ["sec-address", "Business address"],
  ["sec-contacts", "Corporate contacts"],
  ["sec-documents", "Documents"],
  ["sec-activity", "Activity"],
];

const DataItem = ({ label, value }) => {
  const filled = value === 0 || Boolean(value);
  return (
    <div className="rd2-di">
      <span className="rd2-di-k">{label}</span>
      <span className={`rd2-di-v${filled ? "" : " is-empty"}`}>{filled ? value : "Not provided"}</span>
    </div>
  );
};

const Section = ({ id, icon, title, tint, children }) => (
  <section id={id} className="rd2-section">
    <div className="rd2-section-head">
      <span className={`rd2-ico${tint ? ` rd2-ico--${tint}` : ""}`}>{icon}</span>
      <h2>{title}</h2>
    </div>
    {children}
  </section>
);

const AccItem = ({ id, title, open, onToggle, children }) => (
  <div className="rd2-acc">
    <button type="button" className="rd2-acc-head" onClick={() => onToggle(id)} aria-expanded={open}>
      <span>{title}</span>
      {open ? <FaChevronUp aria-hidden="true" /> : <FaChevronDown aria-hidden="true" />}
    </button>
    {open ? <div className="rd2-acc-body">{children}</div> : null}
  </div>
);

const EmptyNote = ({ children }) => <p className="rd2-empty">{children}</p>;

const VerificationBadge = ({ status }) => {
  const map = {
    verified: { icon: <FaCheckCircle />, label: "Verified", cls: "rd-verify--verified" },
    pending: { icon: <FaClock />, label: "Pending Verification", cls: "rd-verify--pending" },
    rejected: { icon: <FaTimesCircle />, label: "Verification Rejected", cls: "rd-verify--unverified" },
    unverified: { icon: <FaTimesCircle />, label: "Unverified", cls: "rd-verify--unverified" },
  };
  const entry = map[status] || map.unverified;
  return (
    <span className={`rd-verify-badge ${entry.cls}`}>
      {entry.icon} {entry.label}
    </span>
  );
};

const LANGUAGE_SKILLS = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "speak", label: "Speak" },
  { key: "understand", label: "Understand" },
];

export default function ProfilePage({ isAdminView = false, isEmployerView = false }) {
  const { user, setUser } = useContext(AuthContext);
  const { userId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(isAdminView || isEmployerView ? null : user);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [employerStats, setEmployerStats] = useState({ activeJobs: 0, totalApplicants: 0, closedJobs: 0 });
  const [likedJobs, setLikedJobs] = useState([]);
  const [likedJobsLoading, setLikedJobsLoading] = useState(false);
  const [likedNews, setLikedNews] = useState([]);
  const [likedNewsLoading, setLikedNewsLoading] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState("sec-about");
  const [panels, setPanels] = useState({ demographics: true, govids: false, credentials: false, resume: false });

  const togglePanel = (key) => setPanels((prev) => ({ ...prev, [key]: !prev[key] }));

  const avatarFileInputRef = useRef(null);
  const avatarEditUrlRef = useRef("");
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarEditSrc, setAvatarEditSrc] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const closeAvatarEditor = () => {
    if (avatarEditUrlRef.current) {
      URL.revokeObjectURL(avatarEditUrlRef.current);
      avatarEditUrlRef.current = "";
    }
    setAvatarEditSrc("");
  };

  const handleAvatarFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const acceptedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type)) {
      setAvatarError("Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image must be 5MB or smaller.");
      return;
    }
    setAvatarError("");
    if (avatarEditUrlRef.current) URL.revokeObjectURL(avatarEditUrlRef.current);
    const url = URL.createObjectURL(file);
    avatarEditUrlRef.current = url;
    setAvatarEditSrc(url);
  };

  const handleAvatarCropped = async (file) => {
    closeAvatarEditor();
    setAvatarUploading(true);
    setAvatarError("");
    try {
      const { data } = await authAPI.updateAvatar(file);
      setProfile((prev) => ({ ...(prev || {}), profileImage: data.profileImage }));
      setUser((prev) => (prev ? { ...prev, profileImage: data.profileImage } : prev));
    } catch (err) {
      setAvatarError(err.response?.data?.message || "Upload failed. Please try again.");
    } finally {
      setAvatarUploading(false);
    }
  };

  useEffect(() => () => {
    if (avatarEditUrlRef.current) URL.revokeObjectURL(avatarEditUrlRef.current);
  }, []);

  useEffect(() => {
    if (!avatarModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setAvatarModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [avatarModalOpen]);

  const activeTab = location.pathname.includes("/profile/followers")
    ? "followers"
    : location.pathname.includes("/profile/favorites")
      ? "favorites"
      : location.pathname.includes("/profile/likes")
        ? "likes"
        : "overview";
  const normalizedRole = profile?.role === "employee" || profile?.role === "jobseeker" ? "resident" : profile?.role;
  const isEmployer = normalizedRole === "employer";
  const isAdmin = normalizedRole === "admin";
  const isReadOnly = isAdminView || isEmployerView;

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        let userData = {};
        let profileData = {};
        let statsData = null;

        if (isAdminView && userId) {
          const { data } = await adminAPI.getUserById(userId);
          userData = data.user || {};
          profileData = data.profile || {};
          statsData = data.stats || null;
        } else if (isEmployerView && userId) {
          const { data } = await employerAPI.getJobseekerProfile(userId);
          userData = data.user || {};
          profileData = data.profile || {};
        } else {
          const { data } = await authAPI.getProfile();
          userData = data.user || {};
          profileData = data.profile || {};
        }

        // Start with userData (preserves _id, role, etc.)
        const mergedProfile = { ...userData };

        // For employer, map profileData.businessAddress (object) to businessAddressStructured
        if (userData.role === "employer" && profileData.businessAddress) {
          mergedProfile.businessAddressStructured = profileData.businessAddress;
        }

        // Merge other profile fields, but **EXCLUDE** _id, userId, and __v to avoid overwriting user data
        const { businessAddress, _id, userId: profileUserId, __v, ...restProfile } = profileData;
        Object.assign(mergedProfile, restProfile);

        setProfile(mergedProfile);
        if (!isAdminView && !isEmployerView) {
          setUser(mergedProfile);
        }

        if (mergedProfile.role === "employer") {
          if (isAdminView && statsData) {
            setEmployerStats({
              activeJobs: Number(statsData?.activeJobs || 0),
              totalApplicants: Number(statsData?.totalApplicants || 0),
              closedJobs: Number(statsData?.closedJobs || 0),
            });
          } else {
            const { data: ownStatsData } = await employerAPI.getProfileStats();
            setEmployerStats({
              activeJobs: Number(ownStatsData?.activeJobs || 0),
              totalApplicants: Number(ownStatsData?.totalApplicants || 0),
              closedJobs: Number(ownStatsData?.closedJobs || 0),
            });
          }
        }
      } catch (error) {
        if (isEmployerView) {
          setLoadError(error.response?.data?.message || "You don't have access to this profile.");
        } else if (!isAdminView && user) {
          setProfile(user);
        }
      } finally {
        setLoading(false);
      }
    };

    setLoadError("");
    fetchProfile();
  }, [isAdminView, isEmployerView, userId]);

  useEffect(() => {
    const fetchFavorites = async () => {
      if (activeTab !== "favorites" || isAdmin || isEmployer || isReadOnly) return;

      try {
        setLikedJobsLoading(true);
        const { data } = await jobLikeAPI.getLikedJobs({ page: 1, limit: 60 });
        const list = Array.isArray(data?.data) ? data.data.filter(Boolean) : [];
        setLikedJobs(list);
      } catch (error) {
        setLikedJobs([]);
      } finally {
        setLikedJobsLoading(false);
      }
    };

    fetchFavorites();
  }, [activeTab, isAdmin, isEmployer, isReadOnly]);

  useEffect(() => {
    const fetchLikedNews = async () => {
      if (activeTab !== "likes" || isAdmin || isReadOnly) return;

      try {
        setLikedNewsLoading(true);
        const { data } = await newsLikeAPI.getLiked({ page: 1, limit: 60 });
        const list = Array.isArray(data?.data) ? data.data.filter(Boolean) : [];
        setLikedNews(list);
      } catch (error) {
        setLikedNews([]);
      } finally {
        setLikedNewsLoading(false);
      }
    };

    fetchLikedNews();
  }, [activeTab, isAdmin, isReadOnly]);

  // ===== IMPROVED fetchConnections with validation and fallback =====
  useEffect(() => {
    const fetchConnections = async () => {
      if (activeTab !== "followers") return;

      try {
        setConnectionsLoading(true);
        // Get the correct user ID - prioritize profile ID first since it's already loaded
        let targetUserId = profile?._id || user?._id;

        // Validate: must be a 24-hex-character string
        const isValidObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(id);
        if (!isValidObjectId(targetUserId)) {
          // Fallback: if profile is not loaded, use userId from URL params (for admin view)
          if (userId && isValidObjectId(userId)) {
            targetUserId = userId;
          } else if (user?._id && isValidObjectId(user._id)) {
            targetUserId = user._id;
          } else {
            setFollowers([]);
            setFollowing([]);
            setConnectionsLoading(false);
            return;
          }
        }

        // Residents can never be followed, so there's nothing meaningful to
        // fetch for "Followers" on a resident's own profile — only employers
        // have a real followers list.
        const [followersRes, followingRes] = await Promise.all([
          isEmployer ? followAPI.getFollowers(targetUserId, { page: 1, limit: 100 }) : Promise.resolve(null),
          followAPI.getFollowing(targetUserId, { page: 1, limit: 100 }),
        ]);

        // Extract data from response (handle both { data: [...] } and direct array)
        const followersData = followersRes ? (followersRes.data?.data ?? followersRes.data ?? []) : [];
        const followingData = followingRes.data?.data ?? followingRes.data ?? [];

        setFollowers(Array.isArray(followersData) ? followersData : []);
        setFollowing(Array.isArray(followingData) ? followingData : []);
      } catch (error) {
        setFollowers([]);
        setFollowing([]);
      } finally {
        setConnectionsLoading(false);
      }
    };

    fetchConnections();
  }, [activeTab, profile, user, userId]);

  // Scroll-spy: keep the sticky tab bar in sync with the section in view.
  useEffect(() => {
    if (activeTab !== "overview" || isAdmin) return undefined;
    const tabs = isEmployer ? EMPLOYER_TABS : RESIDENT_TABS;
    const els = tabs.map(([id]) => document.getElementById(id)).filter(Boolean);
    if (!els.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeTab, isAdmin, isEmployer, profile]);

  const handleMessageEmployer = async (job) => {
    let employerId = null;
    if (job.employer && typeof job.employer === 'object') {
      employerId = job.employer._id || job.employer.id || job.employer.userId;
    } else if (typeof job.employer === 'string') {
      employerId = job.employer;
    }
    if (!employerId && job.employerId) employerId = job.employerId;
    const currentUserId = user?._id || user?.id;
    if (!employerId) return;
    if (String(employerId) === String(currentUserId)) return;
    try {
      const { data } = await messageAPI.createConversation({ participantId: employerId });
      const conversationId = data?._id;
      if (!conversationId) throw new Error("Conversation was not created");
      navigate("/messages", { state: { conversationId } });
    } catch (err) {
      console.error("Failed to start conversation:", err);
    }
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const completion = useMemo(() => completionForRole(profile, normalizedRole || "resident"), [profile, normalizedRole]);
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];

  const resumeRef = profile?.resumeFile || null;
  const permitRef = profile?.businessPermitUrl || null;
  const registrationRef = profile?.registrationDocUrl || null;

  const presentAddressText = formatStructuredAddress(profile?.presentAddress);
  const permanentAddressText = formatStructuredAddress(profile?.permanentAddress);
  const businessAddressText = formatStructuredAddress(profile?.businessAddressStructured);

  const workHistory = Array.isArray(profile?.workHistory) ? profile.workHistory.filter((entry) => entry && (entry.companyName || entry.position)) : [];
  const vocationalTrainings = Array.isArray(profile?.vocationalTrainings) ? profile.vocationalTrainings.filter((entry) => entry && (entry.course || entry.institution || entry.institutionOther)) : [];
  const eligibilities = Array.isArray(profile?.eligibilities) ? profile.eligibilities.filter((entry) => entry && entry.name) : [];
  const professionalLicenses = Array.isArray(profile?.professionalLicenses) ? profile.professionalLicenses.filter((entry) => entry && entry.name) : [];

  const languageRows = useMemo(() => {
    const proficiency = profile?.languageProficiency || {};
    const rows = [];
    ["English", "Filipino"].forEach((lang) => {
      if (proficiency[lang] && Object.values(proficiency[lang]).some(Boolean)) {
        rows.push({ label: lang, data: proficiency[lang] });
      }
    });
    if (proficiency.Others && Object.values(proficiency.Others).some(Boolean)) {
      rows.push({ label: profile?.languageOthersLabel || "Other", data: proficiency.Others });
    }
    return rows;
  }, [profile]);

  const hasPreferences = Boolean(
    profile?.desiredJobTitle ||
    formatList(profile?.preferredOccupations) ||
    formatList(profile?.preferredIndustries) ||
    formatList(profile?.preferredJobTypes) ||
    formatList(profile?.preferredWorkNature) ||
    formatList(profile?.preferredWorkLocationLocal) ||
    formatList(profile?.preferredWorkLocationOverseas) ||
    formatSalaryRange(profile?.expectedSalaryMin, profile?.expectedSalaryMax) ||
    profile?.availabilityStatus
  );

  const hasGovIds = Boolean(profile?.tin || profile?.sssGsisNo || profile?.pagibigNo || profile?.philhealthNo);
  const hasCredentials = vocationalTrainings.length > 0 || eligibilities.length > 0 || professionalLicenses.length > 0;
  const hasEducation = Boolean(profile?.educationalAttainment || profile?.course || profile?.schoolAttended || profile?.yearGraduated);

  const aboutText = isEmployer ? (profile?.companyDescription || profile?.about) : profile?.about;
  const schoolName = profile?.schoolAttended === "Other" ? profile?.schoolAttendedOther : profile?.schoolAttended;

  const prefTags = useMemo(() => {
    const merged = [
      ...(Array.isArray(profile?.preferredOccupations) ? profile.preferredOccupations : []),
      ...(Array.isArray(profile?.preferredIndustries) ? profile.preferredIndustries : []),
    ].filter(Boolean);
    return [...new Set(merged)];
  }, [profile]);

  const firstName = (profile?.name || "").trim().split(/\s+/)[0] || (profile?.name || "");
  const contactLocation = isEmployer ? businessAddressText : (profile?.address || presentAddressText);
  const availabilityPhrase = profile?.availabilityStatus ? profile.availabilityStatus.toLowerCase() : "";
  const hasNarrative = Boolean(firstName && (profile?.desiredJobTitle || contactLocation || availabilityPhrase));

  let employmentLabel = profile?.employmentStatus
    ? profile.employmentStatus.charAt(0).toUpperCase() + profile.employmentStatus.slice(1)
    : "Not specified";
  if (profile?.employmentStatus === "unemployed" && profile?.unemploymentReason) {
    employmentLabel += ` — ${UNEMPLOYMENT_LABELS[profile.unemploymentReason] || profile.unemploymentReason.replace(/_/g, " ")}`;
  } else if (profile?.employmentStatus === "employed" && profile?.employmentType) {
    employmentLabel += ` — ${profile.employmentType === "wage" ? "wage employment" : "self-employed"}`;
  }

  const missingItems = [];
  if (!aboutText) missingItems.push("an introduction");
  if (!skills.length) missingItems.push("your skills");
  if (!hasAnyWorkHistory(profile)) missingItems.push("work history");
  if (!hasGovIds) missingItems.push("Government IDs");
  if (!resumeRef) missingItems.push("Resume");
  const shown = missingItems.slice(0, 2);
  const completionHint = completion >= 100 || !shown.length ? (
    "Your profile is complete. Keep it accurate and up to date."
  ) : (
    <>
      Add your {shown.map((item, i) => (
        <span key={item}>
          {i > 0 ? " and " : ""}
          <strong>{item}</strong>
        </span>
      ))}{" "}
      to finish your profile and get better job matches.
    </>
  );

  const displayName = isEmployer ? (profile?.companyName || profile?.name || "Company") : (profile?.name || "User");
  const avatarInitial = isEmployer
    ? (profile?.companyName || profile?.name || "C").trim().charAt(0).toUpperCase()
    : (profile?.name ? profile.name.trim().charAt(0).toUpperCase() : "U");
  const avatarUrl = profile?.profileImage ? resolveAssetUrl(profile.profileImage) : "";
  const sectionTabs = isAdmin ? [] : isEmployer ? EMPLOYER_TABS : RESIDENT_TABS;

  if (!profile && loading) return null;

  if (loadError) {
    return (
      <div className="rd-page">
        <section className="rd-shell">
          <div className="rd-access-error">
            <p>{loadError}</p>
            <button type="button" className="rd2-btn rd2-btn--ghost" onClick={() => navigate(-1)}>Go back</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="rd-page">
      <section className="rd-shell">
        <header className="rd2-head">
          <div className="rd2-head-row">
            <div className="rd2-avatar-wrap">
              <button
                type="button"
                className={`rd2-avatar${isEmployer ? " rd2-avatar--company" : ""}${avatarUrl || !isReadOnly ? " rd2-avatar--clickable" : ""}`}
                onClick={() => {
                  if (avatarUrl) setAvatarModalOpen(true);
                  else if (!isReadOnly) avatarFileInputRef.current?.click();
                }}
                aria-label={avatarUrl ? "View profile photo" : "Add a profile photo"}
              >
                {avatarUrl ? <img src={avatarUrl} alt="" /> : avatarInitial}
              </button>
              {!isReadOnly ? (
                <>
                  <button
                    type="button"
                    className="rd2-avatar-cam"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={avatarUploading}
                    aria-label={avatarUrl ? "Change profile photo" : "Add a profile photo"}
                  >
                    {avatarUploading
                      ? <FaSpinner className="rd2-avatar-cam-spin" aria-hidden="true" />
                      : <FaCamera aria-hidden="true" />}
                  </button>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="rd2-avatar-input"
                    hidden
                    onChange={handleAvatarFile}
                  />
                </>
              ) : null}
            </div>
            <div className="rd2-head-main">
              <h1 className="rd2-name">{displayName}</h1>
              {avatarError ? <p className="rd2-avatar-error">{avatarError}</p> : null}
              {isEmployer && profile?.companyName && profile?.name ? (
                <p className="rd2-repby"><FaUserTie aria-hidden="true" /> Represented by {profile.name}</p>
              ) : null}

              <div className="rd2-badges">
                {isEmployer ? (
                  <>
                    {profile?.industry ? <span className="rd2-role">{profile.industry}</span> : null}
                    <VerificationBadge status={profile?.verificationStatus} />
                  </>
                ) : (
                  <>
                    <span className="rd2-role">{profile?.desiredJobTitle || (isAdmin ? "Administrator" : "Jobseeker")}</span>
                    {profile?.availabilityStatus ? (
                      <span className="rd2-status"><i className="rd2-dot" />{profile.availabilityStatus}</span>
                    ) : null}
                  </>
                )}
              </div>

              <div className="rd2-contact">
                {profile?.email ? <a href={`mailto:${profile.email}`}><FaEnvelope aria-hidden="true" /> {profile.email}</a> : null}
                {profile?.phone ? <a href={`tel:${profile.phone}`}><FaPhone aria-hidden="true" /> {profile.phone}</a> : null}
                {contactLocation ? <span><FaMapMarkerAlt aria-hidden="true" /> {contactLocation}</span> : null}
              </div>
            </div>
            <div className="rd2-actions">
              {!isReadOnly ? (
                <button className="rd2-btn rd2-btn--primary" type="button" onClick={() => navigate("/profile/edit")}>
                  <FaEdit aria-hidden="true" /> Edit profile
                </button>
              ) : null}
              {!isAdmin ? (
                <button className="rd2-btn rd2-btn--ghost" type="button" onClick={() => window.print()}>
                  <FaFilePdf aria-hidden="true" /> Export NSRP Form 1
                </button>
              ) : null}
            </div>
          </div>

          {!isAdmin ? (
            <div className="rd2-progress">
              <div className="rd2-progress-top">
                <span>Profile completion</span>
                <strong>{completion}%</strong>
              </div>
              <div className="rd2-progress-track">
                <div className="rd2-progress-fill" style={{ width: `${completion}%` }} />
              </div>
              {!isEmployer ? <p className="rd2-progress-hint">{completionHint}</p> : null}
            </div>
          ) : null}

          {!isAdmin && !isReadOnly ? (
            <nav className="rd2-utilitynav" aria-label="Profile views">
              <Link to="/profile" className={activeTab === "overview" ? "is-active" : ""}>Overview</Link>
              {!isEmployer ? <Link to="/profile/favorites" className={activeTab === "favorites" ? "is-active" : ""}>Favorites</Link> : null}
              <Link to="/profile/likes" className={activeTab === "likes" ? "is-active" : ""}>My Likes</Link>
              <Link to="/profile/followers" className={activeTab === "followers" ? "is-active" : ""}>
                {isEmployer ? "Followers" : "Following"}
              </Link>
            </nav>
          ) : null}
        </header>

        {activeTab === "overview" && sectionTabs.length > 0 ? (
          <nav className="rd2-tabs" aria-label="Jump to section">
            {sectionTabs.map(([sid, label]) => (
              <button
                key={sid}
                type="button"
                className={`rd2-tab${activeSection === sid ? " is-active" : ""}`}
                onClick={() => scrollToSection(sid)}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        {activeTab === "likes" && !isAdmin ? (
          <section className="rd-card">
            <h2><FaHeart /> My Liked Announcements</h2>
            {likedNewsLoading ? (
              <EmptyNote>Loading your liked announcements...</EmptyNote>
            ) : likedNews.length === 0 ? (
              <EmptyNote>No liked announcements yet. Tap the heart on any post in the News Feed to save it here.</EmptyNote>
            ) : (
              <div className="rd-favorites-grid">
                {likedNews.map((post) => (
                  <article key={post._id} className="rd-favorite-item">
                    <div className="rd-favorite-head">
                      <h3>{post.title || "Untitled announcement"}</h3>
                      <span className="rd-ribbon"><FaHeart /> Liked</span>
                    </div>
                    <p className="rd-favorite-tag"><FaRegNewspaper /> {post.category || "general"}</p>
                    <p>{post.content ? `${post.content.slice(0, 140)}${post.content.length > 140 ? "…" : ""}` : "No details available."}</p>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button type="button" onClick={() => navigate(`/news/${post._id}`)} style={{ flex: 1 }}>Read announcement</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : activeTab === "favorites" && !isEmployer && !isAdmin ? (
          <section className="rd-card">
            <h2><FaBookmark /> Saved / Favorited Jobs</h2>
            {likedJobsLoading ? (
              <EmptyNote>Loading your saved jobs...</EmptyNote>
            ) : likedJobs.length === 0 ? (
              <EmptyNote>No saved jobs yet. Use the heart icon in Browse Jobs to add favorites.</EmptyNote>
            ) : (
              <div className="rd-favorites-grid">
                {likedJobs.map((job) => (
                  <article key={job._id} className="rd-favorite-item">
                    <div className="rd-favorite-head">
                      <h3>{job.title || "Untitled Job"}</h3>
                      <span className="rd-ribbon"><FaBookmark /> Saved</span>
                    </div>
                    <p><FaBriefcase /> {job.employer?.companyName || "Employer"}</p>
                    <p><FaMapMarkerAlt /> {formatAddress(job.location) || "Not provided"}</p>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button type="button" onClick={() => navigate(`/jobs/${job._id}`)} style={{ flex: 1 }}>View / Apply</button>
                      <button type="button" className="btn-employer-icon" onClick={() => handleMessageEmployer(job)} title="Message employer" aria-label="Message employer"><FaEnvelope /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : activeTab === "followers" ? (
          <section className="rd-card">
            <h2><FaUsers /> {isEmployer ? "Followers & Following" : "Following"}</h2>
            {connectionsLoading ? (
              <EmptyNote>Loading connections...</EmptyNote>
            ) : (
              <div className={isEmployer ? "rd-connections-grid" : ""}>
                {isEmployer ? (
                  <div>
                    <h3 className="rd-connections-title">Followers ({followers.length})</h3>
                    {followers.length === 0 ? (
                      <EmptyNote>No followers yet.</EmptyNote>
                    ) : (
                      <div className="rd-connections-list">
                        {followers.map((follower) => {
                          const followerRole = follower.role === "employee" || follower.role === "jobseeker" ? "resident" : follower.role;
                          const canViewProfile = !isReadOnly && followerRole === "resident";
                          return (
                            <div
                              key={follower._id}
                              className={`rd-connection-row${canViewProfile ? " rd-connection-row--clickable" : ""}`}
                              role={canViewProfile ? "button" : undefined}
                              tabIndex={canViewProfile ? 0 : undefined}
                              onClick={canViewProfile ? () => navigate(`/employer/applicants/${follower._id}`) : undefined}
                              onKeyDown={canViewProfile ? (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  navigate(`/employer/applicants/${follower._id}`);
                                }
                              } : undefined}
                            >
                              <div className="rd-connection-avatar">{follower.name?.charAt(0).toUpperCase() || "U"}</div>
                              <div className="rd-connection-info">
                                <p>{follower.name || "User"}</p>
                                <span>{follower.email}</span>
                              </div>
                              {canViewProfile ? <span className="rd-connection-view-hint">View profile ›</span> : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                <div>
                  {isEmployer ? <h3 className="rd-connections-title">Following ({following.length})</h3> : null}
                  {following.length === 0 ? (
                    <EmptyNote>Not following any employers yet. Follow one from a job listing to see their new postings fast-tracked to your recommended jobs.</EmptyNote>
                  ) : (
                    <div className="rd-connections-list">
                      {following.map((followedUser) => (
                        <div key={followedUser._id} className="rd-connection-row">
                          <div className="rd-connection-avatar">{followedUser.name?.charAt(0).toUpperCase() || "U"}</div>
                          <div className="rd-connection-info">
                            <p>{followedUser.name || "User"}</p>
                            <span>{followedUser.email}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : isAdmin ? (
          <main className="rd2-body">
            <Section id="sec-account" icon={<FaUser />} title="Account">
              <div className="rd2-rows">
                <DataItem label="Email" value={profile?.email} />
                <DataItem label="Phone" value={profile?.phone} />
                <DataItem label="Role" value="Administrator" />
                <DataItem label="Account status" value={profile?.isActive === false ? "Inactive" : "Active"} />
              </div>
            </Section>
          </main>
        ) : isEmployer ? (
          <main className="rd2-body">
            <Section id="sec-about" icon={<FaInfoCircle />} title="About">
              {aboutText ? <p className="rd2-about">{aboutText}</p> : <EmptyNote>No company description yet.</EmptyNote>}
            </Section>

            <Section id="sec-company" icon={<FaBuilding />} title="Company profile">
              <div className="rd2-pairs rd2-pairs--3">
                <DataItem label="Company Name" value={profile?.companyName} />
                <DataItem label="Trade Name" value={profile?.tradeName} />
                <DataItem label="Acronym" value={profile?.acronym} />
                <DataItem label="Industry" value={profile?.industry} />
                <DataItem label="Company Size" value={profile?.companySize} />
                <DataItem label="Total Workforce Size" value={profile?.totalWorkforceSize} />
                <DataItem label="Office Type" value={profile?.officeType ? (profile.officeType === "main" ? "Main Office" : "Branch") : null} />
                <DataItem label="Classification" value={profile?.employerClassification?.type} />
                <DataItem label="Classification Subtype" value={profile?.employerClassification?.subtype} />
                <DataItem label="TIN" value={profile?.tin} />
                <DataItem
                  label="Website"
                  value={profile?.website ? <a href={profile.website} target="_blank" rel="noreferrer"><FaGlobe /> {profile.website}</a> : null}
                />
              </div>
            </Section>

            <Section id="sec-address" icon={<FaMapMarkerAlt />} title="Business address">
              <div className="rd2-rows">
                <DataItem label="Business Address" value={businessAddressText} />
              </div>
            </Section>

            <Section id="sec-contacts" icon={<FaUserTie />} title="Corporate contacts">
              <div className="rd2-pairs rd2-pairs--3">
                <DataItem label="Owner / President" value={profile?.ownerName} />
                <DataItem label="Authorized Contact Person" value={profile?.contactPersonName} />
                <DataItem label="Contact Person Position" value={profile?.contactPersonPosition} />
                <DataItem label="Fax" value={profile?.fax} />
              </div>
            </Section>

            <Section id="sec-documents" icon={<FaFilePdf />} title="Documents">
              <div className="rd-doc-grid">
                <div className="rd-doc-item">
                  <span>Business Permit</span>
                  {permitRef ? (
                    <SecureFileLink value={permitRef}><FaDownload /> Download Permit</SecureFileLink>
                  ) : (
                    <EmptyNote>No permit uploaded.</EmptyNote>
                  )}
                </div>
                <div className="rd-doc-item">
                  <span>Registration Document</span>
                  {registrationRef ? (
                    <SecureFileLink value={registrationRef}><FaDownload /> Download Registration</SecureFileLink>
                  ) : (
                    <EmptyNote>No registration document uploaded.</EmptyNote>
                  )}
                </div>
              </div>
            </Section>

            <Section id="sec-activity" icon={<FaBriefcase />} title="Activity">
              <div className="rd-stats-row">
                <article className="rd-stat-card"><strong>{employerStats.activeJobs}</strong><span>Active Jobs</span></article>
                <article className="rd-stat-card"><strong>{employerStats.totalApplicants}</strong><span>Total Applicants</span></article>
                <article className="rd-stat-card"><strong>{employerStats.closedJobs}</strong><span>Closed Jobs</span></article>
              </div>
            </Section>

            <footer className="rd2-foot">Profile data feeds directly into your NSRP Form 1. Keep it accurate and up to date.</footer>
          </main>
        ) : (
          <main className="rd2-body">
            <Section id="sec-about" icon={<FaInfoCircle />} title="About">
              {hasNarrative ? (
                <p className="rd2-about">
                  <strong>{firstName}</strong>
                  {profile?.desiredJobTitle ? <> is a <strong>{profile.desiredJobTitle}</strong></> : <> is registered</>}
                  {contactLocation ? <> from {contactLocation}</> : null}
                  {availabilityPhrase ? <>, currently <strong className="rd2-accent">{availabilityPhrase}</strong> for work</> : null}.
                  {profile?.about ? <> &ldquo;{profile.about}&rdquo;</> : null}
                </p>
              ) : profile?.about ? (
                <p className="rd2-about">&ldquo;{profile.about}&rdquo;</p>
              ) : (
                <EmptyNote>No introduction added yet.</EmptyNote>
              )}
            </Section>

            <Section id="sec-contact" icon={<FaIdCard />} title="Contact & identity">
              <div className="rd2-rows">
                <DataItem label="Email" value={profile?.email} />
                <DataItem label="Phone" value={profile?.phone} />
                <DataItem label="Landline" value={profile?.landline} />
                <DataItem label="Secondary mobile" value={profile?.mobileSecondary} />
                <DataItem label="Present address" value={presentAddressText} />
                <DataItem label="Permanent address" value={permanentAddressText} />
              </div>
            </Section>

            <Section id="sec-personal" icon={<FaUser />} title="Personal details">
              <div className="rd2-pairs">
                <DataItem label="Date of birth" value={formatDate(profile?.dateOfBirth)} />
                <DataItem label="Citizenship" value={profile?.citizenship} />
                <DataItem label="Gender" value={profile?.gender} />
                <DataItem label="Place of birth" value={profile?.placeOfBirth} />
                <DataItem label="Civil status" value={profile?.civilStatus} />
                <DataItem label="Religion" value={profile?.religion} />
              </div>
            </Section>

            <Section id="sec-education" icon={<FaGraduationCap />} title="Education">
              {hasEducation ? (
                <div className="rd2-timeline">
                  <div className="rd2-tl-item">
                    <span className="rd2-tl-dot" />
                    <div className="rd2-tl-body">
                      {profile?.yearGraduated ? <span className="rd2-tl-kicker">Graduated {profile.yearGraduated}</span> : null}
                      <strong>{profile?.course || "Course not specified"}</strong>
                      {schoolName ? <p>{schoolName}</p> : null}
                      {profile?.educationalAttainment ? <p className="rd2-tl-meta">Attainment: {profile.educationalAttainment}</p> : null}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyNote>No education details added yet.</EmptyNote>
              )}
            </Section>

            <Section id="sec-experience" icon={<FaBriefcase />} title="Work experience">
              <div className="rd2-status-line">
                <span className="rd2-tl-kicker">Current status</span>
                <strong className="rd2-warn">{employmentLabel}</strong>
                <span className="rd2-status-sub">
                  {workHistory.length ? `${workHistory.length} previous employer${workHistory.length > 1 ? "s" : ""}` : "No previous work history"}
                  {profile?.workExperience ? ` · years of experience: ${profile.workExperience}` : ""}
                </span>
              </div>

              {workHistory.length > 0 ? (
                <div className="rd2-timeline">
                  {workHistory.map((entry, index) => (
                    <div className="rd2-tl-item" key={index}>
                      <span className="rd2-tl-dot" />
                      <div className="rd2-tl-body">
                        <div className="rd2-tl-head">
                          <strong>{entry.position || "Position"}</strong>
                          <span>{formatMonthYear(entry.dateFrom)} – {entry.status === "present" ? "Present" : formatMonthYear(entry.dateTo)}</span>
                        </div>
                        <p>{entry.companyName}{entry.address ? ` · ${entry.address}` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rd2-emptybox">
                  <span>No previous work history added yet.</span>
                  {!isReadOnly ? (
                    <button type="button" className="rd2-addlink" onClick={() => navigate("/profile/edit")}>
                      <FaPlus aria-hidden="true" /> Add work history
                    </button>
                  ) : null}
                </div>
              )}
            </Section>

            <Section id="sec-preferences" icon={<FaSlidersH />} title="Job preferences" tint="violet">
              {hasPreferences ? (
                <>
                  <div className="rd2-pairs">
                    <DataItem label="Desired job title" value={profile?.desiredJobTitle} />
                    <DataItem label="Preferred work setup" value={formatList(profile?.preferredWorkNature)} />
                    <DataItem label="Availability" value={profile?.availabilityStatus} />
                    <DataItem label="Locations (local)" value={formatList(profile?.preferredWorkLocationLocal)} />
                    <DataItem label="Expected salary" value={formatSalaryRange(profile?.expectedSalaryMin, profile?.expectedSalaryMax)} />
                    <DataItem label="Locations (overseas)" value={formatList(profile?.preferredWorkLocationOverseas)} />
                    <DataItem label="Preferred job types" value={formatList(profile?.preferredJobTypes)} />
                  </div>
                  {prefTags.length > 0 ? (
                    <>
                      <p className="rd2-subhead">Preferred occupations &amp; industries</p>
                      <div className="rd2-pills">
                        {prefTags.map((tag) => <span key={tag} className="rd2-pill">{tag}</span>)}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <EmptyNote>No job preferences set yet.</EmptyNote>
              )}
            </Section>

            <Section id="sec-skills" icon={<FaLanguage />} title="Skills & languages" tint="blue">
              <p className="rd2-subhead">Skills</p>
              <div className="rd2-pills">
                {skills.length ? skills.map((skill) => <span key={skill} className="rd2-pill">{skill}</span>) : <EmptyNote>No skills added yet.</EmptyNote>}
              </div>

              {languageRows.length > 0 ? (
                <div className="rd2-langtable">
                  <div className="rd2-langrow is-head">
                    <span className="rd2-lang-name">Language</span>
                    {LANGUAGE_SKILLS.map((skill) => <span key={skill.key}>{skill.label}</span>)}
                  </div>
                  {languageRows.map((row) => (
                    <div className="rd2-langrow" key={row.label}>
                      <span className="rd2-lang-name">{row.label}</span>
                      {LANGUAGE_SKILLS.map((skill) => (
                        <span key={skill.key} className="rd2-lang-cell">
                          {row.data[skill.key] ? <span className="rd2-check"><FaCheck aria-hidden="true" /></span> : <span className="rd2-dash">—</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rd2-langtable-empty"><EmptyNote>No language proficiency added yet.</EmptyNote></div>
              )}
            </Section>

            <Section id="sec-more" icon={<FaEllipsisH />} title="More">
              <div className="rd2-accordion">
                <AccItem id="demographics" title="Demographics" open={panels.demographics} onToggle={togglePanel}>
                  <div className="rd2-pairs">
                    <DataItem label="Height" value={profile?.height ? `${profile.height} cm` : null} />
                    <DataItem label="4Ps beneficiary" value={profile?.is4psBeneficiary ? `Yes${profile?._4psHouseholdId ? ` (${profile._4psHouseholdId})` : ""}` : "No"} />
                    <DataItem label="Weight" value={profile?.weight ? `${profile.weight} kg` : null} />
                    <DataItem label="OFW" value={profile?.isOfw ? "Yes" : "No"} />
                    <DataItem label="Disability" value={Array.isArray(profile?.disability) && profile.disability.length ? profile.disability.join(", ") : "None"} />
                    <DataItem label="Repatriated" value={profile?.isRepatriated ? "Yes" : "No"} />
                    {profile?.isRepatriated ? <DataItem label="Repatriation intent" value={profile?.repatriationIntent} /> : null}
                    {profile?.passportNo ? <DataItem label="Passport no." value={profile?.passportNo} /> : null}
                    {profile?.passportExpiryDate ? <DataItem label="Passport expiry" value={formatDate(profile?.passportExpiryDate)} /> : null}
                  </div>
                </AccItem>

                <AccItem id="govids" title="Government IDs" open={panels.govids} onToggle={togglePanel}>
                  {hasGovIds ? (
                    <div className="rd2-pairs">
                      <DataItem label="TIN" value={profile?.tin} />
                      <DataItem label="SSS / GSIS No." value={profile?.sssGsisNo} />
                      <DataItem label="PAG-IBIG No." value={profile?.pagibigNo} />
                      <DataItem label="PhilHealth No." value={profile?.philhealthNo} />
                    </div>
                  ) : (
                    <EmptyNote>No government ID numbers added yet.</EmptyNote>
                  )}
                </AccItem>

                {hasCredentials ? (
                  <AccItem id="credentials" title="Training & credentials" open={panels.credentials} onToggle={togglePanel}>
                    {vocationalTrainings.length > 0 ? (
                      <div className="rd-sublist">
                        <h3>Vocational / Technical Training</h3>
                        {vocationalTrainings.map((entry, index) => (
                          <div className="rd-sublist-item" key={index}>
                            <strong>{entry.course}</strong>
                            <span>{entry.institution === "Other" ? entry.institutionOther : entry.institution}{entry.certificate ? ` · ${entry.certificate}` : ""}</span>
                            {(entry.durationFrom || entry.durationTo) ? (
                              <span className="rd-sublist-dates">{formatMonthYear(entry.durationFrom)} – {formatMonthYear(entry.durationTo)}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {eligibilities.length > 0 ? (
                      <div className="rd-sublist">
                        <h3>Civil Service Eligibility</h3>
                        {eligibilities.map((entry, index) => (
                          <div className="rd-sublist-item" key={index}>
                            <strong>{entry.name}</strong>
                            <span>{entry.rating ? `Rating: ${entry.rating}` : ""}</span>
                            {entry.examDate ? <span className="rd-sublist-dates">{formatDate(entry.examDate, { year: "numeric", month: "short", day: "numeric" })}</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {professionalLicenses.length > 0 ? (
                      <div className="rd-sublist">
                        <h3>Professional Licenses</h3>
                        {professionalLicenses.map((entry, index) => (
                          <div className="rd-sublist-item" key={index}>
                            <strong>{entry.name}</strong>
                            {entry.validUntil ? <span className="rd-sublist-dates">Valid until {formatDate(entry.validUntil, { year: "numeric", month: "short", day: "numeric" })}</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </AccItem>
                ) : null}

                <AccItem id="resume" title="Resume" open={panels.resume} onToggle={togglePanel}>
                  {resumeRef ? (
                    <SecureFileLink className="rd2-doclink" value={resumeRef}><FaDownload aria-hidden="true" /> Download resume</SecureFileLink>
                  ) : (
                    <EmptyNote>No resume uploaded.</EmptyNote>
                  )}
                </AccItem>
              </div>
            </Section>

            <footer className="rd2-foot">Profile data feeds directly into your NSRP Form 1. Keep it accurate and up to date.</footer>
          </main>
        )}
      </section>

      {avatarModalOpen && avatarUrl ? (
        <div
          className="rd2-photo-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Profile photo"
          onClick={() => setAvatarModalOpen(false)}
        >
          <button
            type="button"
            className="rd2-photo-modal-back"
            onClick={() => setAvatarModalOpen(false)}
          >
            <FaArrowLeft aria-hidden="true" /> Back
          </button>
          <img
            src={avatarUrl}
            alt={`${displayName} profile photo`}
            className="rd2-photo-modal-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      <ImageEditorModal
        open={Boolean(avatarEditSrc)}
        src={avatarEditSrc}
        cropShape="round"
        title="Adjust your photo"
        fileName="avatar.jpg"
        onCancel={closeAvatarEditor}
        onConfirm={handleAvatarCropped}
      />
    </div>
  );
}
