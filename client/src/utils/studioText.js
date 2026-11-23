// The hiring manager name typed into the Studio ("Addressed to"): plain text, spaces collapsed,
// markup characters and control characters dropped, 80 characters at most. Mirrors the server's
// cleanHiringManagerName so what is shown is what a posting would store.
export const HIRING_MANAGER_NAME_MAX = 80;

export const cleanHiringManagerName = (value) =>
  String(value == null ? "" : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HIRING_MANAGER_NAME_MAX)
    .trim();
