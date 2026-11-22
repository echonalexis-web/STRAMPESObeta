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
