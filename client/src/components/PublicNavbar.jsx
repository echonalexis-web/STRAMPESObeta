import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowRight, FaBars, FaBuilding, FaChevronDown, FaRegUser, FaTimes } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";
import "@fontsource/plus-jakarta-sans/800.css";
import "../styles/public-navbar.css";

export default function PublicNavbar() {
  const { t } = useTranslation();
  const { pathname, hash } = useLocation();
  const [openPanel, setOpenPanel] = useState(null);
  const navRef = useRef(null);
  const registerRef = useRef(null);
  const registerButtonRef = useRef(null);
  const mobileButtonRef = useRef(null);
  const mobilePanelRef = useRef(null);
  const brandRef = useRef(null);

  const closePanels = () => setOpenPanel(null);
  const links = [
    { to: "/", label: t("common.home"), active: pathname === "/" && hash !== "#available-jobs" },
    { to: "/about", label: t("common.about"), active: pathname === "/about" },
    { to: "/news", label: t("common.news"), active: pathname === "/news" || pathname.startsWith("/news/") },
    { to: "/#available-jobs", label: t("common.availableJobs"), active: pathname === "/" && hash === "#available-jobs" },
  ];

  // These are navigation disclosures, not application menus: Tab follows normal
  // links, Escape restores the trigger, and leaving the disclosure dismisses it.
  useEffect(() => {
    if (!openPanel) return undefined;
    const boundary = openPanel === "register" ? registerRef.current : navRef.current;
    const dismissOutside = (event) => {
      if (!boundary?.contains(event.target)) setOpenPanel(null);
    };
    const dismissWithEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenPanel(null);
      const trigger = openPanel === "register" ? registerButtonRef : mobileButtonRef;
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [openPanel]);

  useEffect(() => {
    // Keep this in sync with public-navbar.css; no shared sidebar breakpoint.
    const desktop = window.matchMedia("(min-width: 1101px)");
    const onBreakpointChange = () => {
      const focused = document.activeElement;
      if (desktop.matches && (mobilePanelRef.current?.contains(focused) || focused === mobileButtonRef.current)) {
        brandRef.current?.focus();
      } else if (!desktop.matches && navRef.current?.querySelector(".public-nav-desktop")?.contains(focused)) {
        mobileButtonRef.current?.focus();
      }
      setOpenPanel(null);
    };
    desktop.addEventListener("change", onBreakpointChange);
    return () => desktop.removeEventListener("change", onBreakpointChange);
  }, []);

  const renderLinks = () => links.map(({ to, label, active }) => (
    <Link key={to} to={to} className="public-nav-link" aria-current={active ? "page" : undefined} onClick={closePanels}>
      {label}
    </Link>
  ));

  const renderRegistrationChoices = () => [
    { to: "/register", icon: <FaRegUser aria-hidden="true" />, title: t("publicNavbar.applicant"), description: t("publicNavbar.applicantDescription") },
    { to: "/register-employer", icon: <FaBuilding aria-hidden="true" />, title: t("publicNavbar.employer"), description: t("publicNavbar.employerDescription") },
  ].map(({ to, icon, title, description }) => (
    <Link key={to} to={to} className="public-nav-choice" aria-current={pathname === to ? "page" : undefined} onClick={closePanels}>
      <span className="public-nav-choice-icon">{icon}</span>
      <span className="public-nav-choice-text"><strong>{title}</strong><small>{description}</small></span>
      <FaArrowRight className="public-nav-choice-arrow" aria-hidden="true" />
    </Link>
  ));

  return (
    <nav className="public-navbar" ref={navRef} aria-label={t("publicNavbar.navigation")}>
      <div className="public-nav-inner">
        <Link to="/" className="public-nav-brand" ref={brandRef} onClick={closePanels}>
          <img src={pesoLogo} alt="" width="46" height="46" />
          <span><strong>{t("common.appName")}</strong><small>Marinduque</small></span>
        </Link>

        <div className="public-nav-desktop">
          <div className="public-nav-links">{renderLinks()}</div>
          <div className="public-nav-actions">
            <Link to="/login" className="public-nav-button" aria-current={pathname === "/login" ? "page" : undefined} onClick={closePanels}>
              {t("publicNavbar.login")}
            </Link>
            <div className="public-nav-register" ref={registerRef}>
              <button type="button" className="public-nav-button public-nav-button--gold" ref={registerButtonRef}
                aria-expanded={openPanel === "register"} aria-controls="public-registration-options"
                onClick={() => setOpenPanel(openPanel === "register" ? null : "register")}>
                {t("publicNavbar.register")} <FaChevronDown aria-hidden="true" />
              </button>
              <div id="public-registration-options" className="public-nav-dropdown" hidden={openPanel !== "register"}>
                <p className="public-nav-caption">{t("publicNavbar.createAccount")}</p>
                {renderRegistrationChoices()}
              </div>
            </div>
          </div>
        </div>

        <button type="button" className="public-nav-toggle" ref={mobileButtonRef}
          aria-expanded={openPanel === "mobile"} aria-controls="public-mobile-navigation"
          aria-label={openPanel === "mobile" ? t("navbar.closeNav") : t("navbar.openNav")}
          onClick={() => setOpenPanel(openPanel === "mobile" ? null : "mobile")}>
          {openPanel === "mobile" ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
        </button>
      </div>

      <div id="public-mobile-navigation" className="public-nav-mobile" ref={mobilePanelRef} hidden={openPanel !== "mobile"}>
        <div className="public-nav-mobile-links">{renderLinks()}</div>
        <div className="public-nav-mobile-auth">
          <Link to="/login" className="public-nav-button public-nav-button--green" onClick={closePanels}>
            {t("publicNavbar.loginAccount")}
          </Link>
          <p className="public-nav-caption">{t("publicNavbar.newHere")}</p>
          {renderRegistrationChoices()}
        </div>
      </div>
    </nav>
  );
}
