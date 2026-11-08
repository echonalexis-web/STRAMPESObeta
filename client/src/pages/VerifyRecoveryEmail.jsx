import ResultLinkEntry from "../components/ResultLinkEntry";

// Emailed "confirm your recovery email" link. The confirmation itself, and the
// modal that shows its result over Settings (or the login page when signed
// out), live in ResultLinkEntry / ResultModalHost. Unlike a sign-in email
// change, confirming a recovery email does not touch the session.
export default function VerifyRecoveryEmail() {
  return <ResultLinkEntry kind="recovery-email" />;
}
