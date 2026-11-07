import { createContext } from "react";

// Value: { statuses, now, refreshSnapshot }. See context/PresenceProvider.jsx.
export const PresenceContext = createContext(null);
