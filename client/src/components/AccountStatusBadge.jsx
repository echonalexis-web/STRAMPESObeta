import { statusBadgeClass } from "../utils/statusBadge";
import "../styles/status-badge.css";

// A status label with its shape. `state` is one of active, suspended,
// deactivated, deleted, banned; `children` is the already-translated label.
export default function AccountStatusBadge({ state, children }) {
  return <span className={statusBadgeClass(state)}>{children}</span>;
}
