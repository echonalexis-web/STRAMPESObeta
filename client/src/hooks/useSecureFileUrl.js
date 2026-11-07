import { useEffect, useState } from "react";
import { filesAPI, isPrivateFileRef, resolveAssetUrl } from "../services/api";

/**
 * Resolves a stored file reference to an openable URL. Public files resolve
 * immediately; private storage refs need a short-lived signed URL fetched
 * from the server, triggered by calling resolve().
 */
export function useSecureFileUrl(value) {
  const [resolved, setResolved] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const protectedLocal = /^\/?uploads\//.test(value || "") && !/^\/?uploads\/(news|profiles|avatars)\//.test(value);
  const direct = Boolean(value) && !isPrivateFileRef(value) && !protectedLocal;
  const url = direct ? resolveAssetUrl(value) : resolved?.value === value ? resolved.url : null;
  useEffect(() => () => { if (resolved?.blob) URL.revokeObjectURL(resolved.url); }, [resolved]);

  // Returns the resolved URL directly (in addition to updating `url` state)
  // so a caller that needs it immediately after awaiting — e.g. to open a
  // new tab — doesn't have to wait for a re-render to read stale state.
  const resolve = async () => {
    if (!value) return null;
    if (direct) return url;
    if (url && resolved?.expiresAt > Date.now()) return url;
    setError(false);
    try {
      setLoading(true);
      if (protectedLocal) {
        // Local private assets also require Authorization; a plain anchor
        // cannot attach it. Keep a short-lived blob URL only in this component.
        const { data } = await filesAPI.getLocalFile(value);
        const blobUrl = URL.createObjectURL(data);
        setResolved({ value, url: blobUrl, blob: true, expiresAt: Date.now() + 120000 });
        return blobUrl;
      }
      const { data } = await filesAPI.getSignedUrl(value);
      if (data?.url) {
        setResolved({ value, url: data.url, expiresAt: Date.now() + Math.max(0, (data.expiresIn || 120) - 10) * 1000 });
        return data.url;
      }
      setError(true);
      return null;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { url, loading, error, direct, resolve };
}
