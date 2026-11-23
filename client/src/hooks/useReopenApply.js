import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// When the Resume & Cover Letter Studio sends the applicant back ("Continue to submit
// application"), it hands the board `state.reopenApply = { jobId, resumeId, coverLetterId, scrollY }`.
// This reads it once, so the board can open the Apply modal for that job with the new documents
// picked, puts the page back where it was, and clears the state so a reload does not reopen it.
// Nothing is submitted here: the applicant still presses "Submit application".
export const SCROLL_KEY = "applyFlow.scrollY";

export const rememberScroll = () => {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY || 0)));
  } catch {
    /* private mode: the page simply opens at the top */
  }
};

export const readRememberedScroll = () => {
  try {
    const value = Number(sessionStorage.getItem(SCROLL_KEY));
    sessionStorage.removeItem(SCROLL_KEY);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

// Lists load after the page mounts, so keep trying for a couple of seconds until the page is tall
// enough to scroll to the saved position.
const restoreScroll = (y) => {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const reachable = document.documentElement.scrollHeight - window.innerHeight >= y;
    if (reachable || tries >= 20) {
      window.scrollTo(0, y);
      clearInterval(timer);
    }
  }, 100);
  return () => clearInterval(timer);
};

export default function useReopenApply() {
  const location = useLocation();
  const navigate = useNavigate();
  const [reopen] = useState(() => location.state?.reopenApply || null);

  useEffect(() => {
    if (!reopen) return undefined;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    const y = Number(reopen.scrollY) || readRememberedScroll();
    return y ? restoreScroll(y) : undefined;
    // Runs once for the state this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return reopen;
}
