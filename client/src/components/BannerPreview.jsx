import { useState } from "react";
import { resolveAssetUrl } from "../services/api";
import { bannerStyle } from "../utils/bannerStyle";
import "../styles/cover.css";

// A small, self-contained banner for thumbnails and previews (cover picker, hover
// cards). It draws either an uploaded template image (`template.kind === "image"`)
// or a legacy template from its definition with the same bannerStyle() as the real
// profile banner. `guide` draws the center band that artwork keeps its key shapes
// in. Decorative (aria-hidden) unless `alt` is given, which makes it an image.
export default function BannerPreview({ definition, template, height = 72, guide = false, alt = "", className = "" }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const image = template?.kind === "image" ? template.image : null;
  const src = image?.url ? resolveAssetUrl(image.thumbUrl || image.url) : "";
  const classes = ["bp", className].filter(Boolean).join(" ");

  if (src && failedUrl !== src) {
    return (
      <div
        className={`${classes} bp--image`}
        style={{ height, ...(image.placeholderColor ? { background: image.placeholderColor } : {}) }}
        {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": "true" })}
      >
        <img className="bp-img" src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(src)} />
        {guide ? <span className="bp-guide" /> : null}
      </div>
    );
  }

  // Legacy template, or an image that failed to load: the template's own definition
  // when it has one, else the built-in banner.
  const { background, pattern } = bannerStyle(definition ?? template?.definition);
  return (
    <div className={classes} style={{ background, height }} {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": "true" })}>
      {pattern ? <span className="bp-pattern" style={pattern} /> : null}
      {guide ? <span className="bp-guide" /> : null}
    </div>
  );
}
