import { FaTools } from "react-icons/fa";

/**
 * Marks a settings control that is intentionally front-end only for now — the
 * UI is in place so people can preview what's coming, but nothing it changes is
 * saved to the server yet.
 *
 *   <NotYetAvailable />                     → inline pill, sits next to a heading
 *   <NotYetAvailable variant="banner" />    → full-width strip inside a section
 *   <NotYetAvailable note="Custom copy." /> → override the banner's sentence
 */
export default function NotYetAvailable({ variant = "pill", note }) {
  if (variant === "banner") {
    return (
      <div className="nya-banner" role="note">
        <FaTools className="nya-banner__icon" aria-hidden="true" />
        <span>
          {note ||
            "This setting isn't active yet — it's here to preview what's coming. Changes won't be saved."}
        </span>
      </div>
    );
  }

  return (
    <span className="nya-pill" title="Not yet available">
      <FaTools aria-hidden="true" /> Not yet available
    </span>
  );
}
