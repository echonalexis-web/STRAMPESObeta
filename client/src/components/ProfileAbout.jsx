import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaMapMarkerAlt, FaPlus } from "react-icons/fa";
import useMediaQuery from "../hooks/useMediaQuery";
import { aboutModel } from "../utils/profileAbout";
import "../styles/profile-about.css";

// Phones and small tablets: the bio is clamped to five lines with Show more.
const NARROW_QUERY = "(max-width: 768px)";

// The body of the About card, used by the owner's profile page and by the short view
// other people get. It shows only what it is given: the server decides what each viewer
// receives. `isOwner` only turns an empty part into an "Add ..." prompt.
//
//   bio        the person's own text, shown as written
//   positions  desired job positions (a list)
//   status     the job search status as stored, e.g. "Actively Looking"
//   address    the address text this viewer may see
//   locations  preferred work locations (a list)
//   editHref   where the owner's "Add ..." prompts go: { bio, positions, status, address, locations }
export default function ProfileAbout({ bio, positions, status, address, locations, isOwner = false, editHref = {} }) {
  const { t } = useTranslation();
  const model = aboutModel({ bio, positions, status, address, locations, isOwner });
  const narrow = useMediaQuery(NARROW_QUERY);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bioRef = useRef(null);
  const bioId = useId();

  const clamped = narrow && !expanded;
  // Does the clamped bio actually hide text? Measured on resize, so the button
  // only appears when there is something more to show.
  useEffect(() => {
    const el = bioRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      setOverflows(el.scrollHeight - el.clientHeight > 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [model.bio.text, clamped]);

  const addPrompt = (key, label) => (
    <Link className="pa-add" to={editHref[key] || "/profile/edit"}>
      <FaPlus aria-hidden="true" /> {label}
    </Link>
  );

  const renderColumn = (col) => {
    const filled = col.state === "filled";
    switch (col.key) {
      case "positions":
        return (
          <>
            <h3 className="pa-label">{t("profileAbout.positionsTitle")}</h3>
            {filled ? (
              <ul className="pa-chips">
                {model.positions.map((position) => (
                  <li key={position} className="pa-chip">{position}</li>
                ))}
              </ul>
            ) : addPrompt("positions", t("profileAbout.addPositions"))}
          </>
        );
      case "status":
        return (
          <>
            <h3 className="pa-label">{t("profileAbout.statusTitle")}</h3>
            {filled ? (
              <p className="pa-status rd2-status"><i className="rd2-dot" aria-hidden="true" />{model.status}</p>
            ) : addPrompt("status", t("profileAbout.addStatus"))}
          </>
        );
      case "address":
        return (
          <>
            <h3 className="pa-label">{t("profileAbout.addressTitle")}</h3>
            {filled ? (
              <p className="pa-address"><FaMapMarkerAlt aria-hidden="true" /> <span>{model.address}</span></p>
            ) : addPrompt("address", t("profileAbout.addAddress"))}
          </>
        );
      default:
        return (
          <>
            <h3 className="pa-label">{t("profileAbout.locationsTitle")}</h3>
            {filled ? (
              <ul className="pa-chips pa-chips--outline">
                {model.locations.map((place) => (
                  <li key={place} className="pa-chip">{place}</li>
                ))}
              </ul>
            ) : addPrompt("locations", t("profileAbout.addLocations"))}
          </>
        );
    }
  };

  const renderRow = (cols) =>
    cols.length === 0 ? null : (
      <>
        <hr className="pa-divider" />
        <div className={`pa-row${cols.length === 1 ? " pa-row--single" : ""}`}>
          {cols.map((col) => (
            <div key={col.key} className="pa-col">{renderColumn(col)}</div>
          ))}
        </div>
      </>
    );

  return (
    <div className="pa">
      {model.bio.state !== "absent" ? (
        <div className="pa-bio">
          {model.bio.state === "filled" ? (
            <>
              <p id={bioId} ref={bioRef} className={`pa-bio__text${clamped ? " is-clamped" : ""}`}>{model.bio.text}</p>
              {narrow && (overflows || expanded) ? (
                <button
                  type="button"
                  className="pa-more"
                  aria-expanded={expanded}
                  aria-controls={bioId}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t("profileAbout.showLess") : t("profileAbout.showMore")}
                </button>
              ) : null}
            </>
          ) : addPrompt("bio", t("profileAbout.addBio"))}
        </div>
      ) : null}
      {renderRow(model.rowB)}
      {renderRow(model.rowC)}
    </div>
  );
}
