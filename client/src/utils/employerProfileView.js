// Pure helpers for the company page a jobseeker sees (header, About, business
// address, owner and authorized person, job postings). The server sends only
// the allowed fields; these helpers decide which sections have data to show.

const clean = (value) => (typeof value === "string" ? value.trim() : "");

// The address as display lines: street, barangay, then "municipality, province".
export const addressLines = (address) => {
  if (!address || typeof address !== "object") return [];
  const place = [clean(address.municipality), clean(address.province)].filter(Boolean).join(", ");
  return [clean(address.street), clean(address.barangay), place].filter(Boolean);
};

// One line for the header: municipality and province only.
export const locationLine = (address) => {
  if (!address || typeof address !== "object") return "";
  return [clean(address.municipality), clean(address.province)].filter(Boolean).join(", ");
};

// Owner / president and authorized person: name and position only. A person with
// no name is dropped. The result is empty when neither has a name.
export const representativeRows = (profile) => {
  const rows = [];
  const owner = clean(profile?.owner?.name);
  if (owner) rows.push({ key: "owner", name: owner, position: "" });
  const authorized = clean(profile?.authorizedPerson?.name);
  if (authorized) rows.push({ key: "authorizedPerson", name: authorized, position: clean(profile.authorizedPerson.position) });
  return rows;
};

// Which cards render. Job postings always render (they have their own empty state).
export const jobseekerSections = (data) => ({
  about: Boolean(clean(data?.user?.companyDescription)),
  address: addressLines(data?.profile?.businessAddress).length > 0,
  representatives: representativeRows(data?.profile).length > 0,
  postings: true,
});

// What the postings list shows. "loading" only until the first answer, so an empty
// state never flashes while the first page is still coming.
export const postingsViewState = ({ status, items, loadedOnce }) => {
  if (status === "error") return "error";
  if (status === "loading" && !loadedOnce) return "loading";
  return Array.isArray(items) && items.length > 0 ? "list" : "empty";
};
