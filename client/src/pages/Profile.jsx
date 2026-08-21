import { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { authAPI, employerAPI, adminAPI } from "../services/api";
import "../styles/profile.css";

// Helper: format simple address (string) – displays as a single line
const formatAddress = (address) => {
  if (!address) return <span className="profile-missing">Not provided</span>;
  return <span>{address}</span>;
};

// Helper: format structured address (object) – joins with ", "
const formatStructuredAddress = (addr) => {
  if (!addr) return <span className="profile-missing">Not provided</span>;
  const parts = [
    addr.street,
    addr.barangay,
    addr.municipality,
    addr.province,
    addr.region,
  ].filter(Boolean);
  if (parts.length === 0) return <span className="profile-missing">Not provided</span>;
  return <span>{parts.join(", ")}</span>;
};

// Helper: map unemployment reason to human-readable string
const unemploymentReasonMap = {
  fresh_grad: "Fresh Graduate",
  finished_contract: "Finished Contract",
  resigned: "Resigned",
  retired: "Retired",
  laidoff_local: "Laid off (Local)",
  laidoff_abroad: "Laid off (Abroad)",
};

const formatUnemploymentReason = (value) => {
  if (!value) return null;
  return unemploymentReasonMap[value] || value;
};

export default function Profile({ isAdminView = false }) {
  const { user, setUser } = useContext(AuthContext);
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(isAdminView ? null : user);
  const [loading, setLoading] = useState(true);
  const [employerStats, setEmployerStats] = useState({
    activeJobs: 0,
    totalApplicants: 0,
    closedJobs: 0,
  });

  const isEmployer = profile?.role === "employer";
  const isAdmin = profile?.role === "admin";
  const isReadOnly = isAdminView;

  const fallback = (value) => {
    if (!value) return <span className="profile-missing">Not provided</span>;
    return value;
  };

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
        } else {
          const { data } = await authAPI.getProfile();
          userData = data.user || {};
          profileData = data.profile || {};
        }

        // Start with userData (this has the string businessAddress)
        const mergedProfile = { ...userData };

        // For employer, map profileData.businessAddress (object) to businessAddressStructured
        if (userData.role === "employer" && profileData.businessAddress) {
          mergedProfile.businessAddressStructured = profileData.businessAddress;
        }

        // Merge other profile fields (excluding businessAddress to avoid conflict)
        const { businessAddress, ...restProfile } = profileData;
        Object.assign(mergedProfile, restProfile);

        setProfile(mergedProfile);
        if (!isAdminView) {
          setUser(mergedProfile);
        }

        if (userData?.role === "employer") {
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
        } else {
          setEmployerStats({
            activeJobs: 0,
            totalApplicants: 0,
            closedJobs: 0,
          });
        }
      } catch (err) {
        // Fallback to user from context
        if (!isAdminView && user) {
          setProfile(user);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminView, userId]);

  const skills = Array.isArray(profile?.skills) ? profile.skills : [];

  const resumeName = profile?.resumeFile ? profile.resumeFile.split("/").pop() : null;
  const validIdName = profile?.validIdFile ? profile.validIdFile.split("/").pop() : null;
  const permitName = profile?.businessPermitUrl ? profile.businessPermitUrl.split("/").pop() : null;
  const registrationName = profile?.registrationDocUrl ? profile.registrationDocUrl.split("/").pop() : null;

  const resumeUrl = profile?.resumeFile ? `http://localhost:3000/${profile.resumeFile}` : null;
  const validIdUrl = profile?.validIdFile ? `http://localhost:3000/${profile.validIdFile}` : null;
  const permitUrl = profile?.businessPermitUrl ? `http://localhost:3000/${profile.businessPermitUrl}` : null;
  const registrationUrl = profile?.registrationDocUrl ? `http://localhost:3000/${profile.registrationDocUrl}` : null;

  const formatDate = (value) => {
    if (!value) return <span className="profile-missing">Not provided</span>;
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const verificationClass = useMemo(() => {
    const status = String(profile?.verificationStatus || "unverified").toLowerCase();
    if (status === "verified") return "verified";
    if (status === "pending") return "pending";
    return "unverified";
  }, [profile?.verificationStatus]);

  if (!profile && loading) return null;

  return (
    <div className="profile-view-page">
      <div className="profile-overlay"></div>

      <section className="profile-view-card">
        <header className="profile-view-header">
          {!isReadOnly ? (
            <button className="profile-edit-btn" type="button" onClick={() => navigate("/profile/edit")}>
              Edit Profile
            </button>
          ) : null}
          <div className="profile-view-avatar">
            {profile?.name ? profile.name.trim().charAt(0).toUpperCase() : "U"}
          </div>
          <h1>{profile?.name}</h1>

          {isAdmin ? (
            <span className="profile-role-admin">🛡️ System Administrator</span>
          ) : isEmployer ? (
            <>
              <p>{fallback(profile?.companyName)}</p>
              <span className="profile-role-employer">🏢 Employer Account</span>
            </>
          ) : (
            <>
              <p>{profile?.desiredJobTitle || <span className="profile-missing">Not provided</span>}</p>
              {profile?.availabilityStatus ? (
                <span className="profile-availability-badge">{profile.availabilityStatus}</span>
              ) : null}
            </>
          )}
        </header>

        {isAdmin ? (
          <>
            <div className="profile-view-section">
              <h2>Account Details</h2>
              <div className="profile-detail-row"><span>Email Address</span><strong>{fallback(profile?.email)}</strong></div>
              <div className="profile-detail-row"><span>Phone Number</span><strong>{fallback(profile?.phone)}</strong></div>
              <div className="profile-detail-row"><span>Date Joined</span><strong>{formatDate(profile?.createdAt)}</strong></div>
            </div>

            <div className="profile-view-section">
              <h2>System Access</h2>
              <div className="profile-detail-row"><span>Role</span><strong>Administrator</strong></div>
              <div className="profile-detail-row"><span>Access Level</span><strong>Full System Access</strong></div>
              <div className="profile-detail-row"><span>Account Status</span><strong>{profile?.isActive === false ? "Inactive" : "Active"}</strong></div>
            </div>
          </>
        ) : isEmployer ? (
          <>
            <div className="profile-view-section">
              <h2>Company Details</h2>
              <div className="profile-detail-row"><span>Email Address</span><strong>{fallback(profile?.email)}</strong></div>
              <div className="profile-detail-row"><span>Phone Number</span><strong>{fallback(profile?.phone)}</strong></div>
              <div className="profile-detail-row">
                <span>Business Address</span>
                <strong>{formatAddress(profile?.businessAddress || profile?.address)}</strong>
              </div>
              <div className="profile-detail-row"><span>Company Name</span><strong>{fallback(profile?.companyName)}</strong></div>
              <div className="profile-detail-row"><span>Industry / Sector</span><strong>{fallback(profile?.industry)}</strong></div>
              <div className="profile-detail-row"><span>Company Size</span><strong>{fallback(profile?.companySize)}</strong></div>
              <div className="profile-detail-row"><span>Website / Facebook Page</span><strong>{profile?.website ? <a href={profile.website} target="_blank" rel="noreferrer" className="profile-inline-link">{profile.website}</a> : <span className="profile-missing">Not provided</span>}</strong></div>
            </div>

            <div className="profile-view-section">
              <h2>NSRP Employer Details</h2>
              <div className="profile-detail-row"><span>Trade Name</span><strong>{fallback(profile?.tradeName)}</strong></div>
              <div className="profile-detail-row"><span>Acronym</span><strong>{fallback(profile?.acronym)}</strong></div>
              <div className="profile-detail-row"><span>TIN</span><strong>{fallback(profile?.tin)}</strong></div>
              <div className="profile-detail-row"><span>Office Type</span><strong>{fallback(profile?.officeType)}</strong></div>
              <div className="profile-detail-row"><span>Classification</span><strong>{profile?.employerClassification ? `${profile.employerClassification.type}${profile.employerClassification.subtype ? ` - ${profile.employerClassification.subtype}` : ''}` : <span className="profile-missing">Not provided</span>}</strong></div>
              <div className="profile-detail-row"><span>Total Workforce Size</span><strong>{fallback(profile?.totalWorkforceSize)}</strong></div>
              <div className="profile-detail-row"><span>Owner / President</span><strong>{fallback(profile?.ownerName)}</strong></div>
              <div className="profile-detail-row"><span>Contact Person</span><strong>{fallback(profile?.contactPersonName)}</strong></div>
              <div className="profile-detail-row"><span>Contact Person Position</span><strong>{fallback(profile?.contactPersonPosition)}</strong></div>
              <div className="profile-detail-row"><span>Fax</span><strong>{fallback(profile?.fax)}</strong></div>
              {profile?.businessAddressStructured && (
                <div className="profile-detail-row">
                  <span>Structured Business Address</span>
                  <strong>{formatStructuredAddress(profile.businessAddressStructured)}</strong>
                </div>
              )}
            </div>

            <div className="profile-view-section">
              <h2>Company Overview</h2>
              {profile?.companyDescription ? (
                <p className="profile-company-description">{profile.companyDescription}</p>
              ) : (
                <p className="profile-company-description profile-company-description--empty">
                  No company description added yet.
                </p>
              )}
            </div>

            <div className="profile-view-section">
              <h2>Posting Activity</h2>
              <div className="profile-stats-row">
                <article className="profile-stat-card">
                  <strong>{employerStats.activeJobs}</strong>
                  <span>Active Job Postings</span>
                </article>
                <article className="profile-stat-card">
                  <strong>{employerStats.totalApplicants}</strong>
                  <span>Total Applicants Received</span>
                </article>
                <article className="profile-stat-card">
                  <strong>{employerStats.closedJobs}</strong>
                  <span>Jobs Closed</span>
                </article>
              </div>
            </div>

            <div className="profile-view-section">
              <h2>Verification</h2>
              <div className="profile-detail-row profile-detail-row--document">
                <span>Business Permit</span>
                <strong>
                  {permitName ? permitName : <span className="profile-missing">No business permit uploaded</span>}
                  {permitUrl ? (
                    <a className="profile-doc-upload-btn" href={permitUrl} target="_blank" rel="noreferrer">Download</a>
                  ) : !isReadOnly ? (
                    <button type="button" className="profile-doc-upload-btn" onClick={() => navigate("/profile/edit")}>Upload</button>
                  ) : null}
                </strong>
              </div>
              <div className="profile-detail-row profile-detail-row--document">
                <span>DTI / SEC Registration</span>
                <strong>
                  {registrationName ? registrationName : <span className="profile-missing">No registration document uploaded</span>}
                  {registrationUrl ? (
                    <a className="profile-doc-upload-btn" href={registrationUrl} target="_blank" rel="noreferrer">Download</a>
                  ) : !isReadOnly ? (
                    <button type="button" className="profile-doc-upload-btn" onClick={() => navigate("/profile/edit")}>Upload</button>
                  ) : null}
                </strong>
              </div>
              <div className="profile-detail-row">
                <span>Verification Status</span>
                <strong>
                  <span className={`profile-verification-badge ${verificationClass}`}>
                    {verificationClass === "verified" ? "Verified ✓" : verificationClass === "pending" ? "Pending Review" : "Unverified"}
                  </span>
                </strong>
              </div>
            </div>
          </>
        ) : (
          // Jobseeker view
          <>
            <div className="profile-view-section">
              <h2>Personal Details</h2>
              <div className="profile-detail-row"><span>Email Address</span><strong>{fallback(profile?.email)}</strong></div>
              <div className="profile-detail-row"><span>Phone Number</span><strong>{fallback(profile?.phone)}</strong></div>
              <div className="profile-detail-row"><span>Date of Birth</span><strong>{formatDate(profile?.dateOfBirth)}</strong></div>
              <div className="profile-detail-row"><span>Gender</span><strong>{fallback(profile?.gender)}</strong></div>
              <div className="profile-detail-row">
                <span>Address / Location</span>
                <strong>{formatAddress(profile?.address)}</strong>
              </div>
            </div>

            <div className="profile-view-section">
              <h2>NSRP Demographic Details</h2>
              <div className="profile-detail-row"><span>Civil Status</span><strong>{fallback(profile?.civilStatus)}</strong></div>
              <div className="profile-detail-row"><span>Place of Birth</span><strong>{fallback(profile?.placeOfBirth)}</strong></div>
              <div className="profile-detail-row"><span>Citizenship</span><strong>{fallback(profile?.citizenship)}</strong></div>
              <div className="profile-detail-row"><span>Height (cm)</span><strong>{fallback(profile?.height)}</strong></div>
              <div className="profile-detail-row"><span>Weight (kg)</span><strong>{fallback(profile?.weight)}</strong></div>
              <div className="profile-detail-row"><span>Landline</span><strong>{fallback(profile?.landline)}</strong></div>
              <div className="profile-detail-row"><span>Secondary Mobile</span><strong>{fallback(profile?.mobileSecondary)}</strong></div>
              <div className="profile-detail-row">
                <span>Present Address</span>
                <strong>{formatStructuredAddress(profile?.presentAddress)}</strong>
              </div>
              <div className="profile-detail-row">
                <span>Permanent Address</span>
                <strong>{formatStructuredAddress(profile?.permanentAddress)}</strong>
              </div>
              <div className="profile-detail-row"><span>Disability</span><strong>{profile?.disability?.length ? profile.disability.join(", ") : <span className="profile-missing">None</span>}</strong></div>
              <div className="profile-detail-row"><span>4Ps Beneficiary</span><strong>{profile?.is4psBeneficiary ? "Yes" : "No"}</strong></div>
              {profile?.is4psBeneficiary && <div className="profile-detail-row"><span>4Ps Household ID</span><strong>{fallback(profile?._4psHouseholdId)}</strong></div>}
              <div className="profile-detail-row"><span>OFW</span><strong>{profile?.isOfw ? "Yes" : "No"}</strong></div>
              {profile?.isOfw && (
                <>
                  <div className="profile-detail-row"><span>Repatriated / Returning to PH</span><strong>{profile?.isRepatriated ? "Yes" : "No"}</strong></div>
                  {profile?.isRepatriated && <div className="profile-detail-row"><span>Repatriation Intent</span><strong>{fallback(profile?.repatriationIntent)}</strong></div>}
                </>
              )}
              <div className="profile-detail-row"><span>Employment Status</span><strong>{fallback(profile?.employmentStatus)}</strong></div>
              {profile?.employmentStatus === "employed" && (
                <div className="profile-detail-row"><span>Employment Type</span><strong>{fallback(profile?.employmentType)}</strong></div>
              )}
              {profile?.employmentStatus === "unemployed" && (
                <>
                  <div className="profile-detail-row"><span>Unemployment Reason</span><strong>{fallback(formatUnemploymentReason(profile?.unemploymentReason))}</strong></div>
                  {profile?.unemploymentReason === "laidoff_abroad" && (
                    <div className="profile-detail-row"><span>Laid Off Country</span><strong>{fallback(profile?.laidoffCountry)}</strong></div>
                  )}
                </>
              )}
            </div>

            <div className="profile-view-section">
              <h2>Skills</h2>
              <div className="profile-detail-row profile-detail-row--skills">
                <div className="profile-skills-list">
                  {skills.length > 0 ? (
                    skills.map((skill) => <span key={skill} className="profile-skill-tag">{skill}</span>)
                  ) : (
                    <span className="profile-missing">No skills added yet</span>
                  )}
                </div>
                {skills.length === 0 && !isReadOnly ? <Link to="/profile/edit" className="profile-inline-link">Add skills</Link> : null}
              </div>
            </div>

            <div className="profile-view-section">
              <h2>Work Background</h2>
              <div className="profile-detail-row"><span>Desired Position</span><strong>{fallback(profile?.desiredJobTitle)}</strong></div>
              <div className="profile-detail-row"><span>Educational Attainment</span><strong>{fallback(profile?.educationalAttainment)}</strong></div>
              <div className="profile-detail-row"><span>Work Experience</span><strong>{fallback(profile?.workExperience)}</strong></div>
              <div className="profile-detail-row">
                <span>Availability Status</span>
                <strong>{profile?.availabilityStatus ? <span className="profile-availability-badge">{profile.availabilityStatus}</span> : <span className="profile-missing">Not provided</span>}</strong>
              </div>
            </div>

            <div className="profile-view-section">
              <h2>Documents</h2>
              <div className="profile-detail-row profile-detail-row--document">
                <span>Resume</span>
                <strong>
                  {resumeName ? resumeName : <span className="profile-missing">No resume uploaded</span>}
                  {resumeUrl ? (
                    <a className="profile-doc-upload-btn" href={resumeUrl} target="_blank" rel="noreferrer">Download</a>
                  ) : !isReadOnly ? (
                    <button type="button" className="profile-doc-upload-btn" onClick={() => navigate("/profile/edit")}>Upload</button>
                  ) : null}
                </strong>
              </div>
              <div className="profile-detail-row profile-detail-row--document">
                <span>Valid ID</span>
                <strong>
                  {validIdName ? validIdName : <span className="profile-missing">No valid ID uploaded</span>}
                  {validIdUrl ? (
                    <a className="profile-doc-upload-btn" href={validIdUrl} target="_blank" rel="noreferrer">Download</a>
                  ) : !isReadOnly ? (
                    <button type="button" className="profile-doc-upload-btn" onClick={() => navigate("/profile/edit")}>Upload</button>
                  ) : null}
                </strong>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}