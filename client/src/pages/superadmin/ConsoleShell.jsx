import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowLeft } from "react-icons/fa6";
import useParallaxLayer from "../../hooks/useParallaxLayer";
import { CONSOLE_HOME, descriptionKey, findFunction, titleKey } from "./consoleRegistry";
import "../../styles/superadmin-console.css";
import "../../styles/superadmin-launcher.css";

// Decorative ring art for the page-header band — the console's single
// parallax layer (leaf element, aria-hidden).
const PageHeadArt = () => {
  const artRef = useParallaxLayer(0.1, 24);
  return <span ref={artRef} className="ds-pagehead__art mx-parallax" aria-hidden="true" />;
};

// The green hero. It holds the page's only <h1>.
export function ConsoleHero({ title, subtitle }) {
  return (
    <header className="sac__pagehead-band ds-pagehead">
      <PageHeadArt />
      <div className="ds-pagehead__text">
        <h1 className="ds-pagehead__title">{title}</h1>
        {subtitle ? <p className="ds-pagehead__sub">{subtitle}</p> : null}
      </div>
    </header>
  );
}

export function BackToConsole() {
  const { t } = useTranslation();
  return (
    <nav className="scl__crumbs" aria-label={t("superadmin.launcher.breadcrumb")}>
      <Link to={CONSOLE_HOME} className="scl__back">
        <FaArrowLeft aria-hidden="true" /> {t("superadmin.launcher.back")}
      </Link>
      <span className="scl__crumbs-sep" aria-hidden="true">
        /
      </span>
    </nav>
  );
}

// The frame of one function page: back link, hero with the function's title and
// description, then the function itself, untouched. `id` is a registry id.
export default function ConsoleFunctionPage({ id, children }) {
  const { t } = useTranslation();
  const entry = findFunction(id);
  return (
    <div className="sac">
      <main className="sac__main scl-main">
        <BackToConsole />
        <ConsoleHero title={entry ? t(titleKey(entry)) : ""} subtitle={entry ? t(descriptionKey(entry)) : ""} />
        {children}
      </main>
    </div>
  );
}
