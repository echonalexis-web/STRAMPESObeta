import { useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaEnvelope, FaUserCircle, FaChevronDown, FaBars, FaTimes } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { messageAPI } from "../services/api";
import { useSocket } from "../context/SocketContext";
import "../styles/navbar.css";
import pesoLogo from "../assets/images/peso-logo.png";

const normalizeRole = (role) => (role === "employee" || role === "jobseeker" ? "resident" : role);

const getLoggedInMenuItems = (userRole) => {
  if (userRole === "admin") {
    return [{ label: "Admin Dashboard", to: "/admin" }];
  }

  if (userRole === "employer") {
    return [
      { label: "Employer Dashboard", to: "/employer" },
      { label: "Post Vacancy", to: "/post-job" },
    ];
  }

  return [
    { label: "My Dashboard", to: "/dashboard" },
    { label: "Browse Jobs", to: "/jobs" },
  ];
};

const getDefaultRouteByRole = (role) => {
  if (role === "admin") return "/admin";
  if (role === "employer") return "/employer";
  return "/dashboard";
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
  const [isRegisterDropdownOpen, setIsRegisterDropdownOpen] = useState(false);

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
    // Only run if socket exists and is connected
    if (!socket || !isConnected || !user) return;

    const currentUserId = String(user._id || user.id);

    const handleReceiveMessage = (message) => {
      const senderId = String(message?.sender?._id || message?.sender || "");
      if (!senderId || senderId === currentUserId) return;

      if (location.pathname === "/messages") {
        return;
      }

      setUnreadCount((prev) => prev + 1);
    };

    socket.on("receive_message", handleReceiveMessage);

    return () => {
      if (socket) {
        socket.off("receive_message", handleReceiveMessage);
      }
    };
  }, [socket, isConnected, user, location.pathname]);

  useEffect(() => {
    if (!user) {
      setShowLogoutModal(false);
    }
  }, [user]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsRegisterDropdownOpen(false);
  }, [location.pathname]);

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

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleRegisterClick = () => {
    setIsRegisterDropdownOpen(!isRegisterDropdownOpen);
  };

  const closeRegisterDropdown = () => {
    setIsRegisterDropdownOpen(false);
  };

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to={isLoggedIn ? getDefaultRouteByRole(userRole) : "/"} className="nav-logo-section">
          <div className="nav-logo-icon">
            <img src={pesoLogo} alt="PESO Marinduque Logo" />
          </div>
          <span className="nav-logo-text">STRAM PESO</span>
        </Link>

        {isLoggedIn ? (
          <div className="nav-actions">
            <button type="button" className="user-pill-button" onClick={() => navigate("/profile")}> 
              <span className="user-name">
                <FaUserCircle className="user-pill-icon" aria-hidden="true" />
                {user.name}
              </span>
            </button>

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
        ) : (
          <>
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
              <Link to="/#available-jobs">Available Jobs</Link>
              <Link to="/login">Login</Link>
              
              {/* Register Dropdown */}
              <div className="register-dropdown">
                <button 
                  type="button" 
                  className="register-dropdown-btn"
                  onClick={handleRegisterClick}
                  onMouseEnter={() => setIsRegisterDropdownOpen(true)}
                  onMouseLeave={closeRegisterDropdown}
                >
                  Register <FaChevronDown className={`dropdown-arrow ${isRegisterDropdownOpen ? 'rotate' : ''}`} />
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
          </>
        )}
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
              {(!isLoggedIn || userRole !== "admin") && (
                <Link to="/" onClick={closeMobileMenu}>Home</Link>
              )}

              {isLoggedIn ? (
                <>
                  <button
                    type="button"
                    className="user-pill-button"
                    onClick={() => {
                      navigate("/profile");
                      closeMobileMenu();
                    }}
                  >
                    <span className="user-name">
                      <FaUserCircle className="user-pill-icon" aria-hidden="true" />
                      {user.name}
                    </span>
                  </button>

                  {loggedInMenuItems.map((item) => (
                    <Link key={item.to} to={item.to} onClick={closeMobileMenu}>
                      {item.label}
                    </Link>
                  ))}

                  <Link to="/messages" className="messages-link" onClick={closeMobileMenu}>
                    <FaEnvelope className="nav-link-icon" aria-hidden="true" />
                    <span>Messages</span>
                    {unreadCount > 0 && (
                      <span className="user-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                    )}
                  </Link>

                  <button className="logout-btn" onClick={openLogoutModal}>
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link to="/#available-jobs" onClick={closeMobileMenu}>Available Jobs</Link>
                  <Link to="/login" onClick={closeMobileMenu}>Login</Link>
                  
                  {/* Mobile Register Section */}
                  <div className="mobile-register-section">
                    <div className="mobile-register-label">Register as:</div>
                    <Link to="/register" onClick={closeMobileMenu} className="mobile-register-link">
                      Applicant
                    </Link>
                    <Link to="/register-employer" onClick={closeMobileMenu} className="mobile-register-link">
                      Employer
                    </Link>
                  </div>
                </>
              )}
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