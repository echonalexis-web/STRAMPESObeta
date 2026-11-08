// Small display helpers shared by the SPES posting pages. The server derives the
// status (applyState / displayStatus / closedReason); this only formats it.

export const formatSpesDate = (value, language) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(String(language || "").startsWith("fil") ? "fil-PH" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// Tabs on the applicant postings list.
export const POSTING_TABS = ["open", "closed", "all"];

export const matchesTab = (tab, posting) => {
  if (tab === "all") return true;
  if (tab === "open") return posting.displayStatus === "open";
  return posting.displayStatus === "closed" || posting.displayStatus === "results_released";
};

// The document types a posting asks for, de-duplicated for display (the academic
// proof and the OSY certificate are alternatives, shown on separate lines).
export const postingDocumentSlots = (slotsForStudent, slotsForOsy) => {
  const all = [...slotsForStudent];
  for (const slot of slotsForOsy) if (!all.includes(slot)) all.push(slot);
  return all;
};
