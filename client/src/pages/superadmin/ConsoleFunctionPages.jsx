import ConsoleFunctionPage from "./ConsoleShell";
import NsrpTemplateSettings from "../../components/NsrpTemplateSettings";
import MatchWeightBoundsSettings from "../../components/MatchWeightBoundsSettings";
import SystemOptionsSettings from "../../components/SystemOptionsSettings";
import { Navigate, useLocation } from "react-router-dom";
import ProfileTemplatesSettings from "../../components/ProfileTemplatesSettings";
import { LEGACY_PATHS } from "./consoleRegistry";

// One page per console function. The function components are the same ones the old
// single page stacked; they are only given their own route and a shared frame.

export const NsrpFormsPage = () => (
  <ConsoleFunctionPage id="nsrp-forms">
    <NsrpTemplateSettings />
  </ConsoleFunctionPage>
);

export const MatchingBoundsPage = () => (
  <ConsoleFunctionPage id="matching-bounds">
    <MatchWeightBoundsSettings />
  </ConsoleFunctionPage>
);

export const CatalogsPage = () => (
  <ConsoleFunctionPage id="catalogs">
    <SystemOptionsSettings />
  </ConsoleFunctionPage>
);

export const ProfileTemplatesPage = () => (
  <ConsoleFunctionPage id="banner-avatar-templates">
    <ProfileTemplatesSettings />
  </ConsoleFunctionPage>
);

// The function used to live at /superadmin/banner-templates; old links keep working
// (any query string, such as a tab, is kept).
export const LegacyBannerTemplatesRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`${LEGACY_PATHS["/superadmin/banner-templates"]}${search}`} replace />;
};
