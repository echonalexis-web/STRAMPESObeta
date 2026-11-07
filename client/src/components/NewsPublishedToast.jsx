import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Megaphone, X } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { newsAPI } from "../services/api";
import {
  JOBSEEKER_ONLY_NEWS_CATEGORIES,
  NEWS_FEED_LOADED_EVENT,
  NEWS_PUBLISHED_EVENT,
  NEWS_REFRESH_EVENT,
  newsItemTime,
} from "../utils/newsEvents";
import "../styles/news-toast.css";

// Realtime "new announcement" prompt. Mounted once inside the router for
// every logged-in page (see AppRoutes in App.jsx); it renders nothing for
// logged-out visitors, so Home, About and the auth pages never see it.
//
// It never touches the feed itself: new items only appear after the user
// presses Refresh (on /news) or View (anywhere else). If the socket is
// unavailable it simply never shows, and every failure here is silent.
export default function NewsPublishedToast() {
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const role = user?.role === "employee" || user?.role === "resident" ? "jobseeker" : user?.role;
  // The server only sends this to jobseekers and employers; mirror that here
  // so staff accounts never run the reconnect check below either.
  const eligible = Boolean(user) && (role === "jobseeker" || role === "employer");

  // Ids of announcements published since the user last looked at the feed.
  const [pendingIds, setPendingIds] = useState([]);
  // Server timestamp (ms) of the newest announcement this session knows
  // about. Only server times are compared, so client clock skew can't cause
  // false prompts after a reconnect.
  const newestKnownRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const missedWhileOfflineRef = useRef(false);

  const onNewsPage = pathname === "/news";

  const addPending = useCallback((ids) => {
    if (!ids.length) return;
    setPendingIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next.size === current.length ? current : [...next];
    });
  }, []);

  const noteNewest = useCallback((time) => {
    if (time && (newestKnownRef.current === null || time > newestKnownRef.current)) newestKnownRef.current = time;
  }, []);

  // Live event from the server.
  useEffect(() => {
    if (!socket || !eligible) return undefined;
    const handlePublished = (payload) => {
      if (!payload || typeof payload.id !== "string") return;
      noteNewest(newsItemTime(payload));
      addPending([payload.id]);
    };
    socket.on(NEWS_PUBLISHED_EVENT, handlePublished);
    return () => socket.off(NEWS_PUBLISHED_EVENT, handlePublished);
  }, [socket, eligible, addPending, noteNewest]);

  // The feed tells us what it just loaded: those items are no longer
  // "new", and an unfiltered load is a trustworthy "newest known" marker.
  useEffect(() => {
    if (!eligible) return undefined;
    const handleFeedLoaded = (event) => {
      const { ids = [], newestAt = 0, filtered = false } = event.detail || {};
      if (ids.length) {
        setPendingIds((current) => {
          const loaded = new Set(ids);
          const remaining = current.filter((id) => !loaded.has(id));
          return remaining.length === current.length ? current : remaining;
        });
      }
      if (!filtered) noteNewest(newestAt);
    };
    window.addEventListener(NEWS_FEED_LOADED_EVENT, handleFeedLoaded);
    return () => window.removeEventListener(NEWS_FEED_LOADED_EVENT, handleFeedLoaded);
  }, [eligible, noteNewest]);

  // Baseline once per session, and a catch-up after every reconnect, so an
  // announcement published while this tab was offline still gets a prompt.
  useEffect(() => {
    if (!eligible) return;
    if (!isConnected) {
      if (wasConnectedRef.current) missedWhileOfflineRef.current = true;
      return;
    }
    wasConnectedRef.current = true;
    let cancelled = false;

    const run = async () => {
      try {
        if (newestKnownRef.current === null) {
          // First connection: remember where the feed stood.
          const { data } = await newsAPI.list({ page: 1, limit: 1 });
          if (!cancelled) noteNewest(newsItemTime(data?.items?.[0]));
          return;
        }
        if (!missedWhileOfflineRef.current) return;
        missedWhileOfflineRef.current = false;
        const { data } = await newsAPI.list({ page: 1, limit: 10 });
        if (cancelled) return;
        const since = newestKnownRef.current;
        const newer = (Array.isArray(data?.items) ? data.items : []).filter(
          (item) =>
            item?._id &&
            newsItemTime(item) > since &&
            !(role === "employer" && JOBSEEKER_ONLY_NEWS_CATEGORIES.includes(item.category))
        );
        if (newer.length) {
          noteNewest(Math.max(...newer.map(newsItemTime)));
          addPending(newer.map((item) => String(item._id)));
        }
      } catch {
        // Offline or the API is down: the app works as before, without the prompt.
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isConnected, eligible, role, addPending, noteNewest]);

  const dismiss = () => setPendingIds([]);

  const act = () => {
    setPendingIds([]);
    if (onNewsPage) {
      window.dispatchEvent(new CustomEvent(NEWS_REFRESH_EVENT));
    } else {
      navigate("/news");
    }
  };

  if (!eligible) return null;

  return (
    <NewsToastView count={pendingIds.length} onNewsPage={onNewsPage} onAct={act} onDismiss={dismiss} />
  );
}

// Presentational part, split out so every state can be rendered and checked
// without a socket. The live region stays mounted so screen readers announce
// the toast when it appears and when the count changes; it never takes focus.
export function NewsToastView({ count, onNewsPage, onAct, onDismiss }) {
  const { t } = useTranslation();
  return (
    <div className="news-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {count > 0 ? (
        <div className="news-toast">
          <Megaphone className="news-toast__icon" aria-hidden="true" size={20} />
          <p className="news-toast__msg">
            {count === 1 ? t("newsToast.single") : t("newsToast.multiple", { count })}
          </p>
          <button type="button" className="news-toast__action" onClick={onAct}>
            {onNewsPage ? t("newsToast.refresh") : t("newsToast.view")}
          </button>
          <button type="button" className="news-toast__close" onClick={onDismiss} aria-label={t("newsToast.dismiss")}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
