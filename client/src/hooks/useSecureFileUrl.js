import { useState } from "react";
import { filesAPI, isPrivateFileRef, resolveAssetUrl } from "../services/api";

/**
 * Resolves a stored file reference to an openable URL. Public files resolve
 * immediately; private storage refs need a short-lived signed URL fetched
 * from the server, triggered by calling resolve().
 */
export function useSecureFileUrl(value) {
  const [url, setUrl] = useState(() => (value && !isPrivateFileRef(value) ? resolveAssetUrl(value) : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const direct = Boolean(value) && !isPrivateFileRef(value);

  // Returns the resolved URL directly (in addition to updating `url` state)
  // so a caller that needs it immediately after awaiting — e.g. to open a
  // new tab — doesn't have to wait for a re-render to read stale state.
  const resolve = async () => {
    if (!value) return null;
    if (direct) return url;
    if (url) return url;
    setError(false);
    try {
      setLoading(true);
      const { data } = await filesAPI.getSignedUrl(value);
      if (data?.url) {
        setUrl(data.url);
        return data.url;
      }
      setError(true);
      return null;
    } catch (_) {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { url, loading, error, direct, resolve };
}
