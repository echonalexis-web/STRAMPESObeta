import { createContext, useContext } from "react";

// Split from FeedbackProvider so the provider file only exports a component
// (keeps React Fast Refresh happy).
export const ToastContext = createContext(null);
export const ConfirmContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <FeedbackProvider>");
  return ctx;
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <FeedbackProvider>");
  return ctx;
}
