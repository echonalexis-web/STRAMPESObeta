export default function AdminHeader({ title, description, icon }) {
  return (
    <header className={`admin-page-header${icon ? " admin-page-header--with-icon" : ""}`}>
      {icon ? <div className="admin-page-header__icon" aria-hidden="true">{icon}</div> : null}
      <div className="admin-page-header__body">
        <div>
          <p className="admin-page-kicker">Admin Control Center</p>
          <h1>{title}</h1>
        </div>
        {description ? <p className="admin-page-description">{description}</p> : null}
      </div>
    </header>
  );
}
