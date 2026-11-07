import { useState } from "react";
import { ArrowRight, Newspaper } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveAssetUrl } from "../services/api";
import { CATEGORY_LABEL, categoryKey, excerpt, formatDate } from "../utils/newsFormat";

// One news / announcement card for both layouts. The layout is chosen from
// the data, with no flag: an item with a usable image renders the image card;
// an item with no image, or whose image fails to load, renders the text-only
// card. Styles live in styles/news-feed.css (.news-card--text,
// .news-featured--text).
//
//   variant "card"     - grid card (.news-card)
//   variant "featured" - the banner above the grid (.news-featured)
//
// Likes, navigation and data fetching stay in the page: it passes `onOpen`
// and the already-built `likeButton` node, so this component only renders.
export default function NewsCard({ item, variant = "card", isLoggedIn, onOpen, likeButton }) {
  const { t } = useTranslation();
  const [failedSrc, setFailedSrc] = useState("");

  const id = String(item?._id || "");
  const key = categoryKey(item?.category);
  const label = CATEGORY_LABEL[key];
  const src = typeof item?.imageUrl === "string" ? item.imageUrl.trim() : "";
  // resolveAssetUrl returns "" for refs the browser cannot load (e.g. a
  // private file ref); that counts as no image, not a blank <img>.
  const resolvedSrc = src ? resolveAssetUrl(src) : "";
  // Keyed by src so a different image (e.g. after the list refreshes) gets a
  // fresh chance to load instead of inheriting an earlier failure.
  const showImage = Boolean(resolvedSrc) && failedSrc !== src;
  const title = item?.title || "Untitled update";
  const date = formatDate(item?.publishedAt || item?.createdAt);
  const featured = variant === "featured";

  const open = () => onOpen(id);
  const handleCardKeyboardLink = (event) => {
    // Let the browser handle modified clicks (open in new tab / window).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  };

  const image = showImage ? (
    <img
      src={resolvedSrc}
      alt={item?.title || "Announcement"}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  ) : null;

  const heading = (Tag, className) => (
    <Tag className={className}>
      {/* A real link inside the heading gives keyboard users and screen
          readers the same destination the whole-card click goes to. */}
      <a className="news-card__link" href={`/news/${id}`} onClick={handleCardKeyboardLink}>
        {title}
      </a>
    </Tag>
  );

  if (featured) {
    return (
      <article
        className={`news-featured${showImage ? "" : " news-featured--text"}`}
        data-category={key}
        onClick={open}
      >
        {showImage ? <div className="news-featured__media">{image}</div> : (
          <span className="news-featured__icon" aria-hidden="true">
            <Newspaper />
          </span>
        )}
        <div className="news-featured__body">
          <span className="news-badge">{label}</span>
          {heading("h2")}
          {(() => {
            const text = excerpt(item?.content, showImage ? 260 : 420, showImage ? undefined : "");
            return text ? <p className="news-featured__excerpt">{text}</p> : null;
          })()}
          <div className="news-featured__foot">
            {likeButton}
            <span>{date}</span>
            <span>{item?.author?.name || "PESO Admin"}</span>
          </div>
          {/* Signed-in banner only: a visual cue, not a second control — the
              whole article is already the link. */}
          {isLoggedIn ? (
            <span className="ds-btn ds-btn--gold news-featured__cta" aria-hidden="true">
              {t("news.readStory")} <ArrowRight size={16} />
            </span>
          ) : null}
        </div>
      </article>
    );
  }

  const text = excerpt(item?.content, showImage ? 140 : 360, showImage ? undefined : "");
  return (
    <article className={`news-card${showImage ? "" : " news-card--text"}`} data-category={key} onClick={open}>
      {showImage ? (
        <div className="news-card__media">{image}</div>
      ) : (
        <div className="news-card__band">
          <span className="news-badge">{label}</span>
          <span className="news-card__band-icon" aria-hidden="true">
            <Newspaper size={22} />
          </span>
        </div>
      )}
      <div className="news-card__body">
        {showImage ? <span className="news-badge">{label}</span> : null}
        {heading("h2", "news-card__title")}
        {text ? <p className="news-card__excerpt">{text}</p> : null}
        <div className="news-card__foot">
          {likeButton}
          <span>{date}</span>
          {isLoggedIn ? (
            <span className="news-card__more" aria-hidden="true">
              {t("news.readMore")} <ArrowRight size={14} />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
