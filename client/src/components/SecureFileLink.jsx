import { useSecureFileUrl } from "../hooks/useSecureFileUrl";

/**
 * Renders a link to an uploaded file. Public files link directly; private
 * storage refs are exchanged for a short-lived signed URL on click.
 */
export default function SecureFileLink({ value, children, className, style }) {
  const { url, loading, error, direct, resolve } = useSecureFileUrl(value);

  if (!value) return null;

  const href = direct ? url : "#";

  const handleClick = async (event) => {
    if (direct) return;
    event.preventDefault();
    if (loading) return;
    const resolvedUrl = await resolve();
    if (resolvedUrl) {
      window.open(resolvedUrl, "_blank", "noopener,noreferrer");
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
