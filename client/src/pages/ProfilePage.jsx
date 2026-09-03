import { useContext, useEffect, useMemo, useState } from "react";
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
} from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { adminAPI, authAPI, employerAPI, jobLikeAPI, messageAPI, followAPI, newsLikeAPI } from "../services/api";
import "../styles/profile-redesign.css";

const formatStructuredAddress = (addr) => {
  if (!addr) return "Not provided";
  const parts = [addr.street, addr.barangay, addr.municipality, addr.province, addr.region].filter(Boolean);
  return parts.length ? parts.join(", ") : "Not provided";
};

const formatAddress = (value) => {
  if (!value) return "Not provided";
  if (typeof value === "string") return value;
  return formatStructuredAddress(value);
};

const formatDate = (value) => {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not provided";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const completionForRole = (profile, role) => {
  const checksByRole = {
    resident: [
      Boolean(profile?.name),
      Boolean(profile?.email),
      Boolean(profile?.phone),
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
      Boolean(profile?.presentAddress && formatStructuredAddress(profile?.presentAddress) !== "Not provided"),
      Boolean(profile?.permanentAddress && formatStructuredAddress(profile?.permanentAddress) !== "Not provided"),
    ],
    employer: [
      Boolean(profile?.name),
      Boolean(profile?.email),
      Boolean(profile?.phone),
      Boolean(profile?.companyName),
      Boolean(profile?.industry),
      Boolean(profile?.businessAddress || profile?.businessAddressStructured),
      Boolean(profile?.website),
      Boolean(profile?.companyDescription),
      Boolean(profile?.tradeName),
      Boolean(profile?.tin),
      Boolean(profile?.contactPersonName),
      Boolean(profile?.businessPermitUrl),
      Boolean(profile?.registrationDocUrl),
    ],
    admin: [Boolean(profile?.name), Boolean(profile?.email), Boolean(profile?.phone)],
  };

  const checks = checksByRole[role] || checksByRole.resident;
  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
};

const DataItem = ({ label, value }) => (
  <div className="rd-data-item">
    <span className="rd-data-label">{label}</span>
    <span className="rd-data-value">{value || "Not provided"}</span>
  </div>
);

export default function ProfilePage({ isAdminView = false }) {
  const { user, setUser } = useContext(AuthContext);
  const { userId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(isAdminView ? null : user);
  const [loading, setLoading] = useState(true);
  const [employerStats, setEmployerStats] = useState({ activeJobs: 0, totalApplicants: 0, closedJobs: 0 });
  const [likedJobs, setLikedJobs] = useState([]);
  const [likedJobsLoading, setLikedJobsLoading] = useState(false);
  const [likedNews, setLikedNews] = useState([]);
  const [likedNewsLoading, setLikedNewsLoading] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

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
  const isReadOnly = isAdminView;

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
        if (!isAdminView) {
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
        if (!isAdminView && user) {
          setProfile(user);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [isAdminView, userId]);

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
          console.warn("⚠️ Invalid targetUserId:", targetUserId);
          // Fallback: if profile is not loaded, use userId from URL params (for admin view)
          if (userId && isValidObjectId(userId)) {
            targetUserId = userId;
          } else if (user?._id && isValidObjectId(user._id)) {
            targetUserId = user._id;
          } else {
            console.error("❌ No valid user ID found for connections");
            setFollowers([]);
            setFollowing([]);
            setConnectionsLoading(false);
            return;
          }
        }

        console.log("📌 Target user ID for connections:", targetUserId);

        const [followersRes, followingRes] = await Promise.all([
          followAPI.getFollowers(targetUserId, { page: 1, limit: 100 }),
          followAPI.getFollowing(targetUserId, { page: 1, limit: 100 }),
        ]);

        console.log("📥 Followers response:", followersRes);
        console.log("📥 Following response:", followingRes);

        // Extract data from response (handle both { data: [...] } and direct array)
        const followersData = followersRes.data?.data ?? followersRes.data ?? [];
        const followingData = followingRes.data?.data ?? followingRes.data ?? [];

        console.log(`👥 Followers (${followersData.length}):`, followersData);
        console.log(`👤 Following (${followingData.length}):`, followingData);

        setFollowers(Array.isArray(followersData) ? followersData : []);
        setFollowing(Array.isArray(followingData) ? followingData : []);
      } catch (error) {
        console.error("❌ Error fetching connections:", error);
        setFollowers([]);
        setFollowing([]);
      } finally {
        setConnectionsLoading(false);
      }
    };

    fetchConnections();
  }, [activeTab, profile, user, userId]);

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
  const completion = useMemo(() => completionForRole(profile, normalizedRole || "resident"), [profile, normalizedRole]);
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];

  const resumeName = profile?.resumeFile ? profile.resumeFile.split("/").pop() : null;
  const resumeUrl = profile?.resumeFile ? `http://localhost:3000/${profile.resumeFile}` : null;
  const permitName = profile?.businessPermitUrl ? profile.businessPermitUrl.split("/").pop() : null;
  const permitUrl = profile?.businessPermitUrl ? `http://localhost:3000/${profile.businessPermitUrl}` : null;
  const registrationName = profile?.registrationDocUrl ? profile.registrationDocUrl.split("/").pop() : null;
  const registrationUrl = profile?.registrationDocUrl ? `http://localhost:3000/${profile.registrationDocUrl}` : null;

  if (!profile && loading) return null;

  return (
    <div className="profile-view-page rd-page">
      <div className="profile-overlay" />

      <section className="rd-shell">
        <header className="rd-header-card">
          <div className="rd-header-top">
            <div className="rd-avatar">{profile?.name ? profile.name.trim().charAt(0).toUpperCase() : "U"}</div>
            <div className="rd-main">
              <h1>{profile?.name || "User"}</h1>
              <div className="rd-chip-row">
                <span className="rd-role-chip">{profile?.desiredJobTitle || (isEmployer ? "Employer" : isAdmin ? "Administrator" : "Jobseeker")}</span>
                {profile?.availabilityStatus ? <span className="rd-status-chip">{profile.availabilityStatus}</span> : null}
              </div>
              <div className="rd-quick-links">
                {profile?.email ? <a href={`mailto:${profile.email}`}><FaEnvelope /> {profile.email}</a> : null}
                {profile?.phone ? <a href={`tel:${profile.phone}`}><FaPhone /> {profile.phone}</a> : null}
                {(profile?.address || profile?.businessAddress) ? <span><FaMapMarkerAlt /> {formatAddress(profile?.businessAddress || profile?.address)}</span> : null}
              </div>
            </div>
            <div className="rd-actions">
              {!isReadOnly ? (
                <button className="rd-edit-btn" type="button" onClick={() => navigate("/profile/edit")}>
                  <FaEdit /> Edit Profile
                </button>
              ) : null}
              {!isAdmin ? (
                <button className="rd-export-btn" type="button" onClick={() => window.print()}>
                  <FaFilePdf /> Export NSRP Form 1 (PDF)
                </button>
              ) : null}
            </div>
          </div>

          <div className="rd-progress-block">
            <div className="rd-progress-label-row">
              <span>Profile Completion</span>
              <strong>{completion}% Completed</strong>
            </div>
            <div className="rd-progress-track">
              <div className="rd-progress-fill" style={{ width: `${completion}%` }} />
            </div>
          </div>

          {!isAdmin && !isReadOnly ? (
            <nav className="rd-subnav" aria-label="Profile tabs">
              <Link to="/profile" className={activeTab === "overview" ? "active" : ""}>Overview</Link>
              {!isEmployer ? <Link to="/profile/favorites" className={activeTab === "favorites" ? "active" : ""}><FaBookmark /> Favorites</Link> : null}
              <Link to="/profile/likes" className={activeTab === "likes" ? "active" : ""}><FaHeart /> My Likes</Link>
              <Link to="/profile/followers" className={activeTab === "followers" ? "active" : ""}><FaUsers /> Followers</Link>
            </nav>
          ) : null}
        </header>

        {activeTab === "likes" && !isAdmin ? (
          <section className="rd-card rd-card-full">
            <h2><FaHeart /> My Liked Announcements</h2>
            {likedNewsLoading ? (
              <p className="rd-empty">Loading your liked announcements...</p>
            ) : likedNews.length === 0 ? (
              <p className="rd-empty">No liked announcements yet. Tap the heart on any post in the News Feed to save it here.</p>
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
              <p className="rd-empty">Loading your saved jobs...</p>
            ) : likedJobs.length === 0 ? (
              <p className="rd-empty">No saved jobs yet. Use the heart icon in Browse Jobs to add favorites.</p>
            ) : (
              <div className="rd-favorites-grid">
                {likedJobs.map((job) => (
                  <article key={job._id} className="rd-favorite-item">
                    <div className="rd-favorite-head">
                      <h3>{job.title || "Untitled Job"}</h3>
                      <span className="rd-ribbon"><FaBookmark /> Saved</span>
                    </div>
                    <p><FaBriefcase /> {job.employer?.companyName || "Employer"}</p>
                    <p><FaMapMarkerAlt /> {formatAddress(job.location)}</p>
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
          <section className="rd-card rd-card-full">
            <h2><FaUsers /> Followers & Following</h2>
            {connectionsLoading ? (
              <p className="rd-empty">Loading connections...</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                <div>
                  <h3 style={{ marginBottom: "16px", fontSize: "18px", fontWeight: 600 }}>Followers ({followers.length})</h3>
                  {followers.length === 0 ? (
                    <p className="rd-empty">No followers yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {followers.map((follower) => (
                        <div key={follower._id} style={{ padding: "12px", border: "1px solid #ddd", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                            <div style={{ width: "40px", height: "40px", borderRadius: "50%", backgroundColor: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                              {follower.name?.charAt(0).toUpperCase() || "U"}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontWeight: 600, margin: 0 }}>{follower.name || "User"}</p>
                              <p style={{ fontSize: "12px", color: "#666", margin: "4px 0 0 0" }}>{follower.email}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 style={{ marginBottom: "16px", fontSize: "18px", fontWeight: 600 }}>Following ({following.length})</h3>
                  {following.length === 0 ? (
                    <p className="rd-empty">Not following anyone yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {following.map((followedUser) => (
                        <div key={followedUser._id} style={{ padding: "12px", border: "1px solid #ddd", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                            <div style={{ width: "40px", height: "40px", borderRadius: "50%", backgroundColor: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                              {followedUser.name?.charAt(0).toUpperCase() || "U"}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontWeight: 600, margin: 0 }}>{followedUser.name || "User"}</p>
                              <p style={{ fontSize: "12px", color: "#666", margin: "4px 0 0 0" }}>{followedUser.email}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="rd-grid">
            <section className="rd-card">
              <h2>Personal & Contact</h2>
              <div className="rd-data-grid">
                <DataItem label="Email" value={profile?.email} />
                <DataItem label="Phone" value={profile?.phone} />
                <DataItem label="Date of Birth" value={formatDate(profile?.dateOfBirth)} />
                <DataItem label="Gender" value={profile?.gender} />
                <DataItem label="Civil Status" value={profile?.civilStatus} />
                <DataItem label="Citizenship" value={profile?.citizenship} />
                <DataItem label="Address" value={formatAddress(profile?.address || profile?.businessAddress)} />
                <DataItem label="Present Address" value={formatStructuredAddress(profile?.presentAddress)} />
                <DataItem label="Permanent Address" value={formatStructuredAddress(profile?.permanentAddress)} />
              </div>
            </section>

            <section className="rd-card">
              <h2>NSRP / Demographics</h2>
              <div className="rd-data-grid">
                <DataItem label="Height" value={profile?.height ? `${profile.height} cm` : "Not provided"} />
                <DataItem label="Weight" value={profile?.weight ? `${profile.weight} kg` : "Not provided"} />
                <DataItem label="Disability" value={Array.isArray(profile?.disability) && profile.disability.length ? profile.disability.join(", ") : "None"} />
                <DataItem label="4Ps Beneficiary" value={profile?.is4psBeneficiary ? "Yes" : "No"} />
                <DataItem label="4Ps Household ID" value={profile?._4psHouseholdId} />
                <DataItem label="OFW" value={profile?.isOfw ? "Yes" : "No"} />
                <DataItem label="Repatriated" value={profile?.isRepatriated ? "Yes" : "No"} />
                <DataItem label="Repatriation Intent" value={profile?.repatriationIntent} />
                <DataItem label="Employment Status" value={profile?.employmentStatus} />
              </div>
            </section>

            <section className="rd-card rd-card-full">
              <h2>Skills & Documents</h2>
              <div className="rd-skills-wrap">
                {skills.length ? skills.map((skill) => <span key={skill} className="rd-skill-pill">{skill}</span>) : <span className="rd-empty">No skills added yet.</span>}
              </div>

              <div className="rd-doc-grid">
                <div className="rd-doc-item">
                  <span>Resume</span>
                  {resumeUrl ? (
                    <a href={resumeUrl} target="_blank" rel="noreferrer"><FaDownload /> {resumeName || "Download Resume"}</a>
                  ) : (
                    <span className="rd-empty">No resume uploaded.</span>
                  )}
                </div>

                {isEmployer ? (
                  <>
                    <div className="rd-doc-item">
                      <span>Business Permit</span>
                      {permitUrl ? (
                        <a href={permitUrl} target="_blank" rel="noreferrer"><FaDownload /> {permitName || "Download Permit"}</a>
                      ) : (
                        <span className="rd-empty">No permit uploaded.</span>
                      )}
                    </div>
                    <div className="rd-doc-item">
                      <span>Registration Document</span>
                      {registrationUrl ? (
                        <a href={registrationUrl} target="_blank" rel="noreferrer"><FaDownload /> {registrationName || "Download Registration"}</a>
                      ) : (
                        <span className="rd-empty">No registration document uploaded.</span>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            {isEmployer ? (
              <section className="rd-card rd-card-full">
                <h2>Employer Activity</h2>
                <div className="rd-stats-row">
                  <article className="rd-stat-card"><strong>{employerStats.activeJobs}</strong><span>Active Jobs</span></article>
                  <article className="rd-stat-card"><strong>{employerStats.totalApplicants}</strong><span>Total Applicants</span></article>
                  <article className="rd-stat-card"><strong>{employerStats.closedJobs}</strong><span>Closed Jobs</span></article>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}