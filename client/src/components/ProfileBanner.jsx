import { useState } from "react";
import useParallaxLayer from "../hooks/useParallaxLayer";
import { bannerStyle } from "../utils/bannerStyle";
import "../styles/cover.css";

// The decorative pattern layer on its own parallax layer. A component of its own
// so the layer registers whenever it mounts, including after the cover changes.
const PatternLayer = ({ style }) => {
  const ref = useParallaxLayer(0.08, 20);
  return <span ref={ref} className="rd2-cover-dots mx-parallax" style={style} />;
};

// The profile banner. `cover` is the resolved descriptor from the server:
//   { kind: "default" } | { kind: "template", template } | { kind: "image", image }
// With no cover or kind "default" it renders EXACTLY the markup and CSS the page
// used before covers existed (.rd2-cover with the gold dots), so an account with
// no cover looks the same. Decorative: aria-hidden, no alt text. Sits in
// `.rd2-head` as an absolutely positioned layer, height from --rd-cover-h.
export default function ProfileBanner({ cover, saving = false }) {
  const [failedUrl, setFailedUrl] = useState(null);

  if (cover?.kind === "template" && cover.template?.definition) {
    const { background, pattern } = bannerStyle(cover.template.definition);
    return (
      <div className="rd2-cover rd2-cover--template" style={{ background }} data-overlay={cover.template.overlay || "dark"} data-saving={saving || undefined} aria-hidden="true">
        {pattern ? <PatternLayer style={pattern} /> : null}
      </div>
    );
  }

  if (cover?.kind === "image" && cover.image?.url && failedUrl !== cover.image.url) {
    const { url, width, height, placeholderColor } = cover.image;
    return (
      <div
        className="rd2-cover rd2-cover--image"
        style={placeholderColor ? { background: placeholderColor } : undefined}
        data-overlay="dark"
        data-saving={saving || undefined}
        aria-hidden="true"
      >
        <img
          className="rd2-cover-img"
          src={url}
          alt=""
          width={width || 1600}
          height={height || 400}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
        />
      </div>
    );
  }

  // Default, an image that failed to load, or a descriptor this client does not know.
  return (
    <div className="rd2-cover" data-saving={saving || undefined} aria-hidden="true">
      <PatternLayer />
    </div>
  );
}
