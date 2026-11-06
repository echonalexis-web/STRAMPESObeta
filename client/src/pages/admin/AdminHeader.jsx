import useParallaxLayer from "../../hooks/useParallaxLayer";

// Shared admin page-header band (.ds-pagehead look). Renders the page's only
// <h1>. Props: title, description, icon (optional section icon), actions
// (optional slot for page-level buttons). The ring art is the band's single
// decorative parallax layer.
export default function AdminHeader({ title, description, icon, actions }) {
  const artRef = useParallaxLayer(0.1, 24);

  return (
    <header className={`admin-page-header ds-pagehead${icon ? " admin-page-header--with-icon" : ""}`}>
      <span ref={artRef} className="ds-pagehead__art mx-parallax" aria-hidden="true" />
      {icon ? <div className="admin-page-header__icon" aria-hidden="true">{icon}</div> : null}
      <div className="admin-page-header__body ds-pagehead__text">
        <h1 className="ds-pagehead__title">{title}</h1>
        {description ? <p className="admin-page-description ds-pagehead__sub">{description}</p> : null}
      </div>
      {actions ? <div className="ds-pagehead__actions">{actions}</div> : null}
    </header>
  );
}
