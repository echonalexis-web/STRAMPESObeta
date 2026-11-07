// Shared formatting helpers for news / announcement cards. Moved out of
// pages/NewsFeed.jsx unchanged so the page and components/NewsCard.jsx use
// the same labels, date format and excerpt rules.

// Human label per stored category value (feed cards + badges).
export const CATEGORY_LABEL = {
  general: "General",
  hiring: "Hiring",
  training: "Training",
  event: "Events",
  advisory: "Advisory",
  spes: "SPES Program",
};

export const categoryKey = (value) => (CATEGORY_LABEL[value] ? value : "general");

export const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Plain-text excerpt from the announcement body. `fallback` is what an empty
// body shows; the text-only card passes "" so it can omit the paragraph.
export const excerpt = (text, max = 180, fallback = "No details available.") => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};
