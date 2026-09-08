import { useState } from "react";
import { filesAPI, isPrivateFileRef, resolveAssetUrl } from "../services/api";

/**
 * Renders a link to an uploaded file. Public files link directly; private
 * storage refs are exchanged for a short-lived signed URL on click.
 */
export default function SecureFileLink({ value, children, className, style }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (!value) return null;

  const direct = !isPrivateFileRef(value);
  const href = direct ? resolveAssetUrl(value) : "#";

  const handleClick = async (event) => {
    if (direct) return;
    event.preventDefault();
    if (loading) return;
    setError(false);
    try {
      setLoading(true);
      const { data } = await filesAPI.getSignedUrl(value);
      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        setError(true);
      }
    } catch (_) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={className}
      style={style}
      target={direct ? "_blank" : undefined}
      rel={direct ? "noreferrer" : undefined}
    >
      {loading ? "Opening…" : error ? "Unavailable" : children}
    </a>
  );
}
