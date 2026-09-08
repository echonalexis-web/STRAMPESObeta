import { useEffect, useRef } from "react";

// OAuth 2.0 Web client ID — the same value set on the server as
// GOOGLE_CLIENT_ID. When it's missing the component renders nothing, so
// Google sign-in cleanly disappears until it's configured.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GIS_SRC = "https://accounts.google.com/gsi/client";

let gisPromise = null;
const loadGis = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
};

/**
 * Renders Google's official "Sign in with Google" button.
 * @param {(credential: string) => void} onCredential  called with the ID token
 * @param {(err: Error) => void} [onError]
 * @param {string} [text]  GIS button text: "signin_with" | "signup_with" | "continue_with"
 */
export default function GoogleSignInButton({ onCredential, onError, text = "continue_with" }) {
  const targetRef = useRef(null);
  // Keep the latest callbacks without re-running the init effect.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !targetRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            if (response?.credential) onCredentialRef.current?.(response.credential);
          },
        });
        window.google.accounts.id.renderButton(targetRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text,
          logo_alignment: "left",
          width: 320,
        });
      })
      .catch((err) => onErrorRef.current?.(err));

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <div className="google-signin__divider"><span>or</span></div>
      <div ref={targetRef} className="google-signin__btn" />
    </div>
  );
}
