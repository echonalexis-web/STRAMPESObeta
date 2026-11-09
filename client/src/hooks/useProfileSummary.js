import { useEffect, useState } from "react";
import { profileViewAPI } from "../services/api";
import { createSummaryCache } from "../utils/profileSummaryCache";

// One cache for the whole app: 100 entries, 120 s, in-flight de-duplication.
// "Unavailable" answers are cached too, so sweeping a list does not re-request them.
export const summaryCache = createSummaryCache();

const isAbort = (error) => error?.name === "AbortError" || error?.name === "CanceledError" || error?.code === "ERR_CANCELED";

const loadSummary = (userId) => (controller) =>
  profileViewAPI
    .summary(userId, controller?.signal)
    .then((res) => ({ data: res.data }))
    .catch((error) => {
      if (isAbort(error)) throw error;
      // One answer for every unavailable case (PROFILE_UNAVAILABLE, 404).
      if (error?.response?.status === 404) return { unavailable: true };
      throw error;
    });

// Fetches the hover card data when the card mounts (so only after the open delay),
// from the cache when fresh, and cancels the request when the card unmounts.
// Returns { status: "loading" | "ready" | "unavailable" | "error", data }.
export default function useProfileSummary(userId) {
  const [fetched, setFetched] = useState({ id: null, status: "loading", data: null });
  const cached = userId ? summaryCache.get(userId) : undefined;

  useEffect(() => {
    if (!userId || summaryCache.get(userId) !== undefined) return undefined;
    const handle = summaryCache.fetch(userId, loadSummary(userId));
    handle.promise
      .then((value) => {
        setFetched({ id: userId, status: value?.unavailable ? "unavailable" : "ready", data: value?.data || null });
      })
      .catch((error) => {
        if (!isAbort(error)) setFetched({ id: userId, status: "error", data: null });
      });
    return () => handle.cancel();
  }, [userId]);

  if (cached !== undefined) {
    return { status: cached.unavailable ? "unavailable" : "ready", data: cached.data || null };
  }
  if (fetched.id === userId) return { status: fetched.status, data: fetched.data };
  return { status: "loading", data: null };
}
