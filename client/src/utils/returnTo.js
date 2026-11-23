// "Return to where I was" after login, for the public jobs pages. Only an in-app path
// under /jobs, or the Home page (with its jobs anchor), is ever accepted, so a crafted
// link can never send someone to another site or to an unexpected page after they sign in.

const ALLOWED = /^(\/jobs(\/[A-Za-z0-9_-]+)?(\/apply)?(\?[^#\s]*)?|\/(#available-jobs)?)$/;

// The path to return to, or "" when it is missing or not allowed.
export const safeReturnPath = (value) => {
  const path = String(value ?? "");
  if (path.length > 400 || path.startsWith("//") || path.includes("\\")) return "";
  return ALLOWED.test(path) ? path : "";
};

// Router state to hand to /login so it can come back to `location` afterwards.
export const loginStateFor = (location) => ({
  from: `${location?.pathname || ""}${location?.search || ""}`,
});

// "Back to Browse Jobs" from the Resume & Cover Letter Studio while applying. Only an in-app path
// to the jobs board, a job page or the dashboard (where the Apply modal also lives), with its query
// string, is accepted; anything else (another site, protocol-relative, backslashes, fragments,
// control characters) is dropped, so a crafted link can never send the applicant elsewhere.
const APPLY_RETURN = /^\/(jobs(\/[A-Za-z0-9_-]+)?|dashboard)(\?[^#\s\\]*)?$/;

export const safeApplyReturnPath = (value) => {
  const path = String(value ?? "");
  // eslint-disable-next-line no-control-regex
  if (path.length > 600 || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return "";
  return APPLY_RETURN.test(path) ? path : "";
};
