// What another person sees of a jobseeker profile: the header plus three sections
// (About, Work experience, Skills). This reads only those parts of what the server
// returned (the server already removed everything else), so a field that is not meant
// for this view can never be shown by mistake, and an empty section is simply absent.

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const text = (value) => (typeof value === "string" ? value.trim() : "");
const unique = (items) => [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];

// municipality and province only, never a barangay or a street.
export const placeOf = (profile) => {
  const address = profile && typeof profile.presentAddress === "object" ? profile.presentAddress : null;
  if (!address) return "";
  return [address.municipality, address.province].map(text).filter(Boolean).join(", ");
};

// { about, skills, work, place, empty } from the response's user and profile.
// `empty` is true when none of the three sections has anything to show.
export const personSections = ({ user, profile } = {}) => {
  const u = user && typeof user === "object" ? user : {};
  const p = profile && typeof profile === "object" ? profile : {};
  const about = text(u.about);
  const skills = unique([...list(u.skills), ...list(p.skills)]);
  const work = list(p.workHistory)
    .filter((job) => job && typeof job === "object" && (text(job.position) || text(job.companyName)))
    .map((job) => ({
      position: text(job.position),
      companyName: text(job.companyName),
      dateFrom: text(job.dateFrom),
      dateTo: text(job.dateTo),
    }));
  return { about, skills, work, place: placeOf(p), empty: !about && skills.length === 0 && work.length === 0 };
};

// "2019-06" and "2021-01" -> "2019-06 to 2021-01"; one end only -> that end; none -> "".
export const jobDates = (job) => [job?.dateFrom, job?.dateTo].filter(Boolean).join(" to ");
