import { useMemo, useState } from "react";
import { resolveAssetUrl } from "../services/api";
import { initialOf, pickAvatarSource, presetImageUrl } from "../utils/avatarSource";
import "../styles/avatar.css";

// The shared profile picture: a chosen preset avatar, else the uploaded photo, else
// the person's initial. A picture that fails to load (a broken link, an archived
// preset) falls through to the next one, never to a broken image. Decorative by
// default (the name is next to it); pass `label` to announce it as an image.
//   size: a pixel number, or "fill" to take the size and shape of its parent.
export default function Avatar({ name, photo, preset, size = 40, initial, label, className = "" }) {
  const [failed, setFailed] = useState(() => new Set());
  const presetUrl = useMemo(() => presetImageUrl(preset, size, resolveAssetUrl), [preset, size]);
  const photoUrl = photo ? resolveAssetUrl(photo) : "";
  const source = pickAvatarSource({ presetUrl, photoUrl }, failed);
  const fill = size === "fill";

  return (
    <span
      className={["av", fill ? "av--fill" : "", className].filter(Boolean).join(" ")}
      style={fill ? undefined : { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.42)) }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
    >
      {source.kind === "initials" ? (
        <span className="av__initial">{initial || initialOf(name)}</span>
      ) : (
        <img
          className="av__img"
          src={source.url}
          alt=""
          decoding="async"
          loading="lazy"
          draggable={false}
          onError={() => setFailed((prev) => new Set(prev).add(source.url))}
        />
      )}
    </span>
  );
}
