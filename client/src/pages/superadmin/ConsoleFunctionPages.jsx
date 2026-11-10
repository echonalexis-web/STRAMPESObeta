import ConsoleFunctionPage from "./ConsoleShell";
import NsrpTemplateSettings from "../../components/NsrpTemplateSettings";
import MatchWeightBoundsSettings from "../../components/MatchWeightBoundsSettings";
import SystemOptionsSettings from "../../components/SystemOptionsSettings";
import BannerTemplatesSettings from "../../components/BannerTemplatesSettings";

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

export const BannerTemplatesPage = () => (
  <ConsoleFunctionPage id="banner-templates">
    <BannerTemplatesSettings />
  </ConsoleFunctionPage>
);
