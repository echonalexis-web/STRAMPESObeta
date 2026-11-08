import { useState } from "react";
import { ArrowRight, GraduationCap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveAssetUrl } from "../services/api";
import { excerpt } from "../utils/newsFormat";
import { formatSpesDate } from "../utils/spesPostings";
import { normalizeSpesStatus } from "../utils/spesSlots";

// One SPES posting card, built on the same markup and classes as the news feed
// (components/NewsCard.jsx, styles/news-feed.css) so the SPES feed looks and behaves
// like the news feed: an image card when the posting has a cover image that loads,
// otherwise the text-only card.
//
//   variant "card"     - grid card (.news-card)
//   variant "featured" - the banner above the grid (.news-featured)
export default function SpesPostingCard({ item, variant = "card", onOpen }) {
  const { t, i18n } = useTranslation();
  const [failedSrc, setFailedSrc] = useState("");
  const { posting, myApplication, readOnly } = item;

  const id = String(posting._id);
  const src = typeof posting.coverImage === "string" ? posting.coverImage.trim() : "";
  const resolvedSrc = src ? resolveAssetUrl(src) : "";
  const showImage = Boolean(resolvedSrc) && failedSrc !== src;
  const badge = t(`spesPostings.status.${posting.displayStatus}`);
  const date = posting.applicationDeadline
    ? t("spes.panel.deadline", { date: formatSpesDate(posting.applicationDeadline, i18n.language) })
    : t("spes.admin.noDeadline");
  const slots = posting.slots ? t("spes.panel.slots", { count: Number(posting.slots) }) : "";
  const featured = variant === "featured";
  const href = `/spes/postings/${id}`;

  const open = () => onOpen(id);
  const handleLink = (event) => {
    // Let the browser handle modified clicks (open in a new tab or window).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  };

  const image = showImage ? (
    <img src={resolvedSrc} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
  ) : null;

  const heading = (Tag, className) => (
    <Tag className={className}>
      <a className="news-card__link" href={href} onClick={handleLink}>
        {posting.title}
      </a>
    </Tag>
  );

  const status = myApplication ? (
    <span className={`spes-chip spes-chip--${normalizeSpesStatus(myApplication.status)}`}>
      {t("spesPostings.yourApplication")} {t(`spes.status.${normalizeSpesStatus(myApplication.status)}`)}
    </span>
  ) : readOnly ? (
    <span>{t("spesPostings.readOnlyShort")}</span>
  ) : null;

  if (featured) {
    const text = excerpt(posting.description, showImage ? 260 : 420, "");
    return (
      <article className={`news-featured${showImage ? "" : " news-featured--text"}`} data-category="spes" onClick={open}>
        {showImage ? (
          <div className="news-featured__media">{image}</div>
        ) : (
          <span className="news-featured__icon" aria-hidden="true">
            <GraduationCap />
          </span>
        )}
        <div className="news-featured__body">
          <span className="news-badge">{badge}</span>
          {heading("h2")}
          {text ? <p className="news-featured__excerpt">{text}</p> : null}
          <div className="news-featured__foot">
            <span>{date}</span>
            {slots ? <span>{slots}</span> : null}
            {status}
          </div>
          <span className="ds-btn ds-btn--gold news-featured__cta" aria-hidden="true">
            {item.canApply ? t("spesPostings.viewAndApply") : t("spesPostings.viewPosting")} <ArrowRight size={16} />
          </span>
        </div>
      </article>
    );
  }

  const text = excerpt(posting.description, showImage ? 140 : 360, "");
  return (
    <article className={`news-card${showImage ? "" : " news-card--text"}`} data-category="spes" onClick={open}>
      {showImage ? (
        <div className="news-card__media">{image}</div>
      ) : (
        <div className="news-card__band">
          <span className="news-badge">{badge}</span>
          <span className="news-card__band-icon" aria-hidden="true">
            <GraduationCap size={22} />
          </span>
        </div>
      )}
      <div className="news-card__body">
        {showImage ? <span className="news-badge">{badge}</span> : null}
        {heading("h2", "news-card__title")}
        {text ? <p className="news-card__excerpt">{text}</p> : null}
        <div className="news-card__foot">
          <span>{date}</span>
          {slots ? <span>{slots}</span> : null}
          {status}
          <span className="news-card__more" aria-hidden="true">
            {t("spesPostings.viewPosting")} <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </article>
  );
}
