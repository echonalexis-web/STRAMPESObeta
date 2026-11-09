import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import ProfileHoverCard from "./ProfileHoverCard";
import { activateCard, createHoverController, deactivateCard, HOVER_QUERY, supportsHoverCards } from "../utils/profileSummaryCache";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const PROFILE_ROLES = ["jobseeker", "employee", "resident", "employer"];

// Tracks whether this device has a fine hovering pointer; re-evaluated on change.
const useHoverCapability = () => {
  const [capable, setCapable] = useState(() => supportsHoverCards());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(HOVER_QUERY);
    const update = () => setCapable(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return capable;
};

// A link to a person's profile that shows the hover card on pointer devices
// (COVER_PHOTO_PLAN.md section 18). Wrap the name, or an avatar with `decorative`.
//   userId      the person's account id
//   role        optional; staff roles never get a link or a card
//   decorative  for an avatar that sits next to the named link: not focusable, hidden from screen readers
// Signed out, an invalid id or a staff account render the children unchanged.
export default function ProfileLink({ userId, role, children, className, decorative = false, to }) {
  const { user } = useContext(AuthContext) || {};
  const capable = useHoverCapability();
  const anchorRef = useRef(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  const eligible = Boolean(user) && OBJECT_ID.test(String(userId || "")) && (!role || PROFILE_ROLES.includes(role));
  const ownId = String(user?._id || user?.id || "");
  const target = to || (String(userId) === ownId ? "/profile" : `/people/${userId}`);

  const hover = useMemo(() => {
    const handle = {};
    const close = () => handle.controller.closeNow();
    handle.controller = createHoverController({
      onOpen: () => {
        activateCard(close);
        setOpen(true);
      },
      onClose: () => {
        deactivateCard(close);
        setOpen(false);
      },
    });
    return handle.controller;
  }, []);

  // Escape closes (and so cancels any request); so does leaving the page.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") hover.closeNow();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hover]);
  useEffect(() => () => hover.closeNow(), [hover]);

  if (!eligible) return children;

  const cardEnabled = capable;
  const props = cardEnabled
    ? {
        onMouseEnter: () => hover.enter(userId),
        onMouseLeave: () => hover.leave(),
        onFocus: () => hover.focus(userId),
        onBlur: () => hover.leave(),
      }
    : {};

  return (
    <>
      <Link
        ref={anchorRef}
        to={target}
        className={className}
        {...(decorative ? { tabIndex: -1, "aria-hidden": true } : cardEnabled ? { "aria-haspopup": "dialog", "aria-expanded": open } : {})}
        {...props}
      >
        {children}
      </Link>
      {open && cardEnabled ? (
        <ProfileHoverCard
          userId={userId}
          anchorRef={anchorRef}
          to={target}
          titleId={titleId}
          onPointerEnter={() => hover.cardEnter()}
          onPointerLeave={() => hover.cardLeave()}
        />
      ) : null}
    </>
  );
}
