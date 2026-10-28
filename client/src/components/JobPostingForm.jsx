import { useTranslation } from "react-i18next";
import { useState, useContext, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { employerAPI, adminAPI, jobAPI } from "../services/api";
import "../styles/post-job.css";
import {
  FaBriefcase,
  FaMapMarkerAlt,
  FaMoneyBillWave,
  FaCalendarAlt,
  FaUserPlus,
  FaSave,
  FaSpinner,
  FaExclamationTriangle,
  FaCheckCircle,
  FaArrowLeft,
  FaBuilding,
  FaListUl,
  FaClipboardList,
  FaCoins,
  FaUsers,
  FaInfoCircle,
  FaMinus,
  FaPlus,
  FaCheck,
  FaSlidersH,
} from "react-icons/fa";
import LocationSelect from "../components/LocationSelect";
import QualificationsEditor from "../components/QualificationsEditor";
import BasicRequirements from "../components/BasicRequirements";
import Autosuggest from "../components/Autosuggest";
import MatchWeightsEditor from "../components/MatchWeightsEditor";
import { useToast } from "../components/feedback/context";
import { CODE_FALLBACK_WEIGHTS } from "../utils/qualifications";
import PH_JOB_TITLES from "../data/ph_job_titles_complete.json";
import {
  EMPTY_BASIC_REQUIREMENTS,
  pickBasicRequirements,
  serializeBasicRequirements,
  validateBasicRequirements,
} from "../utils/basicRequirements";
import VacancyCard from "../components/VacancyCard";
import { usePersistentState } from "../hooks/usePersistentState";
import { useSystemOptions } from "../hooks/useSystemOptions";
import { VALID_INDUSTRIES as INDUSTRIES_FALLBACK } from "../constants/industries";
import { JOB_TYPES as JOB_TYPES_FALLBACK, JOB_TYPE_LABELS } from "../constants/jobTypes";

const WORK_NATURES = [
  { value: "onsite", label: "Onsite" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
];

const TITLE_QUICK_FILLS = ["Service Crew", "Cashier", "Kitchen Staff", "Delivery Rider"];

const DEADLINE_QUICK_PICKS = [
  { id: "1w", label: "1 week", days: 7 },
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "1m", label: "1 month", days: 30 },
];

const DESCRIPTION_SECTIONS = [
  { id: "responsibilities", label: "Responsibilities", heading: "Responsibilities", lines: ["", ""] },
  { id: "schedule", label: "Work schedule", heading: "Work Schedule", lines: [""] },
  { id: "benefits", label: "Benefits", heading: "Benefits", lines: ["", ""] },
];

const addDaysIso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

const formatSalaryPreview = (min, max) => {
  const hasMin = min !== "" && min !== null && min !== undefined && Number.isFinite(Number(min));
  const hasMax = max !== "" && max !== null && max !== undefined && Number.isFinite(Number(max));
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `PHP ${Number(n).toLocaleString("en-PH")}`;
  if (hasMin && hasMax && Number(min) !== Number(max)) return `${fmt(min)} - ${fmt(max)}`;
  return fmt(hasMin ? min : max);
};

const getInitialFormData = () => ({
  title: "",
  description: "",
  location: "",
  salaryMin: "",
  salaryMax: "",
  industry: [],
  jobType: "Full-time",
  workNature: "",
  slots: 1,
  qualifications: [],
  applicationDeadline: "",
  ...EMPTY_BASIC_REQUIREMENTS,
});

export default function JobPostingForm({ initialJob = null, onSaved, onCancel }) {
  const { t } = useTranslation();
  const isEditing = Boolean(initialJob);
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  // Admin-maintainable catalogs (item 11) — live from the server, with the
  // old hardcoded lists as a fallback for first paint / offline.
  const { options: VALID_INDUSTRIES } = useSystemOptions("industry", { fallback: INDUSTRIES_FALLBACK });
  const { options: JOB_TYPES } = useSystemOptions("jobType", {
    fallback: JOB_TYPES_FALLBACK,
    extra: ["Remote"],
  });

  // Tolerates a not-yet-migrated vacancy where `industry` is still a plain
  // string (server/scripts/migrateIndustryToArray.js backfills these).
  const normalizeIndustry = (value) => (Array.isArray(value) ? value : (value ? [value] : []));

  const defaultState = {
    formData: initialJob ? {
      ...getInitialFormData(),
      ...initialJob,
      salaryMin: initialJob.salaryMin ?? "",
      salaryMax: initialJob.salaryMax ?? "",
      industry: normalizeIndustry(initialJob.industry),
      workNature: initialJob.workNature || "",
      applicationDeadline: initialJob.applicationDeadline ? initialJob.applicationDeadline.slice(0, 10) : "",
      ...pickBasicRequirements(initialJob),
    } : getInitialFormData(),
    activeSection: "basics",
  };

  // Normalize form data to ensure arrays exist
  const normalizeFormData = (data) => {
    return {
      ...getInitialFormData(),
      ...data,
      industry: normalizeIndustry(data?.industry),
      qualifications: Array.isArray(data?.qualifications) ? data.qualifications : [],
      languageRequirements: Array.isArray(data?.languageRequirements) ? data.languageRequirements : [],
    };
  };

  // Scoped to the signed-in account — a bare "postJobState" key would be
  // shared by every account that ever uses this browser, so a different
  // employer signing in later could inherit someone else's draft posting.
  const currentUserId = user?._id || user?.id || null;
  const [persistedState, setPersistedState, clearPersistedState] = usePersistentState(
    !isEditing && currentUserId ? `postJobState_${currentUserId}` : null,
    defaultState
  );

  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.formData)
    ? { ...persistedState, formData: normalizeFormData(persistedState.formData) }
    : defaultState;

  const { formData, activeSection } = safeState;
  const setFormData = useCallback((updater) => {
    setPersistedState((prev) => {
      const newFormData = typeof updater === 'function' ? updater(prev.formData) : updater;
      if (newFormData === prev.formData) return prev;
      return { ...prev, formData: newFormData };
    });
  }, [setPersistedState]);

  const setActiveSection = useCallback((updater) => {
    setPersistedState((prev) => {
      const newVal = typeof updater === 'function' ? updater(prev.activeSection) : updater;
      if (newVal === prev.activeSection) return prev;
      return { ...prev, activeSection: newVal };
    });
  }, [setPersistedState]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  // Reusable qualification / skillset templates
  const [qualTemplates, setQualTemplates] = useState([]);
  // Requirements of the job that was just posted (for the "save as template" CTA)
  const [postedQualifications, setPostedQualifications] = useState(null);
  const [postedJobTitle, setPostedJobTitle] = useState("");
  const [postTemplateName, setPostTemplateName] = useState("");
  const [savingPostTemplate, setSavingPostTemplate] = useState(false);
  const [postTemplateMsg, setPostTemplateMsg] = useState("");

  // §C.1 — per-vacancy job-matching weight override. A separate resource
  // (GET/PUT/DELETE /api/jobs/:id/match-weights) from the job's own CRUD
  // endpoint, so it only applies — and only has an id to save against — once
  // the job itself already exists; a brand-new, not-yet-posted job has
  // nowhere to save an override to, so this section only renders while
  // editing. NOTE: that backend endpoint doesn't exist yet — see
  // markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this calls.
  const [matchWeightsOverride, setMatchWeightsOverride] = useState(null); // null = no override saved
  const [matchWeightsEmployerDefault, setMatchWeightsEmployerDefault] = useState(null);
  const [matchWeightBounds, setMatchWeightBounds] = useState(null);
  const [useCustomMatchWeights, setUseCustomMatchWeights] = useState(false);
  const [matchWeightsLoaded, setMatchWeightsLoaded] = useState(false);
  const [matchWeightsLoading, setMatchWeightsLoading] = useState(false);
  const [matchWeightsSaving, setMatchWeightsSaving] = useState(false);
  const [matchWeightsError, setMatchWeightsError] = useState("");

  useEffect(() => {
    if (!isEditing || !initialJob?._id || matchWeightsLoaded) return;
    let cancelled = false;
    setMatchWeightsLoading(true);
    jobAPI.getMatchWeights(initialJob._id)
      .then((res) => {
        if (cancelled) return;
        setMatchWeightsOverride(res.data?.weights || null);
        setMatchWeightsEmployerDefault(res.data?.employerDefault || null);
        setMatchWeightBounds(res.data?.bounds || null);
        setUseCustomMatchWeights(Boolean(res.data?.isCustom));
        setMatchWeightsLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMatchWeightsError(
          err.response?.status === 404
            ? "Custom matching weights aren't available yet — this feature's backend is still being built."
            : err.response?.data?.message || "Failed to load this job's matching weights."
        );
      })
      .finally(() => { if (!cancelled) setMatchWeightsLoading(false); });
    return () => { cancelled = true; };
  }, [isEditing, initialJob?._id, matchWeightsLoaded]);

  const handleSaveMatchWeightsOverride = async (weights) => {
    setMatchWeightsSaving(true);
    setMatchWeightsError("");
    try {
      const res = await jobAPI.updateMatchWeights(initialJob._id, { weights });
      setMatchWeightsOverride(res.data?.weights || weights);
      toast.success("Custom matching weights saved for this job");
    } catch (err) {
      setMatchWeightsError(err.response?.data?.message || "Failed to save this job's matching weights.");
    } finally {
      setMatchWeightsSaving(false);
    }
  };

  const handleRemoveMatchWeightsOverride = async () => {
    setMatchWeightsSaving(true);
    setMatchWeightsError("");
    try {
      await jobAPI.resetMatchWeights(initialJob._id);
      setMatchWeightsOverride(null);
      setUseCustomMatchWeights(false);
      toast.success("Reverted to your default matching weights");
    } catch (err) {
      setMatchWeightsError(err.response?.data?.message || "Failed to remove this job's custom weights.");
    } finally {
      setMatchWeightsSaving(false);
    }
  };

  const loadQualTemplates = async () => {
    try {
      const res = await employerAPI.getQualificationTemplates();
      setQualTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
    } catch {
      setQualTemplates([]); // editor falls back to its built-in static templates
    }
  };

  const handleSaveQualTemplate = async ({ name, items }) => {
    const res = await employerAPI.createQualificationTemplate({
      name,
      jobTitle: formData.title || "",
      items,
    });
    await loadQualTemplates();
    return res;
  };

  useEffect(() => {
    if (!user || isEditing) return;
    if (user.role !== "employer") {
      navigate("/dashboard");
      return;
    }
    if (user.verificationStatus !== "verified") {
      navigate("/employer-dashboard");
      return;
    }
    loadQualTemplates();
  }, [user, navigate, isEditing]);

  const validateField = (name, value) => {
    const errors = {};
    switch (name) {
      case "title":
        if (!value.trim()) errors.title = "Job title is required";
        else if (value.trim().length < 5) errors.title = "At least 5 characters";
        else if (value.trim().length > 100) errors.title = "Max 100 characters";
        break;
      case "description":
        if (!value.trim()) errors.description = "Job description is required";
        else if (value.trim().length < 20) errors.description = "At least 20 characters";
        else if (value.trim().length > 5000) errors.description = "Max 5000 characters";
        break;
      case "location":
        if (!value.trim()) errors.location = "Location is required";
        break;
      case "qualifications":
        if (!value || value.length === 0) errors.qualifications = "At least one qualification is required";
        break;
      case "industry":
        if (!Array.isArray(value) || value.length === 0) errors.industry = "Select at least one industry";
        break;
      case "slots":
        if (value < 1) errors.slots = "Min 1 slot";
        else if (value > 100) errors.slots = "Max 100 slots";
        break;
      case "salaryMin":
      case "salaryMax": {
        if (value === "" || value === null || value === undefined) break;
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          errors[name] = "Enter a valid amount";
        }
        break;
      }
      case "applicationDeadline":
        if (value && (!isEditing || value !== defaultState.formData.applicationDeadline) && new Date(value) < new Date(new Date().setHours(0, 0, 0, 0)))
          errors.applicationDeadline = "Must be today or later";
        break;
    }
    return errors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      const errs = validateField(name, value);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    const errs = validateField(name, formData[name]);
    setValidationErrors((prev) => ({ ...prev, ...errs }));
  };

  // Cancel discards the saved draft so the form starts blank next time.
  const handleCancel = () => {
    if (isEditing) return onCancel();
    clearPersistedState();
    navigate("/employer");
  };

  const registeredBusinessAddress = (() => {
    if (!user) return "";

    const makeAddressString = (structured) => {
      if (!structured || typeof structured !== "object") return "";

      const parts = [
        structured.street,
        structured.barangay,
        structured.municipality || structured.city,
        structured.province,
        structured.region,
      ]
        .filter((part) => typeof part === "string" && part.trim())
        .map((part) => part.trim());

      return parts.join(", ");
    };

    const structuredObjectCandidates = [
      user.businessAddressStructured,
      user.businessAddressDetails,
      user.profile?.businessAddressStructured,
      user.profile?.businessAddress,
      user.profile?.address,
    ];

    for (const structured of structuredObjectCandidates) {
      const value = makeAddressString(structured);
      if (value) return value;
    }

    const stringCandidates = [
      user.businessAddress,
      user.address,
      user.profile?.businessAddress,
      user.profile?.address,
    ];

    for (const candidate of stringCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "";
  })();

  // Defaults to the registered address (per-section "Pay & location" uses a
  // summary card, not a checkbox) — "Use a different location" switches to
  // the cascading picker below. A brand-new (create-mode) draft with no
  // location yet and a usable registered address auto-adopts it once.
  const [useRegisteredBusinessAddress, setUseRegisteredBusinessAddress] = useState(
    () => !isEditing && Boolean(registeredBusinessAddress) && !defaultState.formData.location
  );
  const [locationSelectResetKey, setLocationSelectResetKey] = useState(0);
  const appliedDefaultAddressRef = useRef(false);

  useEffect(() => {
    if (isEditing || appliedDefaultAddressRef.current) return;
    if (!useRegisteredBusinessAddress || !registeredBusinessAddress) return;
    if (formData.location) {
      appliedDefaultAddressRef.current = true;
      return;
    }
    appliedDefaultAddressRef.current = true;
    setFormData((prev) => ({ ...prev, location: registeredBusinessAddress }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useRegisteredBusinessAddress, registeredBusinessAddress, isEditing]);

  const handleUseRegisteredAddress = () => {
    setUseRegisteredBusinessAddress(true);
    if (registeredBusinessAddress) {
      setFormData((prev) => ({ ...prev, location: registeredBusinessAddress }));
      setValidationErrors((prev) => ({ ...prev, location: "" }));
    } else {
      setValidationErrors((prev) => ({ ...prev, location: "No registered business address found. Please update your profile." }));
    }
    setTouched((prev) => ({ ...prev, location: true }));
  };

  const handleUseDifferentLocation = () => {
    setUseRegisteredBusinessAddress(false);
    setFormData((prev) => ({ ...prev, location: "" }));
    setLocationSelectResetKey((prev) => prev + 1);
    setTouched((prev) => ({ ...prev, location: true }));
    setValidationErrors((prev) => ({ ...prev, location: "Location is required" }));
  };

  const handleLocationChange = (nextLocation) => {
    setFormData((prev) => ({ ...prev, location: nextLocation }));
    if (touched.location) {
      const errs = validateField("location", nextLocation);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  const handleQualificationsChange = (newQuals) => {
    setFormData((prev) => ({ ...prev, qualifications: newQuals }));
    if (touched.qualifications) {
      const errs = validateField("qualifications", newQuals);
      setValidationErrors((prev) => ({ ...prev, ...errs }));
    }
  };

  // ---- Job basics: title quick-fill, job-type chips, slots stepper, description sections ----
  const applyTitleQuickFill = (title) => {
    setFormData((prev) => ({ ...prev, title }));
    setTouched((prev) => ({ ...prev, title: true }));
    setValidationErrors((prev) => ({ ...prev, ...validateField("title", title) }));
  };

  const setJobType = (jobType) => setFormData((prev) => ({ ...prev, jobType }));

  const toggleIndustry = (industry) => {
    setFormData((prev) => ({
      ...prev,
      industry: prev.industry.includes(industry)
        ? prev.industry.filter((item) => item !== industry)
        : [...prev.industry, industry],
    }));
    setTouched((prev) => ({ ...prev, industry: true }));
    setValidationErrors((prev) => ({
      ...prev,
      ...validateField("industry", formData.industry.includes(industry)
        ? formData.industry.filter((item) => item !== industry)
        : [...formData.industry, industry]),
    }));
  };

  const adjustSlots = (delta) => {
    setFormData((prev) => {
      const next = Math.min(100, Math.max(1, (Number(prev.slots) || 1) + delta));
      return { ...prev, slots: next };
    });
    setTouched((prev) => ({ ...prev, slots: true }));
  };

  const insertDescriptionSection = (section) => {
    const block = [section.heading + ":", ...section.lines.map((l) => `- ${l}`)].join("\n");
    setFormData((prev) => {
      const sep = prev.description.trim() ? "\n\n" : "";
      const next = `${prev.description}${sep}${block}`;
      return { ...prev, description: next };
    });
  };

  // ---- Pay & location: salary mode, deadline quick-picks ----
  const [salaryMode, setSalaryMode] = useState(() =>
    (defaultState.formData.salaryMin !== "" || defaultState.formData.salaryMax !== "") ? "range" : "negotiable"
  );

  const setSalaryNegotiable = () => {
    setSalaryMode("negotiable");
    setFormData((prev) => ({ ...prev, salaryMin: "", salaryMax: "" }));
    setValidationErrors((prev) => ({ ...prev, salaryMin: "", salaryMax: "" }));
  };

  const setSalaryRangeMode = () => setSalaryMode("range");

  const [deadlineQuickPick, setDeadlineQuickPick] = useState("");

  const applyDeadlineQuickPick = (pick) => {
    setDeadlineQuickPick(pick.id);
    setFormData((prev) => ({ ...prev, applicationDeadline: addDaysIso(pick.days) }));
    setTouched((prev) => ({ ...prev, applicationDeadline: true }));
    setValidationErrors((prev) => ({ ...prev, applicationDeadline: "" }));
  };

  const clearDeadline = () => {
    setDeadlineQuickPick("none");
    setFormData((prev) => ({ ...prev, applicationDeadline: "" }));
    setValidationErrors((prev) => ({ ...prev, applicationDeadline: "" }));
  };

  const validateForm = () => {
    const errors = {};
    ["title", "description", "location", "industry", "qualifications", "slots", "salaryMin", "salaryMax"].forEach((field) => {
      const fieldErrors = validateField(field, formData[field]);
      Object.assign(errors, fieldErrors);
    });
    if (
      formData.salaryMin !== "" && formData.salaryMax !== "" &&
      Number(formData.salaryMin) > Number(formData.salaryMax)
    ) {
      errors.salaryMax = "Maximum must be greater than or equal to minimum";
    }
    if (formData.applicationDeadline && (!isEditing || formData.applicationDeadline !== defaultState.formData.applicationDeadline) && new Date(formData.applicationDeadline) < new Date(new Date().setHours(0, 0, 0, 0)))
      errors.applicationDeadline = "Must be today or later";
    const basicReqIssues = validateBasicRequirements(pickBasicRequirements(formData));
    if (basicReqIssues.length > 0) errors.basicRequirements = basicReqIssues[0];
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ---- "Before you post" checklist — also gates the submit button ----
  const checklist = [
    { id: "title", label: "Job title", done: Boolean(formData.title.trim()) },
    { id: "description", label: "Description (40+ characters)", done: formData.description.trim().length >= 40 },
    { id: "industry", label: "Industry", done: formData.industry.length > 0 },
    { id: "location", label: "Work location", done: Boolean(formData.location.trim()) },
    { id: "qualification", label: "At least one qualification", done: formData.qualifications.length > 0 },
  ];
  const remainingRequired = checklist.filter((c) => !c.done).length;
  const canPost = remainingRequired === 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    const allTouched = Object.keys(formData).reduce((acc, key) => ({ ...acc, [key]: true }), {});
    setTouched(allTouched);
    if (!validateForm()) {
      const firstError = document.querySelector(".pj-field-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setLoading(true);
    try {
      const trimmedData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        location: formData.location.trim(),
        salaryMin: formData.salaryMin !== "" ? Number(formData.salaryMin) : undefined,
        salaryMax: formData.salaryMax !== "" ? Number(formData.salaryMax) : undefined,
        industry: Array.isArray(formData.industry) ? formData.industry.filter(Boolean) : [],
        jobType: formData.jobType,
        workNature: formData.workNature || undefined,
        slots: Number(formData.slots) || 1,
        qualifications: Array.isArray(formData.qualifications) ? formData.qualifications : [],
        applicationDeadline: formData.applicationDeadline || undefined,
        ...serializeBasicRequirements(pickBasicRequirements(formData)),
      };
      if (isEditing) {
        const payload = {
          ...trimmedData,
          salaryMin: formData.salaryMin === "" ? null : Number(formData.salaryMin),
          salaryMax: formData.salaryMax === "" ? null : Number(formData.salaryMax),
          workNature: formData.workNature || undefined,
          applicationDeadline: formData.applicationDeadline || null,
        };
        // Unchanged numeric fields must not erase legacy salary text.
        if (String(formData.salaryMin) === String(defaultState.formData.salaryMin) &&
            String(formData.salaryMax) === String(defaultState.formData.salaryMax)) {
          delete payload.salaryMin;
          delete payload.salaryMax;
        }
        if (formData.applicationDeadline === defaultState.formData.applicationDeadline) {
          delete payload.applicationDeadline;
        }
        const { data } = await adminAPI.updateJob(initialJob._id, payload);
        toast.success(t("jobEditing.saved"));
        onSaved(data);
        return;
      }
      await employerAPI.createJob(trimmedData);
      setPostedQualifications(trimmedData.qualifications || []);
      setPostedJobTitle(trimmedData.title);
      setPostTemplateName(trimmedData.title);
      setPostTemplateMsg("");
      setSuccess(true);
      clearPersistedState(); // clear saved draft
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const message = err.response?.data?.message || (isEditing ? t("jobEditing.error") : "Failed to create job vacancy");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePostedAsTemplate = async () => {
    const name = postTemplateName.trim();
    if (!name) {
      setPostTemplateMsg("Give the template a name");
      return;
    }
    if (!postedQualifications || postedQualifications.length === 0) {
      setPostTemplateMsg("This job has no requirements to save");
      return;
    }
    setSavingPostTemplate(true);
    setPostTemplateMsg("");
    try {
      await employerAPI.createQualificationTemplate({
        name,
        jobTitle: postedJobTitle || "",
        items: postedQualifications.map((q) => ({
          type: q.type,
          value: q.value,
          optional: Boolean(q.optional),
        })),
      });
      await loadQualTemplates();
      setPostedQualifications(null); // hide the CTA once saved
      setPostTemplateMsg("saved");
    } catch (err) {
      setPostTemplateMsg(err?.response?.data?.message || "Could not save template");
    } finally {
      setSavingPostTemplate(false);
    }
  };

  const startAnotherJob = () => {
    setFormData(getInitialFormData());
    setTouched({});
    setValidationErrors({});
    setSuccess(false);
    setPostedQualifications(null);
    setPostTemplateMsg("");
    setActiveSection("basics");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getCharCount = (text) => text?.length || 0;
  const getCharColor = (count, max, warning = 80) => {
    if (count === 0) return "muted";
    if (count > max) return "danger";
    if (count > max * (warning / 100)) return "warning";
    return "success";
  };

  const sections = [
    { id: "basics", label: "Job basics", icon: <FaClipboardList />, required: true, done: checklist[0].done && checklist[1].done && checklist[2].done },
    { id: "pay", label: "Pay & location", icon: <FaCoins />, required: true, done: checklist[3].done },
    { id: "eligibility", label: "Eligibility", icon: <FaUsers />, required: false, done: false },
    { id: "qualifications", label: "Qualifications", icon: <FaListUl />, required: true, done: checklist[4].done },
    // Matching weights are a separate saved resource keyed by this job's id
    // (see the useCustomMatchWeights state block above), so this step only
    // exists once the job itself already has one to save against.
    ...(isEditing ? [{ id: "matchWeights", label: "Matching weights", icon: <FaSlidersH />, required: false, done: false }] : []),
  ];

  const scrollToSection = (id) => {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="pj-page">
      <div className="pj-topbar">
        <button className="pj-back-btn" onClick={handleCancel} disabled={loading}>
          <FaArrowLeft /> {isEditing ? t("jobEditing.back") : "Back to Dashboard"}
        </button>
        <div className="pj-topbar-title">
          <FaBriefcase /> {isEditing ? t("jobEditing.title") : "Post a New Job"}
        </div>
        <div className="pj-topbar-spacer" />
      </div>

      {!success && (
        <nav className="pj-step-bar" aria-label="Posting sections">
          {sections.map((sec, index) => (
            <button
              key={sec.id}
              type="button"
              className={`pj-step ${activeSection === sec.id ? "is-active" : ""} ${sec.done ? "is-done" : ""}`}
              onClick={() => scrollToSection(sec.id)}
            >
              <span className="pj-step-num">{sec.done ? <FaCheck /> : index + 1}</span>
              <span className="pj-step-text">
                <span className="pj-step-label">{sec.label}</span>
                <span className="pj-step-status">{sec.done ? "Done" : sec.required ? "Required" : "Optional"}</span>
              </span>
            </button>
          ))}
        </nav>
      )}

      <div className="pj-container">
        <main className="pj-main">
          {error && (
            <div className="pj-alert pj-alert-error">
              <FaExclamationTriangle />
              <span>{error}</span>
            </div>
          )}
          {success ? (
            <div className="pj-success-panel">
              <div className="pj-alert pj-alert-success">
                <FaCheckCircle />
                <span>&ldquo;{postedJobTitle}&rdquo; was posted successfully.</span>
              </div>

              {postedQualifications && postedQualifications.length > 0 && (
                <div className="pj-template-cta">
                  <h3>
                    <FaClipboardList /> Save these requirements as a reusable template?
                  </h3>
                  <p>
                    Load them into your next posting with one click. You have{" "}
                    {postedQualifications.length} requirement
                    {postedQualifications.length === 1 ? "" : "s"} on this job.
                  </p>
                  <div className="pj-template-cta-row">
                    <input
                      type="text"
                      value={postTemplateName}
                      onChange={(e) => setPostTemplateName(e.target.value)}
                      placeholder="Template name"
                      disabled={savingPostTemplate}
                    />
                    <button
                      type="button"
                      className="pj-btn pj-btn-primary"
                      onClick={handleSavePostedAsTemplate}
                      disabled={savingPostTemplate || !postTemplateName.trim()}
                    >
                      {savingPostTemplate ? "Saving..." : "Save template"}
                    </button>
                  </div>
                  {postTemplateMsg && postTemplateMsg !== "saved" && (
                    <div className="pj-template-cta-error">{postTemplateMsg}</div>
                  )}
                </div>
              )}

              {postTemplateMsg === "saved" && (
                <div className="pj-alert pj-alert-success">
                  <FaCheckCircle />
                  <span>Template saved. It&rsquo;s now in your template list.</span>
                </div>
              )}

              <div className="pj-actions">
                <button
                  type="button"
                  className="pj-btn pj-btn-secondary"
                  onClick={() => navigate("/employer")}
                >
                  Go to Dashboard
                </button>
                <button type="button" className="pj-btn pj-btn-primary" onClick={startAnotherJob}>
                  <FaSave /> Post Another Job
                </button>
              </div>
            </div>
          ) : (
          <>
          <form id="pj-posting-form" className="pj-form" onSubmit={handleSubmit} noValidate>
            <section id="section-basics" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaClipboardList /></div>
                <div>
                  <h2>Job basics</h2>
                  <p>What the role is and how many people you need.</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label htmlFor="title">
                  Job Title <span className="pj-required">*</span>
                </label>
                <Autosuggest
                  id="title"
                  name="title"
                  placeholder="e.g. Service Crew"
                  value={formData.title}
                  onChange={(v) => handleChange({ target: { name: "title", value: v } })}
                  onBlur={() => handleBlur({ target: { name: "title" } })}
                  options={PH_JOB_TITLES}
                  inputClassName={validationErrors.title && touched.title ? "pj-error-input" : ""}
                  maxLength={100}
                  disabled={loading}
                />
                <div className="pj-field-footer">
                  {validationErrors.title && touched.title ? (
                    <span className="pj-field-error">{validationErrors.title}</span>
                  ) : (
                    <span />
                  )}
                  <span className={`pj-char-count ${getCharColor(getCharCount(formData.title), 100, 70)}`}>
                    {getCharCount(formData.title)} / 100
                  </span>
                </div>
                <div className="pj-quickfill-row">
                  <span className="pj-quickfill-label">Quick fill:</span>
                  {TITLE_QUICK_FILLS.map((qf) => (
                    <button
                      key={qf}
                      type="button"
                      className="pj-chip"
                      onClick={() => applyTitleQuickFill(qf)}
                      disabled={loading}
                    >
                      {qf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pj-basics-grid pj-basics-grid--type">
                <div className="pj-field">
                  <label>Job type</label>
                  <div className="pj-chip-row">
                    {JOB_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`pj-chip ${formData.jobType === type ? "is-active" : ""}`}
                        onClick={() => setJobType(type)}
                        disabled={loading}
                      >
                        {JOB_TYPE_LABELS[type] || type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pj-field">
                  <label htmlFor="slots">
                    <FaUserPlus /> Open slots <span className="pj-required">*</span>
                  </label>
                  <div className="pj-stepper">
                    <button
                      type="button"
                      className="pj-stepper-btn"
                      onClick={() => adjustSlots(-1)}
                      disabled={loading || Number(formData.slots) <= 1}
                      aria-label="Decrease open slots"
                    >
                      <FaMinus />
                    </button>
                    <span className="pj-stepper-value" id="slots">{formData.slots}</span>
                    <button
                      type="button"
                      className="pj-stepper-btn"
                      onClick={() => adjustSlots(1)}
                      disabled={loading || Number(formData.slots) >= 100}
                      aria-label="Increase open slots"
                    >
                      <FaPlus />
                    </button>
                  </div>
                  {validationErrors.slots && touched.slots && (
                    <span className="pj-field-error">{validationErrors.slots}</span>
                  )}
                </div>
              </div>

              <div className="pj-basics-grid">
                <div className="pj-field">
                  <label htmlFor="workNature">
                    Work nature <span className="pj-optional">(Optional)</span>
                  </label>
                  <div className="pj-select-wrapper">
                    <select
                      id="workNature"
                      name="workNature"
                      value={formData.workNature}
                      onChange={handleChange}
                      disabled={loading}
                    >
                      <option value="">Not specified</option>
                      {WORK_NATURES.map((wn) => (
                        <option key={wn.value} value={wn.value}>{wn.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label>
                  <FaBuilding /> Industry <span className="pj-required">*</span>
                  <span className="pj-optional">(select one or more)</span>
                </label>
                <div className="pj-chip-row">
                  {VALID_INDUSTRIES.map((ind) => (
                    <button
                      key={ind}
                      type="button"
                      className={`pj-chip ${formData.industry.includes(ind) ? "is-active" : ""}`}
                      onClick={() => toggleIndustry(ind)}
                      disabled={loading}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
                {validationErrors.industry && touched.industry && (
                  <span className="pj-field-error">{validationErrors.industry}</span>
                )}
              </div>

              <div className="pj-field pj-field-full">
                <label htmlFor="description">
                  Job Description <span className="pj-required">*</span>
                </label>
                <textarea
                  id="description"
                  name="description"
                  placeholder="Describe the role, responsibilities, and what success looks like..."
                  value={formData.description}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={validationErrors.description && touched.description ? "pj-error-input" : ""}
                  rows={8}
                  maxLength={5000}
                  required
                  disabled={loading}
                />
                <div className="pj-field-footer">
                  {validationErrors.description && touched.description ? (
                    <span className="pj-field-error">{validationErrors.description}</span>
                  ) : (
                    <span />
                  )}
                  <span className={`pj-char-count ${getCharColor(getCharCount(formData.description), 5000, 80)}`}>
                    {getCharCount(formData.description)} / 5000
                  </span>
                </div>
                <div className="pj-quickfill-row pj-quickfill-row--split">
                  <span className="pj-quickfill-group">
                    <span className="pj-quickfill-label">Add a section:</span>
                    {DESCRIPTION_SECTIONS.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        className="pj-chip"
                        onClick={() => insertDescriptionSection(sec)}
                        disabled={loading}
                      >
                        <FaPlus /> {sec.label}
                      </button>
                    ))}
                  </span>
                  {getCharCount(formData.description) < 40 && (
                    <span className="pj-hint">Add at least 40 characters.</span>
                  )}
                </div>
              </div>
            </section>

            <section id="section-pay" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaCoins /></div>
                <div>
                  <h2>Pay &amp; location</h2>
                  <p>Where the work is, what it pays, and when applications close.</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label>
                  <FaMapMarkerAlt /> Work location <span className="pj-required">*</span>
                </label>

                {useRegisteredBusinessAddress ? (
                  <div className="pj-address-card">
                    <div className="pj-address-card-icon"><FaMapMarkerAlt /></div>
                    <div className="pj-address-card-body">
                      <strong>Registered business address</strong>
                      <span>{registeredBusinessAddress || "[Address from your employer profile]"}</span>
                    </div>
                    <button type="button" className="pj-btn pj-btn-outline" onClick={handleUseDifferentLocation} disabled={loading}>
                      Use a different location
                    </button>
                  </div>
                ) : (
                  <div className="pj-location-field-group">
                    {registeredBusinessAddress && (
                      <button type="button" className="pj-link-btn" onClick={handleUseRegisteredAddress} disabled={loading}>
                        Use registered business address instead
                      </button>
                    )}
                    <LocationSelect
                      key={locationSelectResetKey}
                      className="pj-location-select-group"
                      value={formData.location}
                      onChange={handleLocationChange}
                      disabled={loading}
                      required
                    />
                  </div>
                )}

                {useRegisteredBusinessAddress && !registeredBusinessAddress && (
                  <div className="pj-address-missing-warning">
                    <FaInfoCircle /> No registered business address found. Please update your profile.
                  </div>
                )}
                {validationErrors.location && touched.location && (
                  <span className="pj-field-error">{validationErrors.location}</span>
                )}
              </div>

              <div className="pj-field pj-field-full">
                <label><FaMoneyBillWave /> Salary</label>
                <div className="pj-seg" role="group" aria-label="Salary visibility">
                  <button
                    type="button"
                    className={`pj-seg-btn ${salaryMode === "negotiable" ? "is-active" : ""}`}
                    onClick={setSalaryNegotiable}
                    disabled={loading}
                  >
                    Negotiable
                  </button>
                  <button
                    type="button"
                    className={`pj-seg-btn ${salaryMode === "range" ? "is-active" : ""}`}
                    onClick={setSalaryRangeMode}
                    disabled={loading}
                  >
                    Set a range
                  </button>
                </div>

                {salaryMode === "range" && (
                  <div className="pj-salary-range-row">
                    <input
                      id="salaryMin"
                      type="number"
                      min="0"
                      name="salaryMin"
                      placeholder="Min, e.g. 18000"
                      value={formData.salaryMin}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      className={validationErrors.salaryMin && touched.salaryMin ? "pj-error-input" : ""}
                      disabled={loading}
                    />
                    <span className="pj-salary-range-sep">to</span>
                    <input
                      id="salaryMax"
                      type="number"
                      min="0"
                      name="salaryMax"
                      placeholder="Max, e.g. 25000"
                      value={formData.salaryMax}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      className={validationErrors.salaryMax && touched.salaryMax ? "pj-error-input" : ""}
                      disabled={loading}
                    />
                  </div>
                )}
                {(validationErrors.salaryMin && touched.salaryMin) && (
                  <span className="pj-field-error">{validationErrors.salaryMin}</span>
                )}
                {(validationErrors.salaryMax && touched.salaryMax) && (
                  <span className="pj-field-error">{validationErrors.salaryMax}</span>
                )}
              </div>

              <div className="pj-field pj-field-full">
                <label htmlFor="applicationDeadline">
                  <FaCalendarAlt /> Application deadline <span className="pj-optional">(Optional)</span>
                </label>
                <div className="pj-deadline-row">
                  <input
                    id="applicationDeadline"
                    type="date"
                    name="applicationDeadline"
                    value={formData.applicationDeadline}
                    onChange={(e) => {
                      setDeadlineQuickPick("");
                      handleChange(e);
                    }}
                    onBlur={handleBlur}
                    min={new Date().toISOString().split("T")[0]}
                    className={`pj-deadline-date ${validationErrors.applicationDeadline && touched.applicationDeadline ? "pj-error-input" : ""}`}
                    disabled={loading}
                  />
                  {DEADLINE_QUICK_PICKS.map((pick) => (
                    <button
                      key={pick.id}
                      type="button"
                      className={`pj-chip ${deadlineQuickPick === pick.id ? "is-active" : ""}`}
                      onClick={() => applyDeadlineQuickPick(pick)}
                      disabled={loading}
                    >
                      {pick.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`pj-chip ${deadlineQuickPick === "none" || (!deadlineQuickPick && !formData.applicationDeadline) ? "is-active" : ""}`}
                    onClick={clearDeadline}
                    disabled={loading}
                  >
                    No deadline
                  </button>
                </div>
                {validationErrors.applicationDeadline && touched.applicationDeadline && (
                  <span className="pj-field-error">{validationErrors.applicationDeadline}</span>
                )}
              </div>
            </section>

            <section id="section-eligibility" className="pj-section">
              <div className="pj-field pj-field-full">
                <BasicRequirements
                  value={pickBasicRequirements(formData)}
                  onChange={(next) => setFormData((prev) => ({ ...prev, ...next }))}
                  disabled={loading}
                />
                {validationErrors.basicRequirements && (
                  <span className="pj-field-error">{validationErrors.basicRequirements}</span>
                )}
              </div>
            </section>

            <section id="section-qualifications" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaListUl /></div>
                <div>
                  <h2>Qualifications</h2>
                  <p>Skills, licences and clearances. Required = must-have, Preferred = nice to have.</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <QualificationsEditor
                  value={formData.qualifications}
                  onChange={handleQualificationsChange}
                  disabled={loading}
                  required
                  templates={qualTemplates}
                  jobTitleHint={formData.title}
                  onSaveTemplate={isEditing ? null : handleSaveQualTemplate}
                />
                {validationErrors.qualifications && touched.qualifications && (
                  <span className="pj-field-error">{validationErrors.qualifications}</span>
                )}
              </div>
            </section>
          </form>

          {/* Outside the main <form>: this section saves independently via
              its own endpoint (jobAPI.updateMatchWeights), not as part of
              the job-posting submit. */}
          {isEditing && (
            <section id="section-matchWeights" className="pj-section">
              <div className="pj-section-header">
                <div className="pj-section-icon"><FaSlidersH /></div>
                <div>
                  <h2>Matching weights</h2>
                  <p>Override how much each factor counts toward an applicant's match percentage, just for this job.</p>
                </div>
              </div>

              <div className="pj-field pj-field-full">
                <label className="pj-toggle-row">
                  <input
                    type="checkbox"
                    checked={useCustomMatchWeights}
                    disabled={matchWeightsLoading || matchWeightsSaving}
                    onChange={(e) => setUseCustomMatchWeights(e.target.checked)}
                  />
                  <span>Use custom matching weights for this job</span>
                </label>

                {!useCustomMatchWeights ? (
                  <p className="pj-field-hint">
                    This job uses your default matching weights (set under Matching Preferences
                    on your dashboard).
                  </p>
                ) : matchWeightsLoading && !matchWeightsLoaded ? (
                  <p className="loading">Loading...</p>
                ) : (
                  <>
                    {matchWeightsError && (
                      <span className="pj-field-error">{matchWeightsError}</span>
                    )}
                    <MatchWeightsEditor
                      initialWeights={matchWeightsOverride || matchWeightsEmployerDefault || CODE_FALLBACK_WEIGHTS}
                      bounds={matchWeightBounds}
                      onSave={handleSaveMatchWeightsOverride}
                      onReset={matchWeightsOverride ? handleRemoveMatchWeightsOverride : undefined}
                      resetLabel="Remove override (use my default)"
                      busy={matchWeightsSaving}
                    />
                  </>
                )}
              </div>
            </section>
          )}
          </>
          )}
        </main>

        {!success && (
          <aside className="pj-sidebar">
            <div className="pj-sidebar-card pj-preview-card">
              <div className="pj-card-head-row">
                <h3>Live Preview</h3>
                <span className="pj-preview-hint">As jobseekers see it</span>
              </div>
              <div className="pj-preview-stage">
                <VacancyCard
                  preview
                  job={{
                    title: formData.title,
                    description: formData.description,
                    location: formData.location,
                    salary: formatSalaryPreview(formData.salaryMin, formData.salaryMax),
                    jobType: formData.jobType,
                    slots: Number(formData.slots) || 1,
                    qualifications: formData.qualifications,
                    applicationCount: 0,
                    createdAt: new Date().toISOString(),
                    employer: isEditing ? initialJob.employer : { companyName: user?.companyName || user?.name || "Your company" },
                  }}
                />
              </div>
            </div>

            <div className="pj-sidebar-card pj-checklist-card">
              <div className="pj-card-head-row">
                <h3>Before you post</h3>
                <span className="pj-checklist-progress">{checklist.length - remainingRequired} of {checklist.length}</span>
              </div>
              <ul className="pj-checklist">
                {checklist.map((item) => (
                  <li key={item.id} className={item.done ? "is-done" : ""}>
                    <span className="pj-checklist-dot">{item.done && <FaCheck />}</span>
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      {!success && (
        <div className="pj-sticky-actions">
          <span className="pj-sticky-actions-note">
            {canPost ? "Ready to post." : `${remainingRequired} required item${remainingRequired === 1 ? "" : "s"} left before you can post.`}
          </span>
          <div className="pj-actions">
            <button
              type="button"
              className="pj-btn pj-btn-secondary"
              onClick={handleCancel}
              disabled={loading}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="pj-posting-form"
              className="pj-btn pj-btn-primary"
              disabled={loading || !canPost}
            >
              {loading ? (
                <>
                  <FaSpinner className="pj-spin" /> {isEditing ? t("jobEditing.saving") : "Posting..."}
                </>
              ) : (
                <>
                  <FaSave /> {isEditing ? t("common.save") : "Post Job Vacancy"}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
