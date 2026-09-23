import { useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaEnvelope, FaUserCircle, FaBars, FaTimes, FaBell, FaCog } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { messageAPI, notificationAPI, resolveAssetUrl } from "../services/api";
import { useSocket } from "../context/SocketContext";
import "../styles/navbar.css";
import pesoLogo from "../assets/images/peso-logo.png";

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

// Routes whose page renders its own dedicated setup rail (e.g. the applicant /
// employer detail onboarding). The app sidebar is suppressed on these so it
// doesn't compete with the flow's own step navigator.
const SETUP_PATHS = new Set(["/onboarding"]);

const getLoggedInMenuItems = (userRole, t) => {
  // The superadmin handles the technical surface only: account provisioning,
  // user management, audit trail, job monitoring, a read-only view of the
  // employer verification queue, and read-only oversight of the admin
  // dashboard. News / announcements / SPES stay with PESO admins.
  if (userRole === "superadmin") {
    return [
      {
        label: t("navbar.adminDashboard"),
        submenu: [
          { label: t("navbar.dashboard"), to: "/admin" },
          { label: t("navbar.reportsStatistics"), to: "/admin/reports" },
        ],
      },
      {
        label: t("navbar.userManagement"),
        submenu: [
          { label: t("navbar.userManagement"), to: "/admin/users" },
          { label: t("navbar.reportsAppeals"), to: "/admin/users/moderation" },
        ],
      },
      {
        label: t("navbar.employmentJobs"),
        submenu: [
          { label: t("navbar.employerVerification"), to: "/admin/verification" },
          { label: t("navbar.jobMonitoring"), to: "/admin/job-monitoring" },
        ],
      },
      {
        label: t("navbar.systemLogs"),
        submenu: [{ label: t("navbar.auditTrail"), to: "/admin/audit-logs" }],
      },
      { label: t("navbar.myProfile"), to: "/profile" },
      { label: t("navbar.settings"), to: "/settings" },
    ];
  }

  if (userRole === "admin") {
    // User Management (directory, verification queue, reports & appeals) and the
    // Audit Trail are superadmin-only surfaces — PESO admins no longer see them.
    return [
      {
        label: t("navbar.adminDashboard"),
        submenu: [
          { label: t("navbar.dashboard"), to: "/admin" },
          { label: t("navbar.reportsStatistics"), to: "/admin/reports" },
        ],
      },
      {
        label: t("navbar.newsManagement"),
        submenu: [
          { label: t("navbar.newsFeed"), to: "/admin/news" },
          { label: t("navbar.postAnnouncement"), to: "/admin/news/create" },
          { label: t("navbar.spesApplications"), to: "/admin/spes" },
        ],
      },
      { label: t("navbar.employerVerification"), to: "/admin/verification" },
      { label: t("navbar.jobMonitoring"), to: "/admin/job-monitoring" },
      // No Audit Trail here (superadmin-only) — this group exists so
      // Notifications/Messages have a "System & Logs" home to pin to, same
      // as the superadmin menu above.
      { label: t("navbar.systemLogs"), submenu: [] },
      { label: t("navbar.myProfile"), to: "/profile" },
      { label: t("navbar.settings"), to: "/settings" },
    ];
  }

  if (userRole === "employer") {
    return [
      { label: t("navbar.employerDashboard"), to: "/employer" },
      { label: t("navbar.postVacancy"), to: "/post-job" },
      { label: t("navbar.newsFeed"), to: "/news" },
      { label: t("navbar.myProfile"), to: "/profile" },
      { label: t("navbar.settings"), to: "/settings" },
    ];
  }

  return [
    {
      label: t("navbar.myDashboard"),
      submenu: [
        { label: t("navbar.dashboard"), to: "/dashboard" },
        { label: t("navbar.yourApplications"), to: "/applications" },
        { label: t("navbar.mySpes"), to: "/spes/applications" },
      ],
    },
    { label: t("navbar.browseJobs"), to: "/jobs" },
    { label: t("navbar.newsFeed"), to: "/news" },
    { label: t("navbar.myProfile"), to: "/profile" },
    { label: t("navbar.settings"), to: "/settings" },
  ];
};

const getDefaultRouteByRole = (role) => {
  if (role === "superadmin") return "/superadmin";
  if (role === "admin") return "/admin";
  if (role === "employer") return "/employer";
  return "/dashboard";
};

const getJobseekerMenuGroups = (t) => [
  {
    label: t("navbar.overview"),
    items: [{ label: t("navbar.dashboard"), to: "/dashboard" }],
  },
  {
    label: t("navbar.career"),
    items: [
      { label: t("navbar.yourApplications"), to: "/applications" },
      { label: t("navbar.mySpes"), to: "/spes/applications" },
      { label: t("navbar.browseJobs"), to: "/jobs" },
    ],
  },
  {
    label: t("navbar.updates"),
    items: [{ label: t("navbar.newsFeed"), to: "/news" }],
  },
];

const getJobseekerMobileMenuSections = (t) =>
  getJobseekerMenuGroups(t).map((group) =>
    group.label === t("navbar.overview")
      ? { ...group, items: [...group.items, { label: t("navbar.myProfile"), to: "/profile" }] }
      : group
  );

const getInitials = (name) => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const UserAvatar = ({ user }) => {
  const src = user?.profileImage ? resolveAssetUrl(user.profileImage) : "";
  return (
    <span className="user-avatar-circle">
      {src ? <img src={src} alt="" /> : getInitials(user?.name)}
    </span>
  );
};

// Notifications + Messages, pinned to the top of admin/superadmin's "System
// & Logs" group so they're always visible instead of buried at the bottom of
// a long grouped menu. `variant: "desktop"` matches the styling of the
// bottom-of-list links other roles get; `variant: "mobile"` matches the
// plain-link styling the mobile panel's other submenu items already use
// (the panel applies box styling via a parent descendant selector).
const SystemLogsQuickLinks = ({ t, isActiveLink, unreadCount, unreadNotifications, variant, onLinkClick }) => {
  const linkClassName = (active) => {
    if (variant === "mobile") return active ? "is-active" : "";
    return active ? "messages-link is-active" : "messages-link";
  };

  return (
    <>
      <Link
        to="/messages"
        className={linkClassName(isActiveLink("/messages"))}
        onClick={onLinkClick}
      >
        <FaEnvelope className="nav-link-icon" aria-hidden="true" />
        <span>{t("navbar.messages")}</span>
        {unreadCount > 0 && (
          <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </Link>
      <Link
        to="/notifications"
        className={linkClassName(isActiveLink("/notifications"))}
        onClick={onLinkClick}
      >
        <FaBell className="nav-link-icon" aria-hidden="true" />
        <span>{t("navbar.notifications")}</span>
        {unreadNotifications > 0 && (
          <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
        )}
      </Link>
    </>
  );
};

export default function Navbar() {
  const { t } = useTranslation();
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const { socket, isConnected } = useSocket();
  const userRole = normalizeRole(user?.role);
  const isLoggedIn = Boolean(user);
  const loggedInMenuItems = getLoggedInMenuItems(userRole, t);
  const isAdminRole = userRole === "admin" || userRole === "superadmin";
  const showNotificationsTopAction = true;
  // Job seeker / employer keep the plain bottom-of-list links. Admin /
  // superadmin instead get Notifications + Messages pinned to the top of
  // their "System & Logs" group (see SYSTEM_LOGS_LABEL below) — those two
  // pages need to always be reachable, and burying them at the very bottom
  // of a long, grouped menu undersold that. Previously they were excluded
  // here entirely on the assumption the icon row (above) covered them, but
  // that row is hidden by CSS above 900px width, so on desktop they had no
  // way to reach either page at all.
  const showNotificationsSidebarLink = !isAdminRole;
  const showMessagesSidebarLink = !isAdminRole;

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState(null);

  const jobseekerMenuGroups = getJobseekerMenuGroups(t);
  const jobseekerMobileMenuSections = getJobseekerMobileMenuSections(t);
  // Settings is dropped from the mobile list because the top bar already has a
  // gear-icon shortcut to it for every role. Profile has no such shortcut on
  // mobile (the sidebar's profile pill is desktop-only), so it must stay here
  // or employer/admin/superadmin users have no way at all to reach it on mobile.
  const mobileMenuItems = userRole === "jobseeker"
    ? jobseekerMobileMenuSections
    : loggedInMenuItems.filter((item) => item.to !== "/settings");

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    setIsMobileMenuOpen(false);
    logout();
    navigate("/login");
  };

  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!user) {
        setUnreadCount(0);
        return;
      }

      try {
        const { data } = await messageAPI.getUnreadCount();
        setUnreadCount(Number(data?.count || 0));
      } catch {
        setUnreadCount(0);
      }
    };

    fetchUnreadCount();
  }, [user, location.pathname]);

  useEffect(() => {
    const fetchUnreadNotifications = async () => {
      if (!user) {
        setUnreadNotifications(0);
        return;
      }

      try {
        const { data } = await notificationAPI.getUnreadCount();
        setUnreadNotifications(Number(data?.count || 0));
      } catch {
        setUnreadNotifications(0);
      }
    };

    fetchUnreadNotifications();
  }, [user]);

  useEffect(() => {
    if (!socket || !isConnected || !user) return;

    const currentUserId = String(user._id || user.id);

    const handleReceiveMessage = (message) => {
      const senderId = String(message?.sender?._id || message?.sender || "");
      if (!senderId || senderId === currentUserId) return;
      if (location.pathname === "/messages") return;
      setUnreadCount((prev) => prev + 1);
    };

    const handleNewNotification = (incoming) => {
      if (incoming?.isRead) return;
      setUnreadNotifications((prev) => prev + 1);
    };

    const handleNotificationsAllRead = () => setUnreadNotifications(0);

    const handleNotificationUpdated = (incoming) => {
      if (!incoming?.isRead) return;
      setUnreadNotifications((prev) => Math.max(0, prev - 1));
    };

    // A deleted notification might have been unread; re-fetch the count
    // rather than guessing, since the delete event doesn't tell us.
    const handleNotificationDeleted = async () => {
      try {
        const { data } = await notificationAPI.getUnreadCount();
        setUnreadNotifications(Number(data?.count || 0));
      } catch {
        // ignore
      }
    };

    socket.on("receive_message", handleReceiveMessage);
    socket.on("notification:new", handleNewNotification);
    socket.on("notification:all-read", handleNotificationsAllRead);
    socket.on("notification:updated", handleNotificationUpdated);
    socket.on("notification:deleted", handleNotificationDeleted);

    return () => {
      socket.off("receive_message", handleReceiveMessage);
      socket.off("notification:new", handleNewNotification);
      socket.off("notification:all-read", handleNotificationsAllRead);
      socket.off("notification:updated", handleNotificationUpdated);
      socket.off("notification:deleted", handleNotificationDeleted);
    };
  }, [socket, isConnected, user, location.pathname]);

  useEffect(() => {
    if (!user) setShowLogoutModal(false);
  }, [user]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const isActiveLink = (to) => {
    const path = to.split("#")[0];

    if (to === "/profile") return location.pathname.startsWith("/profile");
    if (to === "/news") return location.pathname === "/news" || location.pathname.startsWith("/news/");
    if (to === "/employer") return location.pathname === "/employer" || location.pathname === "/employer-dashboard";
    if (to === "/dashboard") return location.pathname === "/dashboard";
    if (to === "/admin") return location.pathname === "/admin";
    if (path === "/admin/news") return location.pathname === "/admin/news";
    if (path === "/admin/news/create") return location.pathname === "/admin/news/create" || location.pathname.startsWith("/admin/news/create/");

    return location.pathname === path;
  };

  useEffect(() => {
    const activeSubmenuItem = loggedInMenuItems.find(
      (item) =>
        item.submenu &&
        item.submenu.some((subitem) => isActiveLink(subitem.to))
    );

    if (activeSubmenuItem) {
      setOpenSubmenu(activeSubmenuItem.label);
      return;
    }

    setOpenSubmenu(null);
  }, [location.pathname, loggedInMenuItems, isActiveLink]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && !user) {
        setIsMobileMenuOpen(false);
        setOpenSubmenu(null);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [user]);

  const openLogoutModal = () => {
    setIsMobileMenuOpen(false);
    setOpenSubmenu(null);
    setShowLogoutModal(true);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    setOpenSubmenu(null);
  };

  const toggleMobileMenu = () => {
    if (isMobileMenuOpen) {
      closeMobileMenu();
      return;
    }

    const activeGroup = loggedInMenuItems.find(
      (item) => item.submenu && item.submenu.some((subitem) => isActiveLink(subitem.to))
    );

    setOpenSubmenu(activeGroup?.label ?? null);
    setIsMobileMenuOpen(true);
  };

  // Props for <SystemLogsQuickLinks> — pinned to the top of admin/superadmin's
  // "System & Logs" group (see getLoggedInMenuItems) instead of the plain
  // bottom-of-list placement job seekers/employers get.
  const quickLinkProps = { t, isActiveLink, unreadCount, unreadNotifications, variant: "desktop" };
  const mobileQuickLinkProps = { ...quickLinkProps, variant: "mobile", onLinkClick: closeMobileMenu };

  const isSetupRoute = SETUP_PATHS.has(location.pathname);

  useEffect(() => {
    const bodyClass = "app-with-sidebar";
    if (isLoggedIn && !isSetupRoute) document.body.classList.add(bodyClass);
    else document.body.classList.remove(bodyClass);
    return () => document.body.classList.remove(bodyClass);
  }, [isLoggedIn, isSetupRoute]);

  // Prevents the page behind the mobile menu overlay from scrolling while
  // it's open (matches the lock ImageEditorModal.jsx/FeedbackProvider.jsx
  // already use for their own overlays).
  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  // On setup / onboarding flows the page supplies its own step rail, so the
  // app sidebar is collapsed away entirely (same behaviour as the applicant
  // detail setup).
  if (isLoggedIn && isSetupRoute) return null;

  if (isLoggedIn) {
    return (
      <nav className="navbar navbar--auth-sidebar">
        <div className="auth-sidebar-top">
          <Link to={getDefaultRouteByRole(userRole)} className="nav-logo-section auth-sidebar-logo">
            <div className="nav-logo-icon">
              <img src={pesoLogo} alt="PESO Marinduque Logo" />
            </div>
            <span className="nav-logo-text">{t("common.appName")}</span>
          </Link>

          <div className="auth-sidebar-actions">
            <Link to="/messages" className="auth-sidebar-action" aria-label={t("navbar.messages")}>
              <FaEnvelope />
            </Link>
            {showNotificationsTopAction && (
              <Link to="/notifications" className="auth-sidebar-action" aria-label={t("navbar.notifications")}>
                <FaBell />
                {unreadNotifications > 0 && (
                  <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                )}
              </Link>
            )}
            <Link to="/settings" className="auth-sidebar-action" aria-label={t("navbar.settings")}>
              <FaCog />
            </Link>
            <button
              type="button"
              className="mobile-menu-toggle mobile-menu-toggle--auth"
              onClick={toggleMobileMenu}
              aria-label={isMobileMenuOpen ? t("navbar.closeNav") : t("navbar.openNav")}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-nav-panel"
            >
              {isMobileMenuOpen ? <FaTimes /> : <FaBars />}
            </button>
          </div>
        </div>

        {userRole === "superadmin" ? (
          <div className="auth-sidebar-role">
            <span className="auth-sidebar-role-badge">{t("navbar.saSystemAdmin")}</span>
          </div>
        ) : (
          <div className="auth-sidebar-profile">
            <button type="button" className="user-pill-button" onClick={() => navigate("/profile")}>
              <span className="user-name">
                <UserAvatar user={user} />
                {user?.name}
              </span>
            </button>
          </div>
        )}

        <div className="auth-sidebar-nav" aria-label="Authenticated navigation">
          {userRole === "jobseeker" ? (
            <>
              {jobseekerMenuGroups.map((group) => (
                <div key={group.label} className="nav-section-group">
                  <div className="nav-section-label">{group.label}</div>
                  {group.items.map((item) => (
                    <Link
                      key={`${group.label}-${item.to}`}
                      to={item.to}
                      className={isActiveLink(item.to) ? "nav-section-link is-active" : "nav-section-link"}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}

              <Link to="/profile" className={isActiveLink("/profile") ? "nav-standalone-link is-active" : "nav-standalone-link"}>
                {t("navbar.myProfile")}
              </Link>
              <Link to="/settings" className={isActiveLink("/settings") ? "nav-standalone-link is-active" : "nav-standalone-link"}>
                {t("navbar.settings")}
              </Link>
            </>
          ) : (
            loggedInMenuItems.map((item) => {
              if (item.submenu) {
                const isSystemLogsGroup = isAdminRole && item.label === t("navbar.systemLogs");
                return (
                  <div key={item.label} className="nav-section-group">
                    <div className="nav-section-label">{item.label}</div>
                    {isSystemLogsGroup && <SystemLogsQuickLinks {...quickLinkProps} />}
                    {item.submenu.map((subitem) => (
                      <Link
                        key={`${item.label}-${subitem.to}`}
                        to={subitem.to}
                        className={isActiveLink(subitem.to) ? "nav-section-link is-active" : "nav-section-link"}
                      >
                        {subitem.label}
                      </Link>
                    ))}
                  </div>
                );
              }

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={isActiveLink(item.to) ? "nav-standalone-link is-active" : "nav-standalone-link"}
                >
                  {item.label}
                </Link>
              );
            })
          )}

          {showMessagesSidebarLink && (
            <Link to="/messages" className={isActiveLink("/messages") ? "messages-link is-active" : "messages-link"}>
              <FaEnvelope className="nav-link-icon" aria-hidden="true" />
              <span>{t("navbar.messages")}</span>
              {unreadCount > 0 && (
                <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
              )}
            </Link>
          )}

          {showNotificationsSidebarLink && (
            <Link to="/notifications" className={isActiveLink("/notifications") ? "messages-link is-active" : "messages-link"}>
              <FaBell className="nav-link-icon" aria-hidden="true" />
              <span>{t("navbar.notifications")}</span>
              {unreadNotifications > 0 && (
                <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
              )}
            </Link>
          )}
        </div>

        <button className="logout-btn auth-sidebar-logout" onClick={openLogoutModal}>
          {t("common.logout")}
        </button>

        {/* Mobile menu panel */}
        {isMobileMenuOpen && (
          <div className="mobile-menu-overlay" onClick={closeMobileMenu}>
            <aside
              id="mobile-nav-panel"
              className="mobile-menu-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <Link to={getDefaultRouteByRole(userRole)} className="mobile-menu-brand" onClick={closeMobileMenu}>
                <span className="mobile-menu-brand-icon">
                  <img src={pesoLogo} alt="PESO Marinduque Logo" />
                </span>
                <span className="mobile-menu-brand-text">{t("common.appName")}</span>
              </Link>

              <div className="mobile-menu-links">
                {userRole === "jobseeker"
                  ? mobileMenuItems.map((section) => (
                    <div key={section.label} className="mobile-nav-section-group">
                      <div className="mobile-nav-section-label">{section.label}</div>
                      {section.items.map((item) => (
                        <Link
                          key={`${section.label}-${item.to}`}
                          to={item.to}
                          className={isActiveLink(item.to) ? "is-active" : ""}
                          onClick={closeMobileMenu}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  ))
                  : mobileMenuItems.map((item) => {
                    if (item.submenu) {
                      const isSystemLogsGroup = isAdminRole && item.label === t("navbar.systemLogs");
                      return (
                        <div key={item.label} className="mobile-nav-section-group">
                          <div className="mobile-nav-section-label">{item.label}</div>
                          {isSystemLogsGroup && <SystemLogsQuickLinks {...mobileQuickLinkProps} />}
                          {item.submenu.map((subitem) => (
                            <Link
                              key={`${item.label}-${subitem.to}`}
                              to={subitem.to}
                              className={isActiveLink(subitem.to) ? "is-active" : ""}
                              onClick={closeMobileMenu}
                            >
                              {subitem.label}
                            </Link>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <Link key={item.to} to={item.to} className={isActiveLink(item.to) ? "is-active" : ""} onClick={closeMobileMenu}>
                        {item.label}
                      </Link>
                    );
                  })}

                {showNotificationsSidebarLink && (
                  <Link to="/notifications" className={isActiveLink("/notifications") ? "messages-link is-active" : "messages-link"} onClick={closeMobileMenu}>
                    <FaBell className="nav-link-icon" aria-hidden="true" />
                    <span>{t("navbar.notifications")}</span>
                    {unreadNotifications > 0 && (
                      <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                    )}
                  </Link>
                )}

                {showMessagesSidebarLink && (
                  <Link to="/messages" className={isActiveLink("/messages") ? "messages-link is-active" : "messages-link"} onClick={closeMobileMenu}>
                    <FaEnvelope className="nav-link-icon" aria-hidden="true" />
                    <span>{t("navbar.messages")}</span>
                    {unreadCount > 0 && (
                      <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                    )}
                  </Link>
                )}

                <button className="logout-btn" onClick={openLogoutModal}>
                  {t("common.logout")}
                </button>
              </div>
            </aside>
          </div>
        )}

        {showLogoutModal && (
          <div className="logout-modal-overlay" onClick={() => setShowLogoutModal(false)}>
            <div className="logout-modal" onClick={(event) => event.stopPropagation()}>
              <h3>{t("common.logoutConfirmTitle")}</h3>
              <p>{t("common.logoutConfirmMessage")}</p>
              <div className="logout-modal-actions">
                <button type="button" className="logout-cancel-btn" onClick={() => setShowLogoutModal(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="logout-confirm-btn" onClick={handleConfirmLogout}>
                  {t("common.logout")}
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>
    );
  }

  // ─── PUBLIC NAVBAR ───
  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to="/" className="nav-logo-section">
          <div className="nav-logo-icon">
            <img src={pesoLogo} alt="PESO Marinduque Logo" />
          </div>
          <span className="nav-logo-text">{t("common.appName")}</span>
        </Link>

        <button
          type="button"
          className="mobile-menu-toggle mobile-menu-toggle--public"
          onClick={toggleMobileMenu}
          aria-label={isMobileMenuOpen ? t("navbar.closeNav") : t("navbar.openNav")}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-nav-panel"
        >
          {isMobileMenuOpen ? <FaTimes /> : <FaBars />}
        </button>

        <div className="nav-links nav-links--public">
          <Link to="/">{t("common.home")}</Link>
          <Link to="/about">{t("common.about")}</Link>
          <Link to="/news">{t("common.news")}</Link>
          <Link to="/#available-jobs">{t("common.availableJobs")}</Link>

          <div className="nav-cta-group">
            <Link to="/register" className="nav-cta-btn nav-cta-btn--secondary" onClick={closeMobileMenu}>
              {t("common.applicant")}
            </Link>
            <Link to="/register-employer" className="nav-cta-btn nav-cta-btn--primary" onClick={closeMobileMenu}>
              {t("common.employer")}
            </Link>
            <Link to="/login" className="nav-cta-btn nav-cta-btn--login" onClick={closeMobileMenu}>
              {t("common.login")}
            </Link>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={closeMobileMenu}>
          <aside
            id="mobile-nav-panel"
            className="mobile-menu-panel mobile-menu-panel--bottom"
            onClick={(event) => event.stopPropagation()}
          >
            <Link to="/" className="mobile-menu-brand" onClick={closeMobileMenu}>
              <span className="mobile-menu-brand-icon">
                <img src={pesoLogo} alt="PESO Marinduque Logo" />
              </span>
              <span className="mobile-menu-brand-text">{t("common.appName")}</span>
            </Link>

            <div className="mobile-menu-links">
              <Link to="/" onClick={closeMobileMenu}>{t("common.home")}</Link>
              <Link to="/about" onClick={closeMobileMenu}>{t("common.about")}</Link>
              <Link to="/news" onClick={closeMobileMenu}>{t("common.news")}</Link>
              <Link to="/#available-jobs" onClick={closeMobileMenu}>{t("common.availableJobs")}</Link>
            </div>

            <div className="mobile-register-section">
              <div className="mobile-register-label">{t("common.joinAs")}</div>
              <div className="mobile-register-buttons">
                <Link to="/register" onClick={closeMobileMenu} className="mobile-register-link">
                  {t("common.applicant")}
                </Link>
                <Link to="/register-employer" onClick={closeMobileMenu} className="mobile-register-link mobile-register-link--employer">
                  {t("common.employer")}
                </Link>
                <Link to="/login" onClick={closeMobileMenu} className="mobile-register-link mobile-register-link--login">
                  {t("common.login")}
                </Link>
              </div>
            </div>
          </aside>
        </div>
      )}
    </nav>
  );
}