import ResultLinkEntry from "../components/ResultLinkEntry";

// Emailed "confirm your new sign-in email" link. A confirmed change ends the
// session, exactly as before; ResultModalHost does that and shows the result
// over the login page (over Edit Profile on failure while signed in).
export default function VerifyEmail() {
  return <ResultLinkEntry kind="email-change" />;
}
