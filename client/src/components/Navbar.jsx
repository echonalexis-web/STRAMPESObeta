import { useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FaEnvelope,
  FaUserCircle,
  FaBars,
  FaTimes,
  FaBell,
  FaCog,
  FaUserShield,
  FaTachometerAlt,
  FaChartBar,
  FaUsersCog,
  FaExclamationCircle,
  FaBuilding,
  FaBriefcase,
  FaHistory,
  FaNewspaper,
  FaBullhorn,
  FaGraduationCap,
  FaPlusCircle,
  FaFileAlt,
  FaSearch,
  FaSignOutAlt,
  FaClipboardList,
} from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { messageAPI, notificationAPI, resolveAssetUrl } from "../services/api";
import { useSocket } from "../context/SocketContext";
import { useNavbarStylePreference } from "../hooks/useNavbarStylePreference";
import { canViewJobs as canViewJobsAge, isJobVacancyEligibleAge } from "../utils/age";
import "../styles/navbar.css";
import pesoLogo from "../assets/images/peso-logo.png";
import PublicNavbar from "./PublicNavbar";
import NavCollapsibleGroup from "./NavCollapsibleGroup";
import EmployerAvatar from "./EmployerAvatar";

const normalizeRole = (role) => (role === "employee" || role === "resident" ? "jobseeker" : role);

const cx = (...parts) => parts.filter(Boolean).join(" ");

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
      { label: t("navbar.superadminConsole"), to: "/superadmin", icon: <FaUserShield aria-hidden="true" /> },
      {
        label: t("navbar.adminDashboard"),
        submenu: [
          { label: t("navbar.dashboard"), to: "/admin", icon: <FaTachometerAlt aria-hidden="true" /> },
          { label: t("navbar.reportsStatistics"), to: "/admin/reports", icon: <FaChartBar aria-hidden="true" /> },
        ],
      },
      {
        label: t("navbar.userManagement"),
        submenu: [
          { label: t("navbar.userManagement"), to: "/admin/users", icon: <FaUsersCog aria-hidden="true" /> },
          { label: t("navbar.reportsAppeals"), to: "/admin/users/moderation", icon: <FaExclamationCircle aria-hidden="true" /> },
        ],
      },
      {
        label: t("navbar.employmentJobs"),
        submenu: [
          { label: t("navbar.employerVerification"), to: "/admin/verification", icon: <FaBuilding aria-hidden="true" /> },
          { label: t("staffRecovery.queue"), to: "/admin/account-recovery", icon: <FaUsersCog aria-hidden="true" /> },
          { label: t("navbar.jobMonitoring"), to: "/admin/job-monitoring", icon: <FaBriefcase aria-hidden="true" /> },
        ],
      },
      {
        label: t("navbar.systemLogs"),
        submenu: [{ label: t("navbar.auditTrail"), to: "/admin/audit-logs", icon: <FaHistory aria-hidden="true" /> }],
      },
      { label: t("navbar.myProfile"), to: "/profile", icon: <FaUserCircle aria-hidden="true" /> },
      { label: t("navbar.settings"), to: "/settings", icon: <FaCog aria-hidden="true" /> },
    ];
  }

  if (userRole === "admin") {
    // User Management (directory, verification queue, reports & appeals) and the
    // Audit Trail are superadmin-only surfaces — PESO admins no longer see them.
    return [
      {
        label: t("navbar.adminDashboard"),
        submenu: [
          { label: t("navbar.dashboard"), to: "/admin", icon: <FaTachometerAlt aria-hidden="true" /> },
          { label: t("navbar.reportsStatistics"), to: "/admin/reports", icon: <FaChartBar aria-hidden="true" /> },
        ],
      },
      // PESO admins review reports about jobseeker accounts; suspend and ban stay superadmin.
      { label: t("navbar.reviewReports"), to: "/admin/users/moderation", icon: <FaExclamationCircle aria-hidden="true" /> },
      // Find a jobseeker account to reset a password at the counter or unlock sign-in.
      { label: t("navbar.findAccount"), to: "/admin/find-account", icon: <FaUsersCog aria-hidden="true" /> },
      {
        label: t("navbar.newsManagement"),
        submenu: [
          { label: t("navbar.newsFeed"), to: "/admin/news", icon: <FaNewspaper aria-hidden="true" /> },
          { label: t("navbar.postAnnouncement"), to: "/admin/news/create", icon: <FaBullhorn aria-hidden="true" /> },
        ],
      },
      // Collapsible SPES group (postings are managed here, applications monitored there).
      {
        id: "admin-spes",
        label: t("navbar.spesGroup"),
        icon: <FaGraduationCap aria-hidden="true" />,
        children: [
          { label: t("navbar.spesPostings"), to: "/admin/spes/postings", icon: <FaClipboardList aria-hidden="true" /> },
          { label: t("navbar.spesMonitoring"), to: "/admin/spes/monitoring", icon: <FaChartBar aria-hidden="true" /> },
        ],
      },
      { label: t("navbar.employerVerification"), to: "/admin/verification", icon: <FaBuilding aria-hidden="true" /> },
      { label: t("staffRecovery.queue"), to: "/admin/account-recovery", icon: <FaUsersCog aria-hidden="true" /> },
      { label: t("navbar.jobMonitoring"), to: "/admin/job-monitoring", icon: <FaBriefcase aria-hidden="true" /> },
      // No Audit Trail here (superadmin-only) — this group exists so
      // Notifications/Messages have a "System & Logs" home to pin to, same
      // as the superadmin menu above.
      { label: t("navbar.systemLogs"), submenu: [] },
      { label: t("navbar.myProfile"), to: "/profile", icon: <FaUserCircle aria-hidden="true" /> },
      { label: t("navbar.settings"), to: "/settings", icon: <FaCog aria-hidden="true" /> },
    ];
  }

  if (userRole === "employer") {
    return [
      { label: t("navbar.employerDashboard"), to: "/employer", icon: <FaBuilding aria-hidden="true" /> },
      { label: t("navbar.postVacancy"), to: "/post-job", icon: <FaPlusCircle aria-hidden="true" /> },
      { label: t("navbar.newsFeed"), to: "/news", icon: <FaNewspaper aria-hidden="true" /> },
      { label: t("navbar.myProfile"), to: "/profile", icon: <FaUserCircle aria-hidden="true" /> },
      { label: t("navbar.settings"), to: "/settings", icon: <FaCog aria-hidden="true" /> },
    ];
  }

  return [
    {
      label: t("navbar.myDashboard"),
      submenu: [
        { label: t("navbar.dashboard"), to: "/dashboard", icon: <FaTachometerAlt aria-hidden="true" /> },
        { label: t("navbar.yourApplications"), to: "/applications", icon: <FaFileAlt aria-hidden="true" /> },
        { label: t("navbar.mySpes"), to: "/spes/applications", icon: <FaGraduationCap aria-hidden="true" /> },
      ],
    },
    { label: t("navbar.browseJobs"), to: "/jobs", icon: <FaSearch aria-hidden="true" /> },
    { label: t("navbar.newsFeed"), to: "/news", icon: <FaNewspaper aria-hidden="true" /> },
    { label: t("navbar.myProfile"), to: "/profile", icon: <FaUserCircle aria-hidden="true" /> },
    { label: t("navbar.settings"), to: "/settings", icon: <FaCog aria-hidden="true" /> },
  ];
};

const getDefaultRouteByRole = (role) => {
  if (role === "superadmin") return "/superadmin";
  if (role === "admin") return "/admin";
  if (role === "employer") return "/employer";
  return "/dashboard";
};

// 15-17 account holders can browse jobs but not apply to them (they apply to
// SPES instead); 31+ account holders can't submit new SPES applications.
// An unknown dateOfBirth fails closed, leaving just Dashboard + News.
// See server/utils/age.js / client/src/utils/age.js for the matching
// backend-enforced bands.
const getJobseekerMenuGroups = (t, user) => {
  const canViewJobs = canViewJobsAge(user?.dateOfBirth);
  const canApplyJobs = isJobVacancyEligibleAge(user?.dateOfBirth);
  const canSeeSpes = canViewJobs; // 15 and older; 31+ can view postings but not apply

  const careerItems = [];
  if (canApplyJobs) {
    careerItems.push({ label: t("navbar.yourApplications"), to: "/applications", icon: <FaFileAlt aria-hidden="true" /> });
  }
  if (canSeeSpes) {
    careerItems.push({
      id: "my-spes",
      label: t("navbar.mySpesGroup"),
      icon: <FaGraduationCap aria-hidden="true" />,
      children: [
        { label: t("navbar.spesPostings"), to: "/spes/postings", icon: <FaClipboardList aria-hidden="true" /> },
        { label: t("navbar.mySpesApplications"), to: "/spes/applications", icon: <FaFileAlt aria-hidden="true" /> },
      ],
    });
  }
  if (canViewJobs) careerItems.push({ label: t("navbar.browseJobs"), to: "/jobs", icon: <FaSearch aria-hidden="true" /> });

  const groups = [
    {
      label: t("navbar.overview"),
      items: [{ label: t("navbar.dashboard"), to: "/dashboard", icon: <FaTachometerAlt aria-hidden="true" /> }],
    },
  ];
  if (careerItems.length > 0) {
    groups.push({ label: t("navbar.career"), items: careerItems });
  }
  groups.push({
    label: t("navbar.updates"),
    items: [{ label: t("navbar.newsFeed"), to: "/news", icon: <FaNewspaper aria-hidden="true" /> }],
  });
  return groups;
};

const getJobseekerMobileMenuSections = (t, user) =>
  getJobseekerMenuGroups(t, user).map((group) =>
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

// Status line under the name on the sidebar identity card. The employer
// branch mirrors DashboardTopBar.jsx's getPortalContent: "verified" and
// "rejected" are explicit, every other status reads as pending.
const getIdentityStatusKey = (role, user) => {
  if (role === "employer") {
    const status = user?.verificationStatus;
    if (status === "verified") return "shell.identity.employerVerified";
    if (status === "rejected") return "shell.identity.employerRejected";
    return "shell.identity.employerPending";
  }
  if (role === "admin") return "shell.identity.admin";
  return "shell.identity.jobseeker";
};

// Notifications + Messages, pinned to the top of admin/superadmin's "System
// & Logs" group so they're always visible instead of buried at the bottom of
// a long grouped menu. `variant: "desktop"` matches the styling of the
// bottom-of-list links other roles get; `variant: "mobile"` matches the
// plain-link styling the mobile panel's other submenu items already use
// (the panel applies box styling via a parent descendant selector).
const SystemLogsQuickLinks = ({
  t,
  isActiveLink,
  unreadCount,
  unreadNotifications,
  variant,
  onLinkClick,
  hideMessagesWide,
  hideNotificationsWide,
}) => {
  const linkClassName = (active, hideWideClass) => {
    if (variant === "mobile") return cx(active ? "is-active" : "", hideWideClass);
    return cx("messages-link", active ? "is-active" : "", hideWideClass);
  };

  return (
    <>
      <Link
        to="/messages"
        className={linkClassName(isActiveLink("/messages"), hideMessagesWide)}
        aria-current={isActiveLink("/messages") ? "page" : undefined}
        onClick={onLinkClick}
        title={t("navbar.messages")}
      >
        <FaEnvelope className="nav-link-icon" aria-hidden="true" />
        <span className="nav-link-text">{t("navbar.messages")}</span>
        {unreadCount > 0 && (
          <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </Link>
      <Link
        to="/notifications"
        className={linkClassName(isActiveLink("/notifications"), hideNotificationsWide)}
        aria-current={isActiveLink("/notifications") ? "page" : undefined}
        onClick={onLinkClick}
        title={t("navbar.notifications")}
      >
        <FaBell className="nav-link-icon" aria-hidden="true" />
        <span className="nav-link-text">{t("navbar.notifications")}</span>
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
  const currentUserId = user?._id || user?.id || null;
  const [navbarStyle, setNavbarStyle] = useNavbarStylePreference(currentUserId);
  const isCompactNav = navbarStyle === "icons";
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

  const mobileToggleRef = useRef(null);
  const mobilePanelRef = useRef(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [menuPath, setMenuPath] = useState(location.pathname);
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setIsMobileMenuOpen(false);
    setShowLogoutModal(false);
  }

  const jobseekerMenuGroups = getJobseekerMenuGroups(t, user);
  const jobseekerMobileMenuSections = getJobseekerMobileMenuSections(t, user);
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


  const isActiveLink = (to) => {
    const path = to.split("#")[0];

    if (to === "/profile") return location.pathname.startsWith("/profile");
    // The Superadmin Console item stays active on every console function page.
    if (to === "/superadmin") return location.pathname === "/superadmin" || location.pathname.startsWith("/superadmin/");
    if (to === "/news") return location.pathname === "/news" || location.pathname.startsWith("/news/");
    if (to === "/employer") return location.pathname === "/employer" || location.pathname === "/employer-dashboard";
    if (to === "/dashboard") return location.pathname === "/dashboard";
    if (to === "/admin") return location.pathname === "/admin";
    if (path === "/spes/postings" || path === "/admin/spes/postings") {
      return location.pathname === path || location.pathname.startsWith(path + "/");
    }
    if (path === "/admin/news") return location.pathname === "/admin/news";
    if (path === "/admin/news/create") return location.pathname === "/admin/news/create" || location.pathname.startsWith("/admin/news/create/");

    return location.pathname === path;
  };


  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && !user) {
        setIsMobileMenuOpen(false);

      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [user]);

  const openLogoutModal = () => {
    setIsMobileMenuOpen(false);

    setShowLogoutModal(true);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);

  };

  const toggleMobileMenu = () => {
    if (isMobileMenuOpen) {
      closeMobileMenu();
      return;
    }


    setIsMobileMenuOpen(true);
  };

  // Above 768px, the globally-mounted DashboardTopBar already has its own
  // Messages/Notifications bells (with preview dropdowns), so the navbar's
  // copies are now redundant there — Messages always hides above that width,
  // Notifications only stays except on the few routes where DashboardTopBar
  // itself is hidden (Settings, Profile, and the Messages page — see
  // DashboardTopBar.jsx's own HIDDEN_PATH_PREFIXES), which would otherwise
  // leave no way at all to reach notifications from those pages above 768px.
  const isNotificationsPinnedRoute =
    location.pathname === "/settings" ||
    location.pathname === "/messages" ||
    location.pathname.startsWith("/profile");
  const hideMessagesWide = "nav-hide-wide";
  const hideNotificationsWide = isNotificationsPinnedRoute ? "" : "nav-hide-wide";

  // Props for <SystemLogsQuickLinks> — pinned to the top of admin/superadmin's
  // "System & Logs" group (see getLoggedInMenuItems) instead of the plain
  // bottom-of-list placement job seekers/employers get.
  const quickLinkProps = {
    t,
    isActiveLink,
    unreadCount,
    unreadNotifications,
    variant: "desktop",
    hideMessagesWide,
    hideNotificationsWide,
  };
  const mobileQuickLinkProps = { ...quickLinkProps, variant: "mobile", onLinkClick: closeMobileMenu };

  const isSetupRoute = SETUP_PATHS.has(location.pathname);

  useEffect(() => {
    const bodyClass = "app-with-sidebar";
    if (isLoggedIn && !isSetupRoute) document.body.classList.add(bodyClass);
    else document.body.classList.remove(bodyClass);
    return () => document.body.classList.remove(bodyClass);
  }, [isLoggedIn, isSetupRoute]);

  // Mirrors the compact sidebar on the page body so its content offset
  // (body.app-with-sidebar's padding-left) shrinks along with the sidebar
  // instead of leaving a leftover gap sized for the full-width rail.
  useEffect(() => {
    const compactClass = "app-sidebar-compact";
    if (isLoggedIn && !isSetupRoute && isCompactNav) document.body.classList.add(compactClass);
    else document.body.classList.remove(compactClass);
    return () => document.body.classList.remove(compactClass);
  }, [isLoggedIn, isSetupRoute, isCompactNav]);

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

  // Drawer a11y (mirrors PublicNavbar's mobile drawer): focus moves into the
  // panel on open, Tab is trapped inside it, Esc closes, focus is restored to
  // the toggle on close, and it auto-closes if the viewport grows into the
  // desktop sidebar layout (keep 901px in sync with navbar.css).
  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;
    const panel = mobilePanelRef.current;
    const toggle = mobileToggleRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll("a[href], button:not([disabled])") || []).filter(
        (el) => el.getClientRects().length > 0
      );
    focusables()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 901px)");
    const onBreakpointChange = () => {
      if (desktop.matches) setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onBreakpointChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onBreakpointChange);
      toggle?.focus();
    };
  }, [isMobileMenuOpen]);

  // On setup / onboarding flows the page supplies its own step rail, so the
  // app sidebar is collapsed away entirely (same behaviour as the applicant
  // detail setup).
  if (isLoggedIn && isSetupRoute) return null;

  if (isLoggedIn) {
    return (
      <nav className={`navbar navbar--auth-sidebar${isCompactNav ? " is-compact" : ""}`}>
        <div className="auth-sidebar-top">
          <Link to={getDefaultRouteByRole(userRole)} className="nav-logo-section auth-sidebar-logo">
            <div className="nav-logo-icon">
              <img src={pesoLogo} alt="PESO Marinduque Logo" />
            </div>
            <span className="nav-logo-text">{t("common.appName")}</span>
          </Link>

          <div className="auth-sidebar-actions">
            <Link to="/messages" className={cx("auth-sidebar-action", hideMessagesWide)} aria-label={t("navbar.messages")}>
              <FaEnvelope aria-hidden="true" />
            </Link>
            {showNotificationsTopAction && (
              <Link to="/notifications" className={cx("auth-sidebar-action", hideNotificationsWide)} aria-label={t("navbar.notifications")}>
                <FaBell aria-hidden="true" />
                {unreadNotifications > 0 && (
                  <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                )}
              </Link>
            )}
            <Link to="/settings" className="auth-sidebar-action" aria-label={t("navbar.settings")}>
              <FaCog aria-hidden="true" />
            </Link>
            <button
              type="button"
              ref={mobileToggleRef}
              className="mobile-menu-toggle mobile-menu-toggle--auth"
              onClick={toggleMobileMenu}
              aria-label={isMobileMenuOpen ? t("navbar.closeNav") : t("navbar.openNav")}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-nav-panel"
            >
              {isMobileMenuOpen ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
            </button>
          </div>
        </div>

        {userRole === "superadmin" ? (
          <div className="auth-sidebar-role">
            <span className="auth-sidebar-role-badge">{t("navbar.saSystemAdmin")}</span>
          </div>
        ) : (
          <div className="auth-sidebar-profile">
            <button
              type="button"
              className="user-pill-button auth-id-card"
              onClick={() => navigate("/profile")}
              title={user?.name}
            >
              <span className="auth-id-avatar">
                {userRole === "employer" ? (
                  <EmployerAvatar employer={user} name={user?.name} className="user-avatar-circle" />
                ) : (
                  <UserAvatar user={user} />
                )}
                {userRole === "employer" && user?.verificationStatus === "verified" && (
                  <span className="auth-id-dot" aria-hidden="true" />
                )}
              </span>
              <span className="nav-link-text auth-id-text">
                <span className="auth-id-name">{user?.name}</span>
                <span className="auth-id-status">{t(getIdentityStatusKey(userRole, user))}</span>
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
                  {group.items.map((item) =>
                    item.children ? (
                      <NavCollapsibleGroup
                        key={item.id}
                        id={item.id}
                        label={item.label}
                        icon={item.icon}
                        items={item.children}
                        isActiveLink={isActiveLink}
                      />
                    ) : (
                      <Link
                        key={`${group.label}-${item.to}`}
                        to={item.to}
                        className={isActiveLink(item.to) ? "nav-section-link is-active" : "nav-section-link"}
                        aria-current={isActiveLink(item.to) ? "page" : undefined}
                        title={item.label}
                      >
                        {item.icon}
                        <span className="nav-link-text">{item.label}</span>
                      </Link>
                    )
                  )}
                </div>
              ))}

              <Link
                to="/profile"
                className={isActiveLink("/profile") ? "nav-standalone-link is-active" : "nav-standalone-link"}
                aria-current={isActiveLink("/profile") ? "page" : undefined}
                title={t("navbar.myProfile")}
              >
                <FaUserCircle aria-hidden="true" />
                <span className="nav-link-text">{t("navbar.myProfile")}</span>
              </Link>
              <Link
                to="/settings"
                className={isActiveLink("/settings") ? "nav-standalone-link is-active" : "nav-standalone-link"}
                aria-current={isActiveLink("/settings") ? "page" : undefined}
                title={t("navbar.settings")}
              >
                <FaCog aria-hidden="true" />
                <span className="nav-link-text">{t("navbar.settings")}</span>
              </Link>
            </>
          ) : (
            loggedInMenuItems.map((item) => {
              if (item.children) {
                return (
                  <div key={item.id} className="nav-section-group">
                    <NavCollapsibleGroup
                      id={item.id}
                      label={item.label}
                      icon={item.icon}
                      items={item.children}
                      isActiveLink={isActiveLink}
                    />
                  </div>
                );
              }
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
                        aria-current={isActiveLink(subitem.to) ? "page" : undefined}
                        title={subitem.label}
                      >
                        {subitem.icon}
                        <span className="nav-link-text">{subitem.label}</span>
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
                  aria-current={isActiveLink(item.to) ? "page" : undefined}
                  title={item.label}
                >
                  {item.icon}
                  <span className="nav-link-text">{item.label}</span>
                </Link>
              );
            })
          )}

          {showMessagesSidebarLink && (
            <Link
              to="/messages"
              className={cx("messages-link", isActiveLink("/messages") && "is-active", hideMessagesWide)}
              aria-current={isActiveLink("/messages") ? "page" : undefined}
              title={t("navbar.messages")}
            >
              <FaEnvelope className="nav-link-icon" aria-hidden="true" />
              <span className="nav-link-text">{t("navbar.messages")}</span>
              {unreadCount > 0 && (
                <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
              )}
            </Link>
          )}

          {showNotificationsSidebarLink && (
            <Link
              to="/notifications"
              className={cx("messages-link", isActiveLink("/notifications") && "is-active", hideNotificationsWide)}
              aria-current={isActiveLink("/notifications") ? "page" : undefined}
              title={t("navbar.notifications")}
            >
              <FaBell className="nav-link-icon" aria-hidden="true" />
              <span className="nav-link-text">{t("navbar.notifications")}</span>
              {unreadNotifications > 0 && (
                <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
              )}
            </Link>
          )}
        </div>

        <button
          type="button"
          className="sidebar-collapse-chip"
          onClick={() => setNavbarStyle(isCompactNav ? "full" : "icons")}
          aria-label={isCompactNav ? t("navbar.expandSidebar") : t("navbar.collapseSidebar")}
          title={isCompactNav ? t("navbar.expandSidebar") : t("navbar.collapseSidebar")}
        >
          <span className="sidebar-collapse-chip__arrow" aria-hidden="true" />
        </button>

        <button className="logout-btn auth-sidebar-logout" onClick={openLogoutModal} title={t("common.logout")}>
          <FaSignOutAlt aria-hidden="true" />
          <span className="nav-link-text">{t("common.logout")}</span>
        </button>

        {/* Mobile menu panel */}
        {isMobileMenuOpen && (
          <div className="mobile-menu-overlay" onClick={closeMobileMenu}>
            <aside
              id="mobile-nav-panel"
              ref={mobilePanelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("common.appName")}
              className="mobile-menu-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <Link to={getDefaultRouteByRole(userRole)} className="mobile-menu-brand" onClick={closeMobileMenu}>
                <span className="mobile-menu-brand-icon">
                  <img src={pesoLogo} alt="PESO Marinduque Logo" />
                </span>
                <span className="mobile-menu-brand-text">{t("common.appName")}</span>
              </Link>
              <button type="button" className="mobile-menu-close" onClick={closeMobileMenu} aria-label={t("navbar.closeNav")}>
                <FaTimes aria-hidden="true" />
              </button>

              <div className="mobile-menu-links">
                {userRole === "jobseeker"
                  ? mobileMenuItems.map((section) => (
                    <div key={section.label} className="mobile-nav-section-group">
                      <div className="mobile-nav-section-label">{section.label}</div>
                      {section.items.map((item) =>
                        item.children ? (
                          <NavCollapsibleGroup
                            key={item.id}
                            id={`m-${item.id}`}
                            label={item.label}
                            items={item.children}
                            isActiveLink={isActiveLink}
                            onNavigate={closeMobileMenu}
                            variant="mobile"
                          />
                        ) : (
                          <Link
                            key={`${section.label}-${item.to}`}
                            to={item.to}
                            className={isActiveLink(item.to) ? "is-active" : ""}
                            aria-current={isActiveLink(item.to) ? "page" : undefined}
                            onClick={closeMobileMenu}
                          >
                            {item.label}
                          </Link>
                        )
                      )}
                    </div>
                  ))
                  : mobileMenuItems.map((item) => {
                    if (item.children) {
                      return (
                        <div key={item.id} className="mobile-nav-section-group">
                          <NavCollapsibleGroup
                            id={`m-${item.id}`}
                            label={item.label}
                            items={item.children}
                            isActiveLink={isActiveLink}
                            onNavigate={closeMobileMenu}
                            variant="mobile"
                          />
                        </div>
                      );
                    }
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
                              aria-current={isActiveLink(subitem.to) ? "page" : undefined}
                              onClick={closeMobileMenu}
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
                        className={isActiveLink(item.to) ? "is-active" : ""}
                        aria-current={isActiveLink(item.to) ? "page" : undefined}
                        onClick={closeMobileMenu}
                      >
                        {item.label}
                      </Link>
                    );
                  })}

                {showNotificationsSidebarLink && (
                  <Link
                    to="/notifications"
                    className={cx("messages-link", isActiveLink("/notifications") && "is-active", hideNotificationsWide)}
                    aria-current={isActiveLink("/notifications") ? "page" : undefined}
                    onClick={closeMobileMenu}
                  >
                    <FaBell className="nav-link-icon" aria-hidden="true" />
                    <span>{t("navbar.notifications")}</span>
                    {unreadNotifications > 0 && (
                      <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                    )}
                  </Link>
                )}

                {showMessagesSidebarLink && (
                  <Link
                    to="/messages"
                    className={cx("messages-link", isActiveLink("/messages") && "is-active", hideMessagesWide)}
                    aria-current={isActiveLink("/messages") ? "page" : undefined}
                    onClick={closeMobileMenu}
                  >
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

  // Remount disclosures on navigation, including hash and browser history changes.
  return <PublicNavbar key={location.key} />;
}
