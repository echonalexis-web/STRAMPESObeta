import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaCheckCircle } from "react-icons/fa";
import BannerPreview from "./BannerPreview";
import useProfileSummary from "../hooks/useProfileSummary";
import { resolveAssetUrl } from "../services/api";
import { CLASSIC_DEFINITION } from "../utils/bannerStyle";
import "../styles/profile-card.css";

// Small cover strip for the card: the template art, or the small image variant.
function CoverThumb({ cover }) {
  const [failed, setFailed] = useState(false);
  if (cover?.kind === "image" && cover.image && !failed) {
    const { thumbUrl, url, placeholderColor } = cover.image;
    return (
      <div className="pcard__cover" style={placeholderColor ? { background: placeholderColor } : undefined} aria-hidden="true">
        <img src={resolveAssetUrl(thumbUrl || url)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </div>
    );
  }
  if (cover?.kind === "template" && cover.template?.kind === "image") {
    return <BannerPreview template={cover.template} definition={CLASSIC_DEFINITION} height={56} className="pcard__cover" />;
  }
  const definition = cover?.kind === "template" && cover.template?.definition ? cover.template.definition : CLASSIC_DEFINITION;
  return <BannerPreview definition={definition} height={56} className="pcard__cover" />;
}

const initialOf = (name) => (String(name || "?").trim()[0] || "?").toUpperCase();

const MARGIN = 8;

// Hover card for a person (COVER_PHOTO_PLAN.md section 18). Mounted only while open,
// so nothing is fetched or rendered before the open delay; unmounting cancels the
// request. A non-modal dialog in a portal at z-index 1400, placed below the trigger
// and flipped above when it would leave the viewport.
export default function ProfileHoverCard({ userId, anchorRef, to, titleId, onPointerEnter, onPointerLeave }) {
  const { t } = useTranslation();
  const { status, data } = useProfileSummary(userId);
  const cardRef = useRef(null);
  const [position, setPosition] = useState(null);

  // Re-place whenever the content changes size (loading -> ready).
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const rect = anchor.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + MARGIN;
    if (top + height > vh - MARGIN && rect.top - height - MARGIN >= MARGIN) top = rect.top - height - MARGIN;
    top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN));
    const left = Math.max(MARGIN, Math.min(rect.left, vw - width - MARGIN));
    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [anchorRef, status, data]);

  const roleLabel = data?.role ? t(`profileCard.role.${data.role}`) : "";

  return createPortal(
    <div
      ref={cardRef}
      className="pcard"
      role="dialog"
      aria-labelledby={titleId}
      style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      {status === "loading" ? (
        <div className="pcard__body" aria-busy="true">
          <span id={titleId} className="ds-sr-only">
            {t("profileCard.loading")}
          </span>
          <span className="pcard__skeleton pcard__skeleton--cover" />
          <span className="pcard__skeleton pcard__skeleton--line" />
          <span className="pcard__skeleton pcard__skeleton--line pcard__skeleton--short" />
        </div>
      ) : null}

      {status === "unavailable" ? (
        <p id={titleId} className="pcard__note">
          {t("profileCard.unavailable")}
        </p>
      ) : null}

      {status === "error" ? (
        <p id={titleId} className="pcard__note" role="status">
          {t("profileCard.error")}
        </p>
      ) : null}

      {status === "ready" && data ? (
        <>
          <CoverThumb cover={data.cover} />
          <div className="pcard__body">
            <span className={`pcard__avatar${data.role === "employer" ? " pcard__avatar--company" : ""}`} aria-hidden="true">
              {data.avatar ? <img src={resolveAssetUrl(data.avatar)} alt="" /> : initialOf(data.name)}
            </span>
            <div className="pcard__head">
              <strong id={titleId} className="pcard__name">
                {data.name}
              </strong>
              <span className="pcard__role">{roleLabel}</span>
              {data.verified ? (
                <span className="pcard__verified">
                  <FaCheckCircle aria-hidden="true" /> {t("profileCard.verified")}
                </span>
              ) : null}
            </div>
            {data.headline ? <p className="pcard__line">{data.headline}</p> : null}
            {data.location ? <p className="pcard__line pcard__line--muted">{data.location}</p> : null}
            <div className="pcard__actions">
              <Link className="pcard__link" to={to}>
                {data.ownerLink ? t("profileCard.viewOwn") : t("profileCard.view")}
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>,
    document.body
  );
}
