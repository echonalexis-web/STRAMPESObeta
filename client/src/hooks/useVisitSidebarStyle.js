import { useCallback, useEffect, useState } from "react";

// The Resume & Cover Letter Studio needs the width, so the sidebar shows as the icon rail while the
// applicant is in it. This is driven by the route, not by the saved preference:
//   - on entering the studio (a link, a direct load or a refresh) the rail is collapsed;
//   - the saved preference is never written by that, so leaving the studio brings back exactly what
//     the applicant had (expanded or collapsed);
//   - expanding the rail inside the studio is allowed but lasts for this visit only: it is not saved,
//     and the next entry collapses it again.
export const STUDIO_PATH = "/profile/resume";

export const isStudioPath = (pathname) => pathname === STUDIO_PATH || String(pathname || "").startsWith(`${STUDIO_PATH}/`);

// `forced`: the current route is the studio. `savedStyle` / `saveStyle`: the normal, persisted
// preference ("full" | "icons") and the function that saves it.
export function useVisitSidebarStyle({ forced, savedStyle, saveStyle }) {
  // What the applicant chose for this visit ("full" | "icons"), or null for "use the route's default".
  const [visitStyle, setVisitStyle] = useState(null);

  // Leaving the studio ends the visit, so a later entry starts collapsed again.
  useEffect(() => {
    if (!forced) setVisitStyle(null);
  }, [forced]);

  const style = forced ? visitStyle ?? "icons" : savedStyle;
  const setStyle = useCallback(
    (next) => {
      if (forced) setVisitStyle(next);
      else saveStyle(next);
    },
    [forced, saveStyle]
  );
  return [style, setStyle];
}
