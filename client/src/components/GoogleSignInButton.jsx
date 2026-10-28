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
 * @param {boolean} [fullWidth]  Fit the official button to its container (up to 400px).
 */
export default function GoogleSignInButton({ onCredential, onError, text = "continue_with", fullWidth = false }) {
  const targetRef = useRef(null);
  // Keep the latest callbacks without re-running the init effect.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    let resizeObserver;

    loadGis()
      .then(() => {
        if (cancelled || !targetRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            if (response?.credential) onCredentialRef.current?.(response.credential);
          },
        });
        const target = targetRef.current;
        let lastWidth;
        const renderButton = () => {
          if (cancelled) return;
          const width = fullWidth ? Math.min(400, Math.floor(target.clientWidth)) : 320;
          if (!width || width === lastWidth) return;
          lastWidth = width;
          window.google.accounts.id.renderButton(target, {
            theme: "outline",
            size: "large",
            shape: fullWidth ? "rectangular" : "pill",
            text,
            logo_alignment: "left",
            width,
          });
        };
        renderButton();
        if (fullWidth) {
          resizeObserver = new ResizeObserver(renderButton);
          resizeObserver.observe(target);
        }
      })
      .catch((err) => onErrorRef.current?.(err));

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [text, fullWidth]);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <div className="google-signin__divider"><span>or</span></div>
      <div ref={targetRef} className="google-signin__btn" />
    </div>
  );
}
