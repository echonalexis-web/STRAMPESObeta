import ResultLinkEntry from "../components/ResultLinkEntry";

// Emailed registration "verify your email" link for a NEW account. Kept
// separate from VerifyEmail (changing an existing account's email): different
// tokens and backend flow. The result shows as a modal over the login page.
export default function ConfirmEmail() {
  return <ResultLinkEntry kind="email-verification" />;
}
