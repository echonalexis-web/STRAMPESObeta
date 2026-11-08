import { useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { resultModal } from "../services/resultModal";
import { hostPathFor } from "../utils/resultModalPaths";
import ResultModal from "./ResultModal";

const KEY_BY_KIND = {
  "recovery-email": "recoveryEmail",
  "email-change": "emailChange",
  "email-verification": "emailVerification",
};

function primaryLabelKey(kind, status, signedIn) {
  if (kind === "recovery-email") return signedIn ? "backToSettings" : "goToLogin";
  if (kind === "email-change") {
    if (status === "success") return "goToLogin";
    return signedIn ? "backToEditProfile" : "goToLogin";
  }
  return status === "success" ? "goToLogin" : "backToLogin";
}

// Global layer: shows the confirmation result (loading, success, failure) on
// top of whatever page is currently mounted. Mounted once in App.jsx. Its
// state lives in the result store, not in the URL or history, so closing it
// cannot be undone by Back and a refresh keeps the result.
export default function ResultModalHost() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, token: sessionToken, logout } = useContext(AuthContext);
  const result = useSyncExternalStore(resultModal.subscribe, resultModal.getSnapshot);
  const signedIn = Boolean(sessionToken && user);
  const endedSessionFor = useRef(null);

  // A confirmed sign-in email change ends the session (as the old page did):
  // the page behind the modal becomes the login page.
  const changedEmail = result?.kind === "email-change" && result.status === "success";
  const resultId = result?.id;
  useEffect(() => {
    if (!changedEmail || endedSessionFor.current === resultId) return;
    endedSessionFor.current = resultId;
    navigate("/login", { replace: true });
    logout();
  }, [changedEmail, resultId, navigate, logout]);

  if (!result) return null;

  const { kind, status, failureKind, email } = result;
  const ns = `resultModal.${KEY_BY_KIND[kind]}`;

  const close = () => {
    resultModal.dismiss();
    navigate(hostPathFor(kind, status, signedIn), { replace: true });
  };

  let title;
  let message;
  if (status === "loading") {
    title = t(`${ns}.loadingTitle`);
    message = t(`${ns}.loadingMessage`, { email });
  } else if (status === "success") {
    title = t(`${ns}.successTitle`);
    message = t(`${ns}.successMessage`, { email });
  } else if (failureKind === "network") {
    title = t("resultModal.networkTitle");
    message = t("resultModal.networkMessage");
  } else if (failureKind === "invalid") {
    title = t("resultModal.invalidTitle");
    message = t(`${ns}.invalidMessage`);
  } else {
    title = t("resultModal.tokenTitle");
    message = t(`${ns}.tokenMessage`);
  }

  const retryable = status === "failure" && failureKind === "network" && resultModal.canRetry();
  const primary = retryable
    ? { label: t("resultModal.tryAgain"), onClick: () => resultModal.retry() }
    : { label: t(`resultModal.${primaryLabelKey(kind, status, signedIn)}`), onClick: close };
  const secondary = retryable ? { label: t("resultModal.close"), onClick: close } : undefined;

  return (
    <ResultModal
      status={status}
      title={title}
      message={message}
      primary={primary}
      secondary={secondary}
      closeLabel={t("resultModal.close")}
      onClose={close}
    />
  );
}
