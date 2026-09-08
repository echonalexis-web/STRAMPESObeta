import { useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaEnvelope, FaUserCircle, FaChevronDown, FaBars, FaTimes, FaBell } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { messageAPI, notificationAPI, resolveAssetUrl } from "../services/api";
import { useSocket } from "../context/SocketContext";
import "../styles/navbar.css";
import pesoLogo from "../assets/images/peso-logo.png";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

// Routes whose page renders its own dedicated setup rail (e.g. the applicant /
// employer detail onboarding). The app sidebar is suppressed on these so it
// doesn't compete with the flow's own step navigator.
const SETUP_PATHS = new Set(["/onboarding"]);

const getLoggedInMenuItems = (userRole) => {
  if (userRole === "admin") {
    return [
      {
        label: "Admin Dashboard",
        submenu: [
          { label: "Dashboard", to: "/admin" },
          { label: "Reports & Statistics", to: "/admin/reports" },
        ],
      },
      {
        label: "News Management",
        submenu: [
          { label: "News Feed", to: "/admin/news" },
          { label: "Post Announcement", to: "/admin/news/create" },
          { label: "SPES Applications", to: "/admin/spes" },
        ],
      },
      {
        label: "User Management",
        submenu: [
          { label: "User Management", to: "/admin/users" },
          { label: "Reports & Appeals", to: "/admin/users/moderation" },
        ],
      },
      { label: "Job Monitoring", to: "/admin/job-monitoring" },
      { label: "Audit Trail", to: "/admin/audit-logs" },
      { label: "My Profile", to: "/profile" },
    ];
  }

  if (userRole === "employer") {
    return [
      { label: "Employer Dashboard", to: "/employer" },
      { label: "Post Vacancy", to: "/post-job" },
      { label: "News Feed", to: "/news" },
      { label: "My Profile", to: "/profile" },
    ];
  }

  return [
    {
      label: "My Dashboard",
      submenu: [
        { label: "Dashboard", to: "/dashboard" },
        { label: "Your Applications", to: "/applications" },
        { label: "My SPES", to: "/spes/applications" },
      ],
    },
    { label: "Browse Jobs", to: "/jobs" },
    { label: "News Feed", to: "/news" },
    { label: "My Profile", to: "/profile" },
  ];
};

const getDefaultRouteByRole = (role) => {
  if (role === "admin") return "/admin";
  if (role === "employer") return "/employer";
  return "/dashboard";
};

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

export default function Navbar() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const { socket, isConnected } = useSocket();
  const userRole = normalizeRole(user?.role);
  const isLoggedIn = Boolean(user);
  const loggedInMenuItems = getLoggedInMenuItems(userRole);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isRegisterDropdownOpen, setIsRegisterDropdownOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [hoveredSubmenu, setHoveredSubmenu] = useState(null);

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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
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
    setIsRegisterDropdownOpen(false);
  }, [location.pathname]);

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

    if (!hoveredSubmenu) {
      setOpenSubmenu(null);
    }
  }, [location.pathname, hoveredSubmenu, loggedInMenuItems]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && !user) {
        setIsMobileMenuOpen(false);
        setIsRegisterDropdownOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [user]);

  const openLogoutModal = () => {
    setIsMobileMenuOpen(false);
    setShowLogoutModal(true);
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const handleRegisterClick = () => setIsRegisterDropdownOpen(!isRegisterDropdownOpen);
  const closeRegisterDropdown = () => setIsRegisterDropdownOpen(false);

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

  const isSubmenuOpen = (label) => openSubmenu === label || hoveredSubmenu === label;

  const isSetupRoute = SETUP_PATHS.has(location.pathname);

  useEffect(() => {
    const bodyClass = "app-with-sidebar";
    if (isLoggedIn && !isSetupRoute) document.body.classList.add(bodyClass);
    else document.body.classList.remove(bodyClass);
    return () => document.body.classList.remove(bodyClass);
  }, [isLoggedIn, isSetupRoute]);

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
            <span className="nav-logo-text">STRAM PESO</span>
          </Link>

          <button
            type="button"
            className="mobile-menu-toggle mobile-menu-toggle--auth"
            onClick={toggleMobileMenu}
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-nav-panel"
          >
            {isMobileMenuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>

        <div className="auth-sidebar-profile">
          <button type="button" className="user-pill-button" onClick={() => navigate("/profile")}>
            <span className="user-name">
              <UserAvatar user={user} />
              {user?.name}
            </span>
          </button>
        </div>

        <div className="auth-sidebar-nav" aria-label="Authenticated navigation">
          {loggedInMenuItems.map((item) => (
            item.submenu ? (
              <div
                key={item.label}
                className="nav-submenu-group"
                onMouseEnter={() => setHoveredSubmenu(item.label)}
                onMouseLeave={() => setHoveredSubmenu(null)}
              >
                <button
                  type="button"
                  className="nav-submenu-toggle"
                  onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
                  onFocus={() => setHoveredSubmenu(item.label)}
                  onBlur={() => setHoveredSubmenu(null)}
                  aria-expanded={isSubmenuOpen(item.label)}
                >
                  {item.label}
                </button>
                <div className={`nav-submenu ${isSubmenuOpen(item.label) ? "is-open" : ""}`}>
                  {item.submenu.map((subitem) => (
                    <Link
                      key={subitem.to}
                      to={subitem.to}
                      className={isActiveLink(subitem.to) ? "is-active" : ""}
                      onClick={() => {
                        setOpenSubmenu(null);
                        setHoveredSubmenu(null);
                      }}
                    >
                      {subitem.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link key={item.to} to={item.to} className={isActiveLink(item.to) ? "is-active" : ""}>
                {item.label}
              </Link>
            )
          ))}

          <Link to="/messages" className={isActiveLink("/messages") ? "messages-link is-active" : "messages-link"}>
            <FaEnvelope className="nav-link-icon" aria-hidden="true" />
            <span>Messages</span>
            {unreadCount > 0 && (
              <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </Link>

          <Link to="/notifications" className={isActiveLink("/notifications") ? "messages-link is-active" : "messages-link"}>
            <FaBell className="nav-link-icon" aria-hidden="true" />
            <span>Notifications</span>
            {unreadNotifications > 0 && (
              <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
            )}
          </Link>
        </div>

        <button className="logout-btn auth-sidebar-logout" onClick={openLogoutModal}>
          Logout
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
                <span className="mobile-menu-brand-text">STRAM PESO</span>
              </Link>

              <div className="mobile-menu-links">
                <button
                  type="button"
                  className="user-pill-button"
                  onClick={() => {
                    navigate("/profile");
                    closeMobileMenu();
                  }}
                >
                  <span className="user-name">
                    <UserAvatar user={user} />
                    {user?.name}
                  </span>
                </button>

                {loggedInMenuItems.map((item) => (
                  item.submenu ? (
                    <div key={item.label} className="mobile-nav-submenu-group">
                      <button
                        type="button"
                        className="mobile-nav-submenu-toggle"
                        onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
                        aria-expanded={isSubmenuOpen(item.label)}
                      >
                        {item.label}
                      </button>
                      {isSubmenuOpen(item.label) && (
                        <div className="mobile-nav-submenu">
                          {item.submenu.map((subitem) => (
                            <Link
                              key={subitem.to}
                              to={subitem.to}
                              className={isActiveLink(subitem.to) ? "is-active" : ""}
                              onClick={closeMobileMenu}
                            >
                              {subitem.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Link key={item.to} to={item.to} className={isActiveLink(item.to) ? "is-active" : ""} onClick={closeMobileMenu}>
                      {item.label}
                    </Link>
                  )
                ))}

                <Link to="/messages" className={isActiveLink("/messages") ? "messages-link is-active" : "messages-link"} onClick={closeMobileMenu}>
                  <FaEnvelope className="nav-link-icon" aria-hidden="true" />
                  <span>Messages</span>
                  {unreadCount > 0 && (
                    <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                  )}
                </Link>

                <Link to="/notifications" className={isActiveLink("/notifications") ? "messages-link is-active" : "messages-link"} onClick={closeMobileMenu}>
                  <FaBell className="nav-link-icon" aria-hidden="true" />
                  <span>Notifications</span>
                  {unreadNotifications > 0 && (
                    <span className="user-unread-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
                  )}
                </Link>

                <button className="logout-btn" onClick={openLogoutModal}>
                  Logout
                </button>
              </div>
            </aside>
          </div>
        )}

        {showLogoutModal && (
          <div className="logout-modal-overlay" onClick={() => setShowLogoutModal(false)}>
            <div className="logout-modal" onClick={(event) => event.stopPropagation()}>
              <h3>Log out of STRAM PESO?</h3>
              <p>You will need to sign in again to access your account.</p>
              <div className="logout-modal-actions">
                <button type="button" className="logout-cancel-btn" onClick={() => setShowLogoutModal(false)}>
                  Cancel
                </button>
                <button type="button" className="logout-confirm-btn" onClick={handleConfirmLogout}>
                  Log Out
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
          <span className="nav-logo-text">STRAM PESO</span>
        </Link>

        <button
          type="button"
          className="mobile-menu-toggle mobile-menu-toggle--public"
          onClick={toggleMobileMenu}
          aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-nav-panel"
        >
          {isMobileMenuOpen ? <FaTimes /> : <FaBars />}
        </button>

        <div className="nav-links nav-links--public">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/news">News</Link>
          <Link to="/#available-jobs">Available Jobs</Link>
          <Link to="/login">Login</Link>

          <div className="register-dropdown">
            <button
              type="button"
              className="register-dropdown-btn"
              onClick={handleRegisterClick}
              onMouseEnter={() => setIsRegisterDropdownOpen(true)}
              onMouseLeave={closeRegisterDropdown}
            >
              Register <FaChevronDown className={`dropdown-arrow ${isRegisterDropdownOpen ? "rotate" : ""}`} />
            </button>
            {isRegisterDropdownOpen && (
              <div
                className="register-dropdown-menu"
                onMouseEnter={() => setIsRegisterDropdownOpen(true)}
                onMouseLeave={closeRegisterDropdown}
              >
                <Link to="/register" onClick={closeMobileMenu}>
                  Register as Applicant
                </Link>
                <Link to="/register-employer" onClick={closeMobileMenu}>
                  Register as Employer
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={closeMobileMenu}>
          <aside
            id="mobile-nav-panel"
            className="mobile-menu-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <Link to="/" className="mobile-menu-brand" onClick={closeMobileMenu}>
              <span className="mobile-menu-brand-icon">
                <img src={pesoLogo} alt="PESO Marinduque Logo" />
              </span>
              <span className="mobile-menu-brand-text">STRAM PESO</span>
            </Link>

            <div className="mobile-menu-links">
              <Link to="/" onClick={closeMobileMenu}>Home</Link>
              <Link to="/about" onClick={closeMobileMenu}>About</Link>
              <Link to="/news" onClick={closeMobileMenu}>News</Link>
              <Link to="/#available-jobs" onClick={closeMobileMenu}>Available Jobs</Link>
              <Link to="/login" onClick={closeMobileMenu}>Login</Link>

              <div className="mobile-register-section">
                <div className="mobile-register-label">Register as:</div>
                <Link to="/register" onClick={closeMobileMenu} className="mobile-register-link">
                  Applicant
                </Link>
                <Link to="/register-employer" onClick={closeMobileMenu} className="mobile-register-link">
                  Employer
                </Link>
              </div>
            </div>
          </aside>
        </div>
      )}
    </nav>
  );
}