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

// Place names are stored in capitals ("CITY OF MAKATI, NATIONAL CAPITAL REGION - FOURTH
// DISTRICT"). For display, an all-capitals label becomes Title Case; anything with
// lowercase letters already (a country like "Singapore") is left exactly as stored.
const SMALL_WORDS = new Set(["of", "and", "the", "de", "del", "la", "las", "los", "sa", "ng"]);
const KEEP_UPPER = new Set(["NCR", "CAR", "ARMM", "BARMM", "USA", "UAE", "UK"]);
const ROMAN = /^[IVX]+(-[A-Z])?$/;

export const titleCasePlace = (label) => {
  const value = text(label);
  if (!value || /[a-z]/.test(value)) return value;
  return value
    .split(/(\s+)/)
    .map((part, index, all) => {
      if (/^\s+$/.test(part) || part === "") return part;
      if (KEEP_UPPER.has(part) || ROMAN.test(part)) return part;
      const lower = part.toLowerCase();
      const first = all.slice(0, index).every((p) => /^\s*$/.test(p));
      if (!first && SMALL_WORDS.has(lower)) return lower;
      return lower.replace(/(^|[-(/])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
    })
    .join("");
};

// "CITY OF MAKATI, NATIONAL CAPITAL REGION - FOURTH DISTRICT" -> a title (the place) and a
// subtitle (the rest). A country has no subtitle.
export const splitPlace = (label) => {
  const [first, ...rest] = String(label ?? "").split(",");
  return { title: titleCasePlace(first), sub: titleCasePlace(rest.join(",")) };
};

// "filled": there is something to show. "add": empty and the owner is looking (show an
// "Add ..." prompt). "absent": empty and someone else is looking (show nothing).
const stateOf = (filled, isOwner) => (filled ? "filled" : isOwner ? "add" : "absent");

// True when this viewer has something to see (the caller leaves the whole card out when not).
export const hasAboutContent = (props) => !aboutModel(props).hidden;

// The About card as blocks: the bio, a row of (positions, status), the address on its own
// row, then the preferred work locations on their own row. A row keeps only its
// non-absent columns, so one remaining column spans the full row; a row with no columns
// is not drawn. `locations` (a plain list) is read as local places.
export const aboutModel = ({
  bio = "",
  positions = [],
  status = "",
  address = "",
  locations = [],
  localLocations = [],
  overseasLocations = [],
  isOwner = false,
} = {}) => {
  const bioText = typeof bio === "string" ? bio.replace(/\r\n/g, "\n").trim() : "";
  const positionList = uniqueLabels(positions);
  const local = uniqueLabels(localLocations, locations);
  const overseas = uniqueLabels(overseasLocations);
  const statusText = text(status);
  const addressText = text(address);

  const bioState = stateOf(Boolean(bioText), isOwner);
  const rowB = [
    { key: "positions", state: stateOf(positionList.length > 0, isOwner) },
    { key: "status", state: stateOf(Boolean(statusText), isOwner) },
  ].filter((col) => col.state !== "absent");
  const rowC = [{ key: "address", state: stateOf(Boolean(addressText), isOwner) }].filter((col) => col.state !== "absent");
  const rowD = [{ key: "locations", state: stateOf(local.length + overseas.length > 0, isOwner) }].filter(
    (col) => col.state !== "absent"
  );

  return {
    bio: { text: bioText, state: bioState },
    positions: positionList,
    status: statusText,
    address: addressText,
    locations: [...local, ...overseas],
    localLocations: local,
    overseasLocations: overseas,
    rowB,
    rowC,
    rowD,
    // Nothing to show to this viewer: the whole card is left out.
    hidden: bioState === "absent" && rowB.length === 0 && rowC.length === 0 && rowD.length === 0,
  };
};
