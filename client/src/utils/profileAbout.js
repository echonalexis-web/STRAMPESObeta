// View helpers for the profile About card. No rules about who may see what live here:
// the server decides what each viewer receives, and the page passes in only what it
// was given. `isOwner` only decides whether an empty part shows an "Add ..." prompt.

const text = (value) => (typeof value === "string" ? value.trim() : "");

// Trimmed, empty values dropped, duplicates (ignoring case and extra spaces) kept once.
export const uniqueLabels = (...lists) => {
  const seen = new Set();
  const out = [];
  lists.flat().forEach((item) => {
    const label = text(typeof item === "string" ? item : item == null ? "" : String(item)).replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  });
  return out;
};

// "filled": there is something to show. "add": empty and the owner is looking (show an
// "Add ..." prompt). "absent": empty and someone else is looking (show nothing).
const stateOf = (filled, isOwner) => (filled ? "filled" : isOwner ? "add" : "absent");

// True when this viewer has something to see (the caller leaves the whole card out when not).
export const hasAboutContent = (props) => !aboutModel(props).hidden;

// The About card as blocks: the bio, a row of (positions, status), a row of
// (address, locations). A row keeps only its non-absent columns, so one remaining
// column spans the full row; a row with no columns is not drawn.
export const aboutModel = ({ bio = "", positions = [], status = "", address = "", locations = [], isOwner = false } = {}) => {
  const bioText = typeof bio === "string" ? bio.replace(/\r\n/g, "\n").trim() : "";
  const positionList = uniqueLabels(positions);
  const locationList = uniqueLabels(locations);
  const statusText = text(status);
  const addressText = text(address);

  const bioState = stateOf(Boolean(bioText), isOwner);
  const rowB = [
    { key: "positions", state: stateOf(positionList.length > 0, isOwner) },
    { key: "status", state: stateOf(Boolean(statusText), isOwner) },
  ].filter((col) => col.state !== "absent");
  const rowC = [
    { key: "address", state: stateOf(Boolean(addressText), isOwner) },
    { key: "locations", state: stateOf(locationList.length > 0, isOwner) },
  ].filter((col) => col.state !== "absent");

  return {
    bio: { text: bioText, state: bioState },
    positions: positionList,
    status: statusText,
    address: addressText,
    locations: locationList,
    rowB,
    rowC,
    // Nothing to show to this viewer: the whole card is left out.
    hidden: bioState === "absent" && rowB.length === 0 && rowC.length === 0,
  };
};
