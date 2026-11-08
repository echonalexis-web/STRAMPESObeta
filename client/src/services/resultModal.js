import { authAPI } from "./api";
import { createResultStore } from "../utils/resultModalStore";

function pageStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// The one result-modal store for the app. Each kind calls the same API
// function the old full-page screens called; only the presentation changed.
export const resultModal = createResultStore({
  confirmers: {
    "recovery-email": (link) => authAPI.confirmRecoveryEmail(link),
    "email-change": (link) => authAPI.confirmEmailChange(link),
    "email-verification": (link) => authAPI.confirmEmailVerification(link),
  },
  storage: pageStorage(),
});
