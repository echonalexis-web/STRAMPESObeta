export default function AdminHeader({ title, description }) {
  return (
    <header className="admin-page-header">
      <div>
        <p className="admin-page-kicker">Admin Control Center</p>
        <h1>{title}</h1>
      </div>
      {description ? <p className="admin-page-description">{description}</p> : null}
    </header>
  );
}
