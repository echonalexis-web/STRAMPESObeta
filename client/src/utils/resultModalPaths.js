// Which page sits behind the result modal. Pure so it can be unit-tested.
//
//  - recovery email:      Settings when signed in, otherwise the login page.
//  - sign-in email change: the Edit Profile page while pending/failed (signed
//    in), the login page otherwise. Success ends the session, so the host is
//    always /login.
//  - registration email:  always the login page.
export function hostPathFor(kind, status, signedIn) {
  if (kind === "recovery-email") return signedIn ? "/settings" : "/login";
  if (kind === "email-change") {
    if (status === "success") return "/login";
    return signedIn ? "/profile/edit" : "/login";
  }
  return "/login";
}
