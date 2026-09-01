import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/profile.css";
import { FaUser, FaEnvelope, FaPhone, FaBriefcase, FaBuilding, FaMapMarkerAlt, FaCalendarAlt, FaUserGraduate, FaFileAlt, FaUpload, FaTrash, FaExclamationTriangle, FaTimes, FaPlus, FaSave } from "react-icons/fa";
import LocationSelect from "../components/LocationSelect";
import { COMMON_SKILLS as skillsList } from "../data/skills";
import { usePersistentState } from "../hooks/usePersistentState";

const INDUSTRY_OPTIONS = [
  "Information Technology (IT)", "Healthcare", "Finance & Banking", "Education",
  "Construction & Engineering", "Manufacturing", "Retail & Wholesale", "Hospitality & Tourism",
  "Transportation & Logistics", "Agriculture", "Media & Communications", "Real Estate",
  "Government & Public Administration", "Legal Services", "Telecommunications",
  "Marketing & Advertising", "Arts & Entertainment", "Human Resources", "Customer Service",
  "Environmental Services", "Others"
];

// Initial empty state for formData
const initialFormData = {
  name: "",
  email: "",
  about: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  gender: "",
  civilStatus: "",
  placeOfBirth: "",
  citizenship: "",
  height: "",
  weight: "",
  landline: "",
  mobileSecondary: "",
  presentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
  permanentAddress: { street: "", barangay: "", municipality: "", province: "", region: "" },
  disability: [],
  is4psBeneficiary: false,
  _4psHouseholdId: "",
  isOfw: false,
  isRepatriated: false,
  repatriationIntent: "",
  employmentStatus: "",
  employmentType: "",
  unemploymentReason: "",
  laidoffCountry: "",
  desiredJobTitle: "",
  workExperience: "",
  educationalAttainment: "",
  availabilityStatus: "",
  companyName: "",
  industry: "",
  companySize: "",
  website: "",
  companyDescription: "",
  businessAddress: "",
  tradeName: "",
  acronym: "",
  tin: "",
  officeType: "",
  employerClassificationType: "",
  employerClassificationSubtype: "",
  totalWorkforceSize: "",
  ownerName: "",
  contactPersonName: "",
  contactPersonPosition: "",
  fax: "",
  businessAddressStructured: { street: "", barangay: "", municipality: "", province: "", region: "" },
};

const getInitialPersisted = () => ({
  formData: { ...initialFormData },
  skills: [],
  preferredIndustries: [],
  industryPreferenceLevel: "flexible",
  activeTab: "profile",
});

export default function EditProfile() {
  const { user, login, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const isEmployer = user?.role === "employer";
  const isAdmin = user?.role === "admin";

  // Persistent state
  const normalizeFormData = (data) => {
    return {
      ...initialFormData,
      ...data,
      presentAddress: { ...initialFormData.presentAddress, ...(data?.presentAddress || {}) },
      permanentAddress: { ...initialFormData.permanentAddress, ...(data?.permanentAddress || {}) },
      businessAddressStructured: { ...initialFormData.businessAddressStructured, ...(data?.businessAddressStructured || {}) },
      disability: Array.isArray(data?.disability) ? data.disability : [],
    };
  };

  const defaultState = getInitialPersisted();
  const [persistedState, setPersistedState, clearPersistedState] = usePersistentState('editProfileState', defaultState);

  const safeState = (persistedState && typeof persistedState === 'object' && persistedState.formData)
    ? { ...persistedState, formData: normalizeFormData(persistedState.formData) }
    : defaultState;

  const { formData, skills, preferredIndustries, industryPreferenceLevel, activeTab } = safeState;
  const setFormData = (updater) => setPersistedState(prev => {
    const newForm = typeof updater === 'function' ? updater(prev.formData) : updater;
    return { ...prev, formData: newForm };
  });
  const setSkills = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.skills) : updater;
    return { ...prev, skills: newVal };
  });
  const setPreferredIndustries = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.preferredIndustries) : updater;
    return { ...prev, preferredIndustries: newVal };
  });
  const setIndustryPreferenceLevel = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.industryPreferenceLevel) : updater;
    return { ...prev, industryPreferenceLevel: newVal };
  });
  const setActiveTab = (updater) => setPersistedState(prev => {
    const newVal = typeof updater === 'function' ? updater(prev.activeTab) : updater;
    return { ...prev, activeTab: newVal };
  });

  const [resumeFile, setResumeFile] = useState(null);
  const [supportingDocumentFile, setSupportingDocumentFile] = useState(null);
  const [businessPermitFile, setBusinessPermitFile] = useState(null);
  const [registrationDocFile, setRegistrationDocFile] = useState(null);
  const [existingResume, setExistingResume] = useState("");
  const [existingValidId, setExistingValidId] = useState("");
  const [existingBusinessPermit, setExistingBusinessPermit] = useState("");
  const [existingRegistrationDoc, setExistingRegistrationDoc] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [skillFilterInput, setSkillFilterInput] = useState("");
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);

  // Merge profile data from API
  const mergeProfileData = (data) => {
    const userData = data.user || {};
    const profileData = data.profile || {};
    const merged = { ...userData };
    if (userData.role === "employer" && profileData.businessAddress) {
      merged.businessAddressStructured = profileData.businessAddress;
    }
    const { businessAddress, ...restProfile } = profileData;
    Object.assign(merged, restProfile);
    return merged;
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data } = await authAPI.getProfile();
        const merged = mergeProfileData(data);

        // Always populate form from API on component mount
        // This ensures fresh data from server is displayed, not stale persisted state
        setFormData({
          ...initialFormData,
          name: merged.name || "",
          email: merged.email || "",
          about: merged.about || "",
          phone: merged.phone || "",
          address: merged.address || "",
          businessAddress: merged.businessAddress || merged.address || "",
          dateOfBirth: merged.dateOfBirth ? String(merged.dateOfBirth).slice(0, 10) : "",
          gender: merged.gender || "",
          desiredJobTitle: merged.desiredJobTitle || "",
          workExperience: merged.workExperience || "",
          educationalAttainment: merged.educationalAttainment || "",
          availabilityStatus: merged.availabilityStatus || "",
          companyName: merged.companyName || "",
          industry: merged.industry || "",
          companySize: merged.companySize || "",
          website: merged.website || "",
          companyDescription: merged.companyDescription || "",
          civilStatus: merged.civilStatus || "",
          placeOfBirth: merged.placeOfBirth || "",
          citizenship: merged.citizenship || "",
          height: merged.height || "",
          weight: merged.weight || "",
          landline: merged.landline || "",
          mobileSecondary: merged.mobileSecondary || "",
          presentAddress: merged.presentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
          permanentAddress: merged.permanentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
          disability: merged.disability || [],
          is4psBeneficiary: merged.is4psBeneficiary || false,
          _4psHouseholdId: merged._4psHouseholdId || "",
          isOfw: merged.isOfw || false,
          isRepatriated: merged.isRepatriated || false,
          repatriationIntent: merged.repatriationIntent || "",
          employmentStatus: merged.employmentStatus || "",
          employmentType: merged.employmentType || "",
          unemploymentReason: merged.unemploymentReason || "",
          laidoffCountry: merged.laidoffCountry || "",
          tradeName: merged.tradeName || "",
          acronym: merged.acronym || "",
          tin: merged.tin || "",
          officeType: merged.officeType || "",
          employerClassificationType: merged.employerClassification?.type || "",
          employerClassificationSubtype: merged.employerClassification?.subtype || "",
          totalWorkforceSize: merged.totalWorkforceSize || "",
          ownerName: merged.ownerName || "",
          contactPersonName: merged.contactPersonName || "",
          contactPersonPosition: merged.contactPersonPosition || "",
          fax: merged.fax || "",
          businessAddressStructured: merged.businessAddressStructured || { street: "", barangay: "", municipality: "", province: "", region: "" },
        });
        setSkills(Array.isArray(merged.skills) ? merged.skills : []);
        setPreferredIndustries(Array.isArray(merged.preferredIndustries) ? merged.preferredIndustries : []);
        setIndustryPreferenceLevel(merged.industryPreferenceLevel || "flexible");

        setExistingResume(merged.resumeFile || "");
        setExistingValidId(merged.validIdFile || "");
        setExistingBusinessPermit(merged.businessPermitUrl || "");
        setExistingRegistrationDoc(merged.registrationDocUrl || "");

        login(localStorage.getItem("token"), merged);
      } catch (err) {
        // Fallback to user context if API fails
        if (user) {
          setFormData({
            ...initialFormData,
            name: user.name || "",
            email: user.email || "",
            phone: user.phone || "",
            address: user.address || "",
            businessAddress: user.businessAddress || user.address || "",
            companyName: user.companyName || "",
            industry: user.industry || "",
            companySize: user.companySize || "",
            website: user.website || "",
            companyDescription: user.companyDescription || "",
            desiredJobTitle: user.desiredJobTitle || "",
            workExperience: user.workExperience || "",
            educationalAttainment: user.educationalAttainment || "",
            availabilityStatus: user.availabilityStatus || "",
          });
          setSkills(Array.isArray(user.skills) ? user.skills : []);
        }
      }
    };

    fetchProfile();
  }, []);

  const handleChange = (event) => {
    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value },
    }));
  };

  const handleSkillSelect = (e) => {
    const selectedOptions = Array.from(e.target.selectedOptions).map(opt => opt.value);
    setSkills(selectedOptions);
  };

  const toggleIndustry = (industry) => {
    setPreferredIndustries(prev =>
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
  };

  const handleAddCustomSkill = () => {
    // Not used with new dropdown approach, but kept for compatibility
  };

  const handleRemoveSkill = (skillToRemove) => {
    setSkills((prev) => prev.filter((skill) => skill !== skillToRemove));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = new FormData();
      data.append("name", formData.name);
      data.append("email", formData.email);
      data.append("phone", formData.phone);

      if (isAdmin) {
        if (currentPassword || newPassword || confirmPassword) {
          if (!currentPassword || !newPassword) {
            throw new Error("Current password and new password are required");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("New password and confirm password do not match");
          }
          data.append("currentPassword", currentPassword);
          data.append("newPassword", newPassword);
        }
      } else if (isEmployer) {
        data.append("dateOfBirth", formData.dateOfBirth);
        data.append("gender", formData.gender);
        data.append("companyName", formData.companyName);
        data.append("industry", formData.industry);
        data.append("companySize", formData.companySize);
        data.append("website", formData.website);
        data.append("companyDescription", formData.companyDescription);
        data.append("businessAddress", formData.businessAddress);
        data.append("tradeName", formData.tradeName);
        data.append("acronym", formData.acronym);
        data.append("tin", formData.tin);
        data.append("officeType", formData.officeType);
        data.append(
          "employerClassification",
          JSON.stringify({
            type: formData.employerClassificationType,
            subtype: formData.employerClassificationSubtype,
          })
        );
        data.append("totalWorkforceSize", formData.totalWorkforceSize);
        data.append("ownerName", formData.ownerName);
        data.append("contactPersonName", formData.contactPersonName);
        data.append("contactPersonPosition", formData.contactPersonPosition);
        data.append("fax", formData.fax);
        data.append("businessAddressStructured", JSON.stringify(formData.businessAddressStructured));
        if (businessPermitFile) data.append("businessPermit", businessPermitFile);
        if (registrationDocFile) data.append("registrationDoc", registrationDocFile);
      } else {
        data.append("dateOfBirth", formData.dateOfBirth);
        data.append("gender", formData.gender);
        data.append("about", formData.about);
        data.append("address", formData.address);
        data.append("desiredJobTitle", formData.desiredJobTitle);
        data.append("workExperience", formData.workExperience);
        data.append("educationalAttainment", formData.educationalAttainment);
        data.append("availabilityStatus", formData.availabilityStatus);
        data.append("skills", JSON.stringify(skills));
        data.append("preferredIndustries", JSON.stringify(preferredIndustries));
        data.append("industryPreferenceLevel", industryPreferenceLevel);
        data.append("civilStatus", formData.civilStatus);
        data.append("placeOfBirth", formData.placeOfBirth);
        data.append("citizenship", formData.citizenship);
        data.append("height", formData.height);
        data.append("weight", formData.weight);
        data.append("landline", formData.landline);
        data.append("mobileSecondary", formData.mobileSecondary);
        data.append("presentAddress", JSON.stringify(formData.presentAddress));
        data.append("permanentAddress", JSON.stringify(formData.permanentAddress));
        data.append("disability", JSON.stringify(formData.disability));
        data.append("is4psBeneficiary", formData.is4psBeneficiary ? "true" : "false");
        data.append("_4psHouseholdId", formData._4psHouseholdId);
        data.append("isOfw", formData.isOfw ? "true" : "false");
        data.append("isRepatriated", formData.isRepatriated ? "true" : "false");
        data.append("repatriationIntent", formData.repatriationIntent);
        data.append("employmentStatus", formData.employmentStatus);
        data.append("employmentType", formData.employmentType);
        data.append("unemploymentReason", formData.unemploymentReason);
        data.append("laidoffCountry", formData.laidoffCountry);
        if (resumeFile) data.append("resumeFile", resumeFile);
        if (supportingDocumentFile) data.append("validIdFile", supportingDocumentFile);
      }

      const { data: response } = await authAPI.updateProfile(data);
      setMessage(response.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      login(localStorage.getItem("token"), response.user);
      
      // Update form with fresh server response to keep fields populated
      const merged = mergeProfileData(response);
      setFormData({
        ...initialFormData,
        name: merged.name || "",
        email: merged.email || "",
        about: merged.about || "",
        phone: merged.phone || "",
        address: merged.address || "",
        businessAddress: merged.businessAddress || merged.address || "",
        dateOfBirth: merged.dateOfBirth ? String(merged.dateOfBirth).slice(0, 10) : "",
        gender: merged.gender || "",
        desiredJobTitle: merged.desiredJobTitle || "",
        workExperience: merged.workExperience || "",
        educationalAttainment: merged.educationalAttainment || "",
        availabilityStatus: merged.availabilityStatus || "",
        companyName: merged.companyName || "",
        industry: merged.industry || "",
        companySize: merged.companySize || "",
        website: merged.website || "",
        companyDescription: merged.companyDescription || "",
        civilStatus: merged.civilStatus || "",
        placeOfBirth: merged.placeOfBirth || "",
        citizenship: merged.citizenship || "",
        height: merged.height || "",
        weight: merged.weight || "",
        landline: merged.landline || "",
        mobileSecondary: merged.mobileSecondary || "",
        presentAddress: merged.presentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
        permanentAddress: merged.permanentAddress || { street: "", barangay: "", municipality: "", province: "", region: "" },
        disability: merged.disability || [],
        is4psBeneficiary: merged.is4psBeneficiary || false,
        _4psHouseholdId: merged._4psHouseholdId || "",
        isOfw: merged.isOfw || false,
        isRepatriated: merged.isRepatriated || false,
        repatriationIntent: merged.repatriationIntent || "",
        employmentStatus: merged.employmentStatus || "",
        employmentType: merged.employmentType || "",
        unemploymentReason: merged.unemploymentReason || "",
        laidoffCountry: merged.laidoffCountry || "",
        tradeName: merged.tradeName || "",
        acronym: merged.acronym || "",
        tin: merged.tin || "",
        officeType: merged.officeType || "",
        employerClassificationType: merged.employerClassification?.type || "",
        employerClassificationSubtype: merged.employerClassification?.subtype || "",
        totalWorkforceSize: merged.totalWorkforceSize || "",
        ownerName: merged.ownerName || "",
        contactPersonName: merged.contactPersonName || "",
        contactPersonPosition: merged.contactPersonPosition || "",
        fax: merged.fax || "",
        businessAddressStructured: merged.businessAddressStructured || { street: "", barangay: "", municipality: "", province: "", region: "" },
      });
      setSkills(Array.isArray(merged.skills) ? merged.skills : []);
      setPreferredIndustries(Array.isArray(merged.preferredIndustries) ? merged.preferredIndustries : []);
      setIndustryPreferenceLevel(merged.industryPreferenceLevel || "flexible");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const expectedFullName = formData.name || user?.name || "";
  const isDeleteNameMatch = deleteConfirmName === expectedFullName;

  const handleDeleteAccount = async () => {
    setDeleteError("");
    setIsDeleting(true);
    try {
      await authAPI.deleteAccount();
      logout();
      window.alert("Your account has been deleted.");
      navigate("/");
    } catch (err) {
      setDeleteError(err.response?.data?.message || "Failed to delete account");
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteModal = () => {
    setDeleteConfirmName("");
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setShowDeleteModal(false);
    setDeleteError("");
  };

  // (Rest of the JSX remains the same, but we'll include it for completeness)
  // Due to length, I'll abbreviate but include the full component in the final answer.
  // For brevity in this response, I'll provide the full EditProfile code with the changes.
  // The JSX is unchanged except for using the persistent state variables.
  // ...

  return (
    <div className="profile-page">
      <div className="profile-overlay"></div>

      <form className="profile-form-card" onSubmit={handleSubmit}>
        <div className="profile-header">
          <div className="profile-avatar-wrapper">
            <div className="profile-avatar-circle">
              {formData.name ? formData.name.trim().charAt(0).toUpperCase() : "U"}
            </div>
          </div>
          <div className="profile-header-info">
            <h2 className="profile-title">Edit Profile</h2>
            <p className="profile-subtitle">Update your personal information and preferences</p>
          </div>
        </div>

        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <div className="profile-tabs">
          <button type="button" className={`profile-tab ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            <FaUser /> Personal Info
          </button>
          {!isAdmin && !isEmployer && (
            <>
              <button type="button" className={`profile-tab ${activeTab === "career" ? "active" : ""}`} onClick={() => setActiveTab("career")}>
                <FaBriefcase /> Career
              </button>
              <button type="button" className={`profile-tab ${activeTab === "nsrp" ? "active" : ""}`} onClick={() => setActiveTab("nsrp")}>
                NSRP Details
              </button>
            </>
          )}
          {isEmployer && (
            <button type="button" className={`profile-tab ${activeTab === "nsrp" ? "active" : ""}`} onClick={() => setActiveTab("nsrp")}>
              <FaBuilding /> NSRP Details
            </button>
          )}
          {!isAdmin && (
            <button type="button" className={`profile-tab ${activeTab === "documents" ? "active" : ""}`} onClick={() => setActiveTab("documents")}>
              <FaFileAlt /> Documents
            </button>
          )}
        </div>

        <div className="profile-fields">
          {/* --- PERSONAL INFO TAB --- */}
          {activeTab === "profile" && (
            <>
              <div className="profile-field-group">
                <div className="profile-field">
                  <label htmlFor="name"><FaUser /> Full Name</label>
                  <input id="name" type="text" name="name" value={formData.name} onChange={handleChange} required />
                </div>
                <div className="profile-field">
                  <label htmlFor="email"><FaEnvelope /> Email</label>
                  <input id="email" type="email" name="email" value={formData.email} onChange={handleChange} required />
                </div>
                <div className="profile-field">
                  <label htmlFor="phone"><FaPhone /> Phone</label>
                  <input id="phone" type="text" name="phone" value={formData.phone} onChange={handleChange} />
                </div>
              </div>

              {isAdmin ? (
                <div className="profile-field-group profile-password-group">
                  <h3 className="profile-section-title">🔒 Change Password</h3>
                  <div className="profile-field">
                    <label htmlFor="currentPassword">Current Password</label>
                    <input id="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="newPassword">New Password</label>
                      <input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="confirmPassword">Confirm Password</label>
                      <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="dateOfBirth"><FaCalendarAlt /> Date of Birth</label>
                      <input id="dateOfBirth" type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="gender">Gender</label>
                      <select id="gender" name="gender" value={formData.gender} onChange={handleChange}>
                        <option value="">Select</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>

                  {!isEmployer && (
                    <>
                      <div className="profile-field">
                        <label><FaMapMarkerAlt /> Address</label>
                        <LocationSelect
                          value={formData.address}
                          onChange={(loc) => setFormData((prev) => ({ ...prev, address: loc }))}
                          disabled={loading}
                          required
                        />
                      </div>
                      <div className="profile-field">
                        <label htmlFor="about">About You</label>
                        <textarea id="about" name="about" value={formData.about} onChange={handleChange} rows="4" placeholder="Tell employers about yourself..." />
                      </div>
                      <div className="profile-field-group">
                        <h3 className="profile-section-title">Preferred Industries</h3>
                        <p className="profile-section-hint">Select the industries you are interested in working in.</p>
                        <div className="industry-pills-grid">
                          {INDUSTRY_OPTIONS.map(ind => (
                            <button
                              key={ind}
                              type="button"
                              className={`industry-pill ${preferredIndustries.includes(ind) ? "active" : ""}`}
                              onClick={() => toggleIndustry(ind)}
                              disabled={loading}
                            >
                              {ind}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: '1.5rem' }}>
                          <span className="profile-label">Preference Mode</span>
                          <div className="pill-row">
                            <button
                              type="button"
                              className={`pill-btn ${industryPreferenceLevel === "flexible" ? "active" : ""}`}
                              onClick={() => setIndustryPreferenceLevel("flexible")}
                              disabled={loading}
                            >
                              Flexible (Show all jobs, prioritize these)
                            </button>
                            <button
                              type="button"
                              className={`pill-btn ${industryPreferenceLevel === "strict" ? "active" : ""}`}
                              onClick={() => setIndustryPreferenceLevel("strict")}
                              disabled={loading}
                            >
                              Strict (Only show these industries)
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {isEmployer && (
                <div className="profile-field-group">
                  <h3 className="profile-section-title"><FaBuilding /> Company Profile</h3>
                  <div className="profile-field">
                    <label htmlFor="companyName">Company Name</label>
                    <input id="companyName" type="text" name="companyName" value={formData.companyName} onChange={handleChange} />
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="industry">Industry / Sector</label>
                      <select id="industry" name="industry" value={formData.industry} onChange={handleChange}>
                        <option value="">Select Industry</option>
                        {INDUSTRY_OPTIONS.map(ind => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                    <div className="profile-field">
                      <label htmlFor="companySize">Company Size</label>
                      <select id="companySize" name="companySize" value={formData.companySize} onChange={handleChange}>
                        <option value="">Select Size</option>
                        <option value="1-10">1-10</option>
                        <option value="11-50">11-50</option>
                        <option value="51-200">51-200</option>
                        <option value="200+">200+</option>
                      </select>
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="website">Website / Facebook Page</label>
                    <input id="website" type="url" name="website" value={formData.website} onChange={handleChange} placeholder="https://..." />
                  </div>
                  <div className="profile-field">
                    <label><FaMapMarkerAlt /> Business Address (string)</label>
                    <LocationSelect
                      value={formData.businessAddress}
                      onChange={(loc) => setFormData((prev) => ({ ...prev, businessAddress: loc }))}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="companyDescription">Company Description</label>
                    <textarea id="companyDescription" name="companyDescription" value={formData.companyDescription} onChange={handleChange} rows="4" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* --- CAREER TAB (jobseeker only) --- */}
          {activeTab === "career" && !isAdmin && !isEmployer && (
            <div className="profile-field-group">
              <div className="profile-field">
                <label htmlFor="desiredJobTitle"><FaBriefcase /> Desired Job Title</label>
                <input id="desiredJobTitle" type="text" name="desiredJobTitle" value={formData.desiredJobTitle} onChange={handleChange} />
              </div>

              <div className="profile-field">
                <label htmlFor="skills"><FaPlus /> Skills</label>
                <div className="skills-modern-wrapper">
                  <div className="skills-search-box">
                    <input
                      type="text"
                      value={skillFilterInput}
                      onChange={(e) => setSkillFilterInput(e.target.value)}
                      onFocus={() => setShowSkillsDropdown(true)}
                      onBlur={() => setTimeout(() => setShowSkillsDropdown(false), 150)}
                      placeholder="Search and select skills..."
                      className="skills-search-input"
                    />
                    {showSkillsDropdown && (
                      <div className="skills-dropdown-menu">
                        {skillsList
                          .filter((skill) =>
                            !skills.includes(skill) &&
                            skill.toLowerCase().includes(skillFilterInput.toLowerCase())
                          )
                          .map((skill) => (
                            <button
                              key={skill}
                              type="button"
                              className="skills-dropdown-item"
                              onMouseDown={() => {
                                setSkills((prev) => [...prev, skill]);
                                setSkillFilterInput("");
                                setShowSkillsDropdown(true);
                              }}
                            >
                              {skill}
                            </button>
                          ))}
                        {skillFilterInput && !skillsList.some((s) => s.toLowerCase().includes(skillFilterInput.toLowerCase())) && (
                          <button
                            type="button"
                            className="skills-dropdown-item skills-dropdown-item--custom"
                            onMouseDown={() => {
                              const value = skillFilterInput.trim();
                              if (value && !skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
                                setSkills((prev) => [...prev, value]);
                                setSkillFilterInput("");
                                setShowSkillsDropdown(true);
                              }
                            }}
                          >
                            <FaPlus /> Add "{skillFilterInput}" as custom skill
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="skills-tags-wrap">
                  {skills.map((skill) => (
                    <span key={skill} className="skill-tag">
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(skill)} aria-label={`Remove ${skill}`} className="skill-tag-remove"><FaTimes /></button>
                    </span>
                  ))}
                </div>
                {skills.length === 0 && (
                  <p className="help-text" style={{ marginTop: "8px" }}>Add skills to improve job matching and recommendations</p>
                )}
              </div>

              <div className="profile-field-grid">
                <div className="profile-field">
                  <label htmlFor="workExperience">Work Experience</label>
                  <select id="workExperience" name="workExperience" value={formData.workExperience} onChange={handleChange}>
                    <option value="">Select</option>
                    <option value="Fresh Graduate">Fresh Graduate</option>
                    <option value="Less than 1 year">Less than 1 year</option>
                    <option value="1–3 years">1–3 years</option>
                    <option value="3–5 years">3–5 years</option>
                    <option value="5+ years">5+ years</option>
                  </select>
                </div>
                <div className="profile-field">
                  <label htmlFor="educationalAttainment"><FaUserGraduate /> Educational Attainment</label>
                  <select id="educationalAttainment" name="educationalAttainment" value={formData.educationalAttainment} onChange={handleChange}>
                    <option value="">Select</option>
                    <option value="Elementary Graduate">Elementary Graduate</option>
                    <option value="High School Graduate">High School Graduate</option>
                    <option value="Senior High School Graduate">Senior High School Graduate</option>
                    <option value="Vocational / TESDA">Vocational / TESDA</option>
                    <option value="College Undergraduate">College Undergraduate</option>
                    <option value="College Graduate">College Graduate</option>
                    <option value="Master's Degree">Master's Degree</option>
                    <option value="Doctorate">Doctorate</option>
                  </select>
                </div>
              </div>
              <div className="profile-field">
                <label htmlFor="availabilityStatus">Availability Status</label>
                <select id="availabilityStatus" name="availabilityStatus" value={formData.availabilityStatus} onChange={handleChange}>
                  <option value="">Select status</option>
                  <option value="Actively Looking">Actively Looking</option>
                  <option value="Open to Offers">Open to Offers</option>
                  <option value="Currently Employed">Currently Employed</option>
                </select>
              </div>
            </div>
          )}

          {/* --- NSRP TAB --- */}
          {activeTab === "nsrp" && !isAdmin && (
            <div className="profile-field-group">
              <h3 className="profile-section-title">NSRP Form Details</h3>
              {isEmployer ? (
                <div className="profile-field-group">
                  <div className="profile-field">
                    <label htmlFor="tradeName">Trade Name</label>
                    <input id="tradeName" type="text" name="tradeName" value={formData.tradeName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="acronym">Acronym</label>
                    <input id="acronym" type="text" name="acronym" value={formData.acronym} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="tin">TIN</label>
                    <input id="tin" type="text" name="tin" value={formData.tin} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="officeType">Office Type</label>
                    <select id="officeType" name="officeType" value={formData.officeType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="main">Main</option>
                      <option value="branch">Branch</option>
                    </select>
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="employerClassificationType">Classification Type</label>
                      <select id="employerClassificationType" name="employerClassificationType" value={formData.employerClassificationType} onChange={handleChange}>
                        <option value="">Select</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div className="profile-field">
                      <label htmlFor="employerClassificationSubtype">Subtype</label>
                      <select id="employerClassificationSubtype" name="employerClassificationSubtype" value={formData.employerClassificationSubtype} onChange={handleChange}>
                        <option value="">Select</option>
                        {formData.employerClassificationType === "public" ? (
                          ["NGA", "LGU", "GOCC", "SUC/LUC"].map(s => <option key={s} value={s}>{s}</option>)
                        ) : formData.employerClassificationType === "private" ? (
                          ["Direct Hire", "Local Recruitment Agency", "Overseas Recruitment Agency", "D.O. 174 Contractor"].map(s => <option key={s} value={s}>{s}</option>)
                        ) : null}
                      </select>
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="totalWorkforceSize">Total Workforce Size</label>
                    <select id="totalWorkforceSize" name="totalWorkforceSize" value={formData.totalWorkforceSize} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="micro">Micro (1-9)</option>
                      <option value="small">Small (10-99)</option>
                      <option value="medium">Medium (100-199)</option>
                      <option value="large">Large (200+)</option>
                    </select>
                  </div>
                  <div className="profile-field">
                    <label>Business Address (Structured)</label>
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      <input
                        type="text"
                        placeholder="Street"
                        value={formData.businessAddressStructured.street}
                        onChange={(e) => handleNestedChange("businessAddressStructured", "street", e.target.value)}
                      />
                      <LocationSelect
                        value={formData.businessAddressStructured}
                        onChange={(_loc, structured) => {
                          const nextAddress = structured || {
                            barangay: "",
                            municipality: "",
                            province: "",
                            region: "",
                          };
                          setFormData((prev) => ({
                            ...prev,
                            businessAddressStructured: {
                              ...prev.businessAddressStructured,
                              barangay: nextAddress.barangay || "",
                              municipality: nextAddress.city || nextAddress.municipality || "",
                              province: nextAddress.province || "",
                              region: nextAddress.region || "",
                            },
                          }));
                        }}
                        disabled={loading}
                        required={false}
                      />
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="ownerName">Owner / President Name</label>
                    <input id="ownerName" type="text" name="ownerName" value={formData.ownerName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="contactPersonName">Authorized Contact Person</label>
                    <input id="contactPersonName" type="text" name="contactPersonName" value={formData.contactPersonName} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="contactPersonPosition">Contact Person Position</label>
                    <input id="contactPersonPosition" type="text" name="contactPersonPosition" value={formData.contactPersonPosition} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="fax">Fax</label>
                    <input id="fax" type="text" name="fax" value={formData.fax} onChange={handleChange} />
                  </div>
                </div>
              ) : (
                <div className="profile-field-group">
                  <div className="profile-field">
                    <label htmlFor="civilStatus">Civil Status</label>
                    <select id="civilStatus" name="civilStatus" value={formData.civilStatus} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Widowed">Widowed</option>
                      <option value="Separated">Separated</option>
                      <option value="Divorced">Divorced</option>
                    </select>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="placeOfBirth">Place of Birth</label>
                    <input id="placeOfBirth" type="text" name="placeOfBirth" value={formData.placeOfBirth} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="citizenship">Citizenship</label>
                    <input id="citizenship" type="text" name="citizenship" value={formData.citizenship} onChange={handleChange} />
                  </div>
                  <div className="profile-field-grid">
                    <div className="profile-field">
                      <label htmlFor="height">Height (cm)</label>
                      <input id="height" type="number" name="height" value={formData.height} onChange={handleChange} className="number-input" />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="weight">Weight (kg)</label>
                      <input id="weight" type="number" name="weight" value={formData.weight} onChange={handleChange} className="number-input" />
                    </div>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="landline">Landline</label>
                    <input id="landline" type="tel" name="landline" value={formData.landline} onChange={handleChange} />
                  </div>
                  <div className="profile-field">
                    <label htmlFor="mobileSecondary">Secondary Mobile</label>
                    <input id="mobileSecondary" type="tel" name="mobileSecondary" value={formData.mobileSecondary} onChange={handleChange} />
                  </div>

                  <div className="profile-field">
                    <label>Present Address</label>
                    <input
                      type="text"
                      placeholder="Street"
                      value={formData.presentAddress.street}
                      onChange={(e) => handleNestedChange("presentAddress", "street", e.target.value)}
                    />
                    <LocationSelect
                      value={formData.presentAddress}
                      onChange={(_loc, structured) => {
                        const nextAddress = structured || {
                          barangay: "",
                          municipality: "",
                          province: "",
                          region: "",
                        };
                        setFormData((prev) => ({
                          ...prev,
                          presentAddress: {
                            ...prev.presentAddress,
                            barangay: nextAddress.barangay || "",
                            municipality: nextAddress.city || nextAddress.municipality || "",
                            province: nextAddress.province || "",
                            region: nextAddress.region || "",
                          },
                        }));
                      }}
                      disabled={loading}
                      required={false}
                    />
                  </div>

                  <div className="profile-field">
                    <label>Permanent Address</label>
                    <input
                      type="text"
                      placeholder="Street"
                      value={formData.permanentAddress.street}
                      onChange={(e) => handleNestedChange("permanentAddress", "street", e.target.value)}
                    />
                    <LocationSelect
                      value={formData.permanentAddress}
                      onChange={(_loc, structured) => {
                        const nextAddress = structured || {
                          barangay: "",
                          municipality: "",
                          province: "",
                          region: "",
                        };
                        setFormData((prev) => ({
                          ...prev,
                          permanentAddress: {
                            ...prev.permanentAddress,
                            barangay: nextAddress.barangay || "",
                            municipality: nextAddress.city || nextAddress.municipality || "",
                            province: nextAddress.province || "",
                            region: nextAddress.region || "",
                          },
                        }));
                      }}
                      disabled={loading}
                      required={false}
                    />
                  </div>

                  <div className="profile-field">
                    <label>Disability (select all that apply)</label>
                    <div className="checkbox-group">
                      {["Visual", "Hearing", "Speech", "Physical", "Others"].map((d) => (
                        <label key={d} className="custom-checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.disability.includes(d)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData((prev) => ({ ...prev, disability: [...prev.disability, d] }));
                              } else {
                                setFormData((prev) => ({ ...prev, disability: prev.disability.filter((item) => item !== d) }));
                              }
                            }}
                            className="custom-checkbox-input"
                          />
                          <span className="custom-checkbox-box"></span>
                          <span className="custom-checkbox-text">{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="profile-field">
                    <label>4Ps Beneficiary</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.is4psBeneficiary === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, is4psBeneficiary: true }))}>Yes</button>
                      <button type="button" className={`pill-btn ${formData.is4psBeneficiary === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, is4psBeneficiary: false }))}>No</button>
                    </div>
                  </div>
                  {formData.is4psBeneficiary && (
                    <div className="profile-field">
                      <label htmlFor="_4psHouseholdId">4Ps Household ID</label>
                      <input id="_4psHouseholdId" type="text" name="_4psHouseholdId" value={formData._4psHouseholdId} onChange={handleChange} />
                    </div>
                  )}

                  <div className="profile-field">
                    <label>Are you an OFW?</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.isOfw === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isOfw: true }))}>Yes</button>
                      <button type="button" className={`pill-btn ${formData.isOfw === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isOfw: false }))}>No</button>
                    </div>
                  </div>
                  {formData.isOfw && (
                    <>
                      <div className="profile-field">
                        <label>Repatriated / planning to return to PH?</label>
                        <div className="pill-row">
                          <button type="button" className={`pill-btn ${formData.isRepatriated === true ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isRepatriated: true }))}>Yes</button>
                          <button type="button" className={`pill-btn ${formData.isRepatriated === false ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, isRepatriated: false }))}>No</button>
                        </div>
                      </div>
                      {formData.isRepatriated && (
                        <div className="profile-field">
                          <label htmlFor="repatriationIntent">Repatriation Intent</label>
                          <input id="repatriationIntent" type="text" name="repatriationIntent" value={formData.repatriationIntent} onChange={handleChange} placeholder="e.g., Return to PH to work" />
                        </div>
                      )}
                    </>
                  )}

                  <div className="profile-field">
                    <label>Employment Status</label>
                    <div className="pill-row">
                      <button type="button" className={`pill-btn ${formData.employmentStatus === "employed" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentStatus: "employed" }))}>Employed</button>
                      <button type="button" className={`pill-btn ${formData.employmentStatus === "unemployed" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentStatus: "unemployed" }))}>Unemployed</button>
                    </div>
                  </div>
                  {formData.employmentStatus === "employed" && (
                    <div className="profile-field">
                      <label>Employment Type</label>
                      <div className="pill-row">
                        <button type="button" className={`pill-btn ${formData.employmentType === "wage" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentType: "wage" }))}>Wage</button>
                        <button type="button" className={`pill-btn ${formData.employmentType === "self" ? "active" : ""}`} onClick={() => setFormData((prev) => ({ ...prev, employmentType: "self" }))}>Self</button>
                      </div>
                    </div>
                  )}
                  {formData.employmentStatus === "unemployed" && (
                    <>
                      <div className="profile-field">
                        <label htmlFor="unemploymentReason">Reason for Unemployment</label>
                        <select id="unemploymentReason" name="unemploymentReason" value={formData.unemploymentReason} onChange={handleChange}>
                          <option value="">Select</option>
                          <option value="fresh_grad">Fresh Graduate</option>
                          <option value="finished_contract">Finished Contract</option>
                          <option value="resigned">Resigned</option>
                          <option value="retired">Retired</option>
                          <option value="laidoff_local">Laid off (Local)</option>
                          <option value="laidoff_abroad">Laid off (Abroad)</option>
                        </select>
                      </div>
                      {formData.unemploymentReason === "laidoff_abroad" && (
                        <div className="profile-field">
                          <label htmlFor="laidoffCountry">Country</label>
                          <input id="laidoffCountry" type="text" name="laidoffCountry" value={formData.laidoffCountry} onChange={handleChange} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* --- DOCUMENTS TAB --- */}
          {activeTab === "documents" && !isAdmin && (
            <div className="profile-field-group">
              <h3 className="profile-section-title"><FaFileAlt /> Documents</h3>
              {isEmployer ? (
                <>
                  <div className="profile-field">
                    <label htmlFor="businessPermitUpload">Business Permit</label>
                    <input id="businessPermitUpload" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setBusinessPermitFile(e.target.files[0])} className="profile-file-input" />
                    <label htmlFor="businessPermitUpload" className="profile-upload-zone"><FaUpload /> <span>Upload Business Permit</span></label>
                    <p className="profile-file-name">{businessPermitFile ? businessPermitFile.name : existingBusinessPermit ? existingBusinessPermit.split("/").pop() : "No business permit uploaded"}</p>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="registrationDocUpload">DTI / SEC Registration</label>
                    <input id="registrationDocUpload" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setRegistrationDocFile(e.target.files[0])} className="profile-file-input" />
                    <label htmlFor="registrationDocUpload" className="profile-upload-zone"><FaUpload /> <span>Upload Registration Document</span></label>
                    <p className="profile-file-name">{registrationDocFile ? registrationDocFile.name : existingRegistrationDoc ? existingRegistrationDoc.split("/").pop() : "No registration document uploaded"}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="profile-field">
                    <label htmlFor="profileUpload">Resume</label>
                    <input id="profileUpload" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setResumeFile(e.target.files[0])} className="profile-file-input" />
                    <label htmlFor="profileUpload" className="profile-upload-zone"><FaUpload /> <span>Upload Resume</span></label>
                    <p className="profile-file-name">{resumeFile ? resumeFile.name : existingResume ? existingResume.split("/").pop() : "No file selected"}</p>
                  </div>
                  <div className="profile-field">
                    <label htmlFor="supportingUpload">Valid ID / Supporting Documents</label>
                    <input id="supportingUpload" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setSupportingDocumentFile(e.target.files[0])} className="profile-file-input" />
                    <label htmlFor="supportingUpload" className="profile-upload-zone"><FaUpload /> <span>Upload Valid ID</span></label>
                    <p className="profile-file-name">{supportingDocumentFile ? supportingDocumentFile.name : existingValidId ? existingValidId.split("/").pop() : "No file selected"}</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <button type="submit" disabled={loading} className="profile-save-btn">
          <FaSave /> {loading ? "Saving..." : "Save Profile"}
        </button>

        <section className="danger-zone-section">
          <div className="danger-zone-divider"></div>
          <div className="danger-zone-header">
            <FaExclamationTriangle className="danger-zone-icon" />
            <p className="danger-zone-label">Danger Zone</p>
          </div>
          <p className="danger-zone-description">Permanently delete your account and all associated data. This action cannot be undone.</p>
          <button type="button" className="danger-zone-delete-btn" onClick={openDeleteModal}><FaTrash /> Delete My Account</button>
        </section>
      </form>

      {showDeleteModal && (
        <div className="delete-account-modal-overlay" onClick={closeDeleteModal}>
          <div className="delete-account-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-warning-icon"><FaExclamationTriangle /></div>
            <h3>Delete your account?</h3>
            <p>This will permanently delete your profile, skills, documents, and all job applications. This cannot be undone.</p>
            <label htmlFor="delete-name-confirm" className="delete-confirm-label">Type your full name to confirm:</label>
            <input id="delete-name-confirm" type="text" className="delete-confirm-input" value={deleteConfirmName} onChange={(e) => setDeleteConfirmName(e.target.value)} placeholder={expectedFullName || "Enter your full name"} disabled={isDeleting} />
            {deleteError && <p className="delete-modal-error">{deleteError}</p>}
            <div className="delete-account-modal-actions">
              <button type="button" className="delete-cancel-btn" onClick={closeDeleteModal} disabled={isDeleting}>Cancel</button>
              <button type="button" className="delete-confirm-btn" onClick={handleDeleteAccount} disabled={!isDeleteNameMatch || isDeleting}>
                {isDeleting ? "Deleting..." : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}