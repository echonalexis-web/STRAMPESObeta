import { useContext, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { resultModal } from "../services/resultModal";
import { hostPathFor } from "../utils/resultModalPaths";

// Public entry for an emailed confirmation link. It starts the single-use
// request, then immediately REPLACES the URL with the page the user belongs on
// so the token is out of the address bar and Back cannot return here. It
// renders nothing: the result appears in ResultModalHost, on top of that page.
//
// The token is handed straight to the store and is never put in location
// state, storage or the history entry. The store makes the request run once
// even if this effect runs twice (React StrictMode).
export default function ResultLinkEntry({ kind }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, token: sessionToken } = useContext(AuthContext);
  const signedIn = Boolean(sessionToken && user);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    resultModal.start(kind, {
      token: params.get("token") || "",
      email: params.get("email") || "",
    });
    navigate(hostPathFor(kind, "loading", signedIn), { replace: true });
  }, [kind, params, navigate, signedIn]);

  return null;
}
