import { bannerStyle } from "../utils/bannerStyle";
import "../styles/cover.css";

// A small, self-contained banner built from a template definition. Used for the
// thumbnails and live previews (superadmin screen, cover picker). It uses the
// same bannerStyle() as the real profile banner, so what you see is what the
// profile shows. `guide` draws the center band that artwork should keep its key
// shapes in. Decorative: aria-hidden.
export default function BannerPreview({ definition, height = 72, guide = false, className = "" }) {
  const { background, pattern } = bannerStyle(definition);
  return (
    <div className={["bp", className].filter(Boolean).join(" ")} style={{ background, height }} aria-hidden="true">
      {pattern ? <span className="bp-pattern" style={pattern} /> : null}
      {guide ? <span className="bp-guide" /> : null}
    </div>
  );
}
