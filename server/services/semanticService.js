const { TfIdf, PorterStemmer, JaroWinklerDistance } = require('natural');
const { getAgeFromDate } = require('../utils/age');
const { parseLocationValue, normalizeLocationKey } = require('../utils/locationParser');

// ============================================================
// Text helpers
// ============================================================
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// null / undefined / "" → null (field not set). Guards against Number(null) === 0
// silently reading an unset numeric requirement as a real "0" bound.
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dedupeNormalized(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((value) => {
    const n = normalizeText(value);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  });
  return out;
}

// Filler words that shouldn't drive token-overlap similarity.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'at',
  'by', 'is', 'are', 'be', 'experience', 'experienced', 'year', 'years',
  'minimum', 'least', 'required', 'preferred', 'strong', 'good', 'excellent',
  'knowledge', 'skills', 'skill', 'ability', 'proven', 'plus', 'etc',
  'including', 'related', 'field', 'work', 'working',
]);

// §C.2 — bestPhraseSimilarity() re-stems both sides on every comparison,
// inside a nested loop over (qualifications × applicant skills) × jobs, so
// the same short strings (skill names, job titles) get stemmed over and
// over within one request. The corpus is small and highly repetitive (a
// bounded vocabulary of skill/qualification phrases, not free user text),
// so a plain unbounded module-level cache is the right tradeoff here —
// unlike the tfidfCache below, which bounds itself because it stores much
// larger per-request ranking results, not short input strings.
const stemCache = new Map();
function contentStems(value) {
  const key = String(value ?? '');
  const cached = stemCache.get(key);
  if (cached) return cached;
  const stems = tokenize(key)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => PorterStemmer.stem(token));
  stemCache.set(key, stems);
  return stems;
}

// ============================================================
// Skill aliases — local job-market synonyms. Matching is bidirectional:
// two terms match if they land in the same group.
// ============================================================
const SKILL_ALIAS_GROUPS = [
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['microsoft excel', 'ms excel', 'excel', 'spreadsheets'],
  ['microsoft word', 'ms word', 'word processing'],
  ['microsoft powerpoint', 'ms powerpoint', 'powerpoint'],
  ['microsoft office', 'ms office', 'office productivity', 'office applications'],
  ['cashiering', 'cashier', 'cash handling', 'point of sale', 'pos operation'],
  ['bookkeeping', 'book keeping', 'accounting', 'accounts', 'ledger'],
  ['customer service', 'customer support', 'customer care', 'client service'],
  ['food preparation', 'food prep', 'food handling', 'food service'],
  ['housekeeping', 'house keeping', 'room attendant', 'room keeping'],
  ['driving', 'professional driver', 'driver', 'vehicle operation'],
  ['electrical installation', 'electrician', 'electrical wiring', 'electrical maintenance'],
  ['welding', 'welder', 'smaw', 'arc welding'],
  ['carpentry', 'carpenter', 'woodworking'],
  ['masonry', 'mason', 'concreting', 'plastering'],
  ['plumbing', 'plumber', 'pipefitting'],
  ['sales', 'selling', 'sales representative', 'sales associate'],
  ['data entry', 'encoding', 'data encoder', 'data encoding'],
  ['caregiving', 'care giving', 'caregiver', 'nursing aide', 'nursing assistant'],
  ['teaching', 'tutoring', 'instruction', 'lecturing'],
  ['communication', 'communication skills', 'oral communication', 'verbal communication'],
  ['computer literacy', 'computer literate', 'basic computer', 'computer skills'],
  ['inventory management', 'inventory', 'stock management', 'stock keeping'],
  ['bartending', 'bartender', 'mixology'],
  ['cooking', 'cook', 'culinary'],
  ['first aid', 'basic life support', 'bls', 'cpr'],
];

const ALIAS_LOOKUP = (() => {
  const map = new Map();
  SKILL_ALIAS_GROUPS.forEach((group, index) => {
    group.forEach((term) => map.set(normalizeText(term), index));
  });
  return map;
})();

function skillsAreAlias(a, b) {
  const ga = ALIAS_LOOKUP.get(normalizeText(a));
  const gb = ALIAS_LOOKUP.get(normalizeText(b));
  return ga !== undefined && ga === gb;
}

// Similarity between one required phrase and one candidate phrase:
// 1 for an exact / alias match, partial for stemmed-token overlap, and a
// small amount of credit for a very close fuzzy string match (typos).
function bestPhraseSimilarity(required, candidate) {
  const r = normalizeText(required);
  const c = normalizeText(candidate);
  if (!r || !c) return 0;
  if (r === c || skillsAreAlias(r, c)) return 1;

  const rStems = new Set(contentStems(r));
  const cStems = new Set(contentStems(c));
  if (rStems.size && cStems.size) {
    let shared = 0;
    rStems.forEach((stem) => {
      if (cStems.has(stem)) shared += 1;
    });
    if (shared > 0) {
      // Credit toward the shorter side so "forklift" fully covers
      // "forklift operation".
      const coverage = shared / Math.min(rStems.size, cStems.size);
      if (coverage >= 0.99) return 0.9;
      if (coverage >= 0.5) return 0.6;
      return 0.35;
    }
  }

  const jw = JaroWinklerDistance(r, c);
  return jw >= 0.92 ? 0.5 : 0;
}

function bestMatchAgainstList(required, list) {
  let best = 0;
  for (const entry of list) {
    const sim = bestPhraseSimilarity(required, entry);
    if (sim > best) best = sim;
    if (best === 1) break;
  }
  return best;
}

// ============================================================
// Qualification access
// ============================================================
function foldQualType(type) {
  const t = String(type || '').trim().toLowerCase();
  return t === 'other' ? 'skill' : t;
}

function qualsOfType(job, type) {
  if (!Array.isArray(job?.qualifications)) return [];
  return job.qualifications.filter(
    (q) => foldQualType(q?.type) === type && q?.value
  );
}

// ============================================================
// Applicant field extraction
// ============================================================
// §C.2 — "precompute per-applicant token sets once per request". The same
// applicant/seeker OBJECT (not just equal data — the identical reference) is
// scored against every job in a request: rankJobsBySkills() builds one
// `seeker` and reuses it across jobs.map(...); rankApplicantsByJob() reuses
// the same `job` across applicants.map(...), and both computeUnifiedScore()
// and computeChecklistMatch() independently re-derive these from scratch.
// Without this, a 50-job board recomputes the SAME applicant's skill list,
// credentials, education rank etc. 50+ times over for one request.
//
// A WeakMap keyed by the applicant object itself needs no manual
// invalidation or per-request setup: entries are only ever reachable for as
// long as the request's own applicant object is, and are garbage-collected
// along with it. `fn` must be pure given that object (every function below
// only reads from it), and must take exactly the applicant as its argument.
function memoizeByApplicant(fn) {
  const cache = new WeakMap();
  return (applicant) => {
    if (!applicant || typeof applicant !== 'object') return fn(applicant);
    if (cache.has(applicant)) return cache.get(applicant);
    const result = fn(applicant);
    cache.set(applicant, result);
    return result;
  };
}

const getApplicantSkills = memoizeByApplicant(function getApplicantSkills(applicant) {
  const profile = applicant?.profile || {};
  const user = applicant?.user || {};
  return dedupeNormalized([
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(user.skills) ? user.skills : []),
  ]);
});

const getApplicantTitles = memoizeByApplicant(function getApplicantTitles(applicant) {
  const profile = applicant?.profile || {};
  const user = applicant?.user || {};
  const recentPositions = Array.isArray(profile.workHistory)
    ? profile.workHistory.slice().reverse().slice(0, 3).map((w) => w?.position)
    : [];
  return dedupeNormalized([
    user.desiredJobTitle,
    ...(Array.isArray(profile.preferredOccupations) ? profile.preferredOccupations : []),
    ...recentPositions,
  ]);
});

const getApplicantCredentials = memoizeByApplicant(function getApplicantCredentials(applicant) {
  const profile = applicant?.profile || {};
  const out = [];
  (profile.professionalLicenses || []).forEach((l) => l?.name && out.push(l.name));
  (profile.eligibilities || []).forEach((e) => e?.name && out.push(e.name));
  (profile.vocationalTrainings || []).forEach((t) => {
    if (t?.course) out.push(t.course);
    if (t?.certificate) out.push(t.certificate);
  });
  // Skills sometimes carry a credential name ("NC II", "TESDA certified").
  (profile.skills || []).forEach((s) => out.push(s));
  return dedupeNormalized(out);
});

// ============================================================
// Education (ordinal)
// ============================================================
const EDUCATION_RANK = {
  'elementary graduate': 1,
  'high school graduate': 2,
  'senior high school graduate': 3,
  'vocational tesda': 4,
  vocational: 4,
  'college undergraduate': 5,
  'college graduate': 6,
  "master s degree": 7,
  master: 7,
  doctorate: 8,
};

function educationTextToRank(text) {
  const n = normalizeText(text);
  if (!n) return 0;
  if (EDUCATION_RANK[n]) return EDUCATION_RANK[n];
  if (/\b(phd|doctora|doctorate)\b/.test(n)) return 8;
  if (/master|\bmba\b|graduate studies/.test(n)) return 7;
  if (/\b(bachelor|baccalaureate|degree|licensed|bs|ba|ab)\b/.test(n)) return 6;
  if (/college level|college undergrad|undergraduate|some college/.test(n)) return 5;
  if (/\b(vocational|tesda|tech voc|technical vocational)\b|nc [iv]+/.test(n)) return 4;
  if (/senior high|\bshs\b|grade 1[12]|k ?12/.test(n)) return 3;
  if (/high school|\bhs\b|secondary/.test(n)) return 2;
  if (/elementary|primary/.test(n)) return 1;
  return 0;
}

const getApplicantEducationRank = memoizeByApplicant(function getApplicantEducationRank(applicant) {
  const user = applicant?.user || {};
  const profile = applicant?.profile || {};
  const ranks = [
    educationTextToRank(user.educationalAttainment),
    educationTextToRank(profile.educationalAttainment),
  ].filter((r) => r > 0);
  // A named course with a graduation year implies a completed college degree.
  if (profile.course && profile.yearGraduated) ranks.push(6);
  return ranks.length ? Math.max(...ranks) : 0;
});

function educationScore(job, applicant) {
  // Structured `minEducationLevel` is authoritative; any legacy free-text
  // `type:"education"` qualifications are still honored for older postings.
  const structuredRank = educationTextToRank(job?.minEducationLevel);
  const freeTextRank = Math.max(
    ...qualsOfType(job, 'education').map((q) => educationTextToRank(q.value)),
    0
  );
  const requiredRank = Math.max(structuredRank, freeTextRank);
  if (requiredRank === 0) return null; // no (parseable) education requirement

  const applicantRank = getApplicantEducationRank(applicant);
  if (applicantRank >= requiredRank) return 1;

  // "…or equivalent work experience" — meeting the experience bar substitutes
  // for the paper qualification.
  if (job?.educationOrEquivalentExperience) {
    const structuredYears = finiteOrNull(job?.minExperienceYears);
    const need = structuredYears && structuredYears > 0 ? structuredYears : 2;
    if (getApplicantExperienceYears(applicant) >= need) return 1;
  }

  if (applicantRank === 0) return 0;
  return clamp01(applicantRank / requiredRank);
}

// ============================================================
// Experience (ordinal band + work-history span)
// ============================================================
const EXPERIENCE_BAND_YEARS = {
  'fresh graduate': 0,
  'less than 1 year': 0.5,
  '1 3 years': 2,
  '3 5 years': 4,
  '5 years': 7, // "5+ years" normalizes to "5 years"
};

function bandToYears(text) {
  const n = normalizeText(text);
  if (n in EXPERIENCE_BAND_YEARS) return EXPERIENCE_BAND_YEARS[n];
  if (/fresh grad/.test(n)) return 0;
  if (/less than 1|under 1|no experience/.test(n)) return 0.5;
  return null;
}

function parseRequiredYears(text) {
  const n = normalizeText(text);
  const m = n.match(/(\d+)\s*(?:\d+\s*)?year/); // "3 years", "3 5 years", "2 year"
  if (m) return Number(m[1]);
  if (/fresh grad|entry level|no experience required/.test(n)) return 0;
  return null;
}

function parseLooseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s || /present|current|ongoing|now/i.test(s)) return null;
  if (/^\d{4}$/.test(s)) return new Date(Number(s), 0, 1);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yearsFromWorkHistory(workHistory) {
  if (!Array.isArray(workHistory) || !workHistory.length) return 0;
  let months = 0;
  workHistory.forEach((w) => {
    const from = parseLooseDate(w?.dateFrom);
    const to = w?.dateTo && !/present|current|ongoing|now/i.test(String(w.dateTo))
      ? parseLooseDate(w.dateTo)
      : new Date();
    if (from && to && to > from) {
      months += (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    }
  });
  return Math.max(0, months / 12);
}

const getApplicantExperienceYears = memoizeByApplicant(function getApplicantExperienceYears(applicant) {
  const user = applicant?.user || {};
  const profile = applicant?.profile || {};
  let band = bandToYears(user.workExperience);
  if (band === null) band = bandToYears(profile.workExperience);
  const history = yearsFromWorkHistory(profile.workHistory);
  return band === null ? history : Math.max(history, band);
});

function experienceScore(job, applicant) {
  const structuredYears = finiteOrNull(job?.minExperienceYears);
  const hasStructured = structuredYears !== null;

  const freeText = qualsOfType(job, 'experience');
  const parsed = freeText.map((q) => parseRequiredYears(q.value));
  const anyParseable = parsed.some((y) => y !== null);

  if (!hasStructured && !freeText.length) return null; // experience not a factor

  const applicantYears = getApplicantExperienceYears(applicant);

  if (!hasStructured && !anyParseable) {
    // Free-text requirement with no readable number — credit real history
    // rather than zeroing an otherwise-strong candidate.
    if (applicantYears >= 1) return 1;
    if (applicantYears > 0) return 0.6;
    return 0.4;
  }

  const requiredYears = Math.max(
    hasStructured ? structuredYears : 0,
    ...parsed.map((y) => (y === null ? 0 : y)),
    0
  );
  if (requiredYears === 0) return 1; // fresh graduates welcome
  return applicantYears >= requiredYears ? 1 : clamp01(applicantYears / requiredYears);
}

// ============================================================
// Skills
// ============================================================
function skillCoverageScore(job, applicantSkills) {
  const all = qualsOfType(job, 'skill');
  if (!all.length) return null;
  const required = all.filter((q) => q.optional !== true);
  const preferred = all.filter((q) => q.optional === true);
  if (!applicantSkills.length) return 0;

  const sumMatches = (list) =>
    list.reduce((sum, q) => sum + bestMatchAgainstList(q.value, applicantSkills), 0);

  // Required skills carry full weight; "nice to have" skills carry 0.4.
  const totalWeight = required.length + preferred.length * 0.4;
  if (totalWeight === 0) return null;
  const got = sumMatches(required) + sumMatches(preferred) * 0.4;
  return clamp01(got / totalWeight);
}

// ============================================================
// Credentials (certification / license)
// ============================================================
function credentialScore(job, applicant) {
  const required = [
    ...qualsOfType(job, 'certification'),
    ...qualsOfType(job, 'license'),
  ].filter((q) => q.optional !== true);
  if (!required.length) return null;
  const held = getApplicantCredentials(applicant);
  if (!held.length) return 0;
  const matched = required.reduce(
    (sum, q) => sum + bestMatchAgainstList(q.value, held),
    0
  );
  return clamp01(matched / required.length);
}

// ============================================================
// Title / occupation
// ============================================================
function titleScore(job, applicant) {
  const jobTitle = normalizeText(job?.title);
  if (!jobTitle) return null;
  const titles = getApplicantTitles(applicant);
  if (!titles.length) return null;

  const jobStems = new Set(contentStems(jobTitle));
  if (!jobStems.size) return null;

  let best = 0;
  for (const t of titles) {
    if (t === jobTitle) return 1;
    const tStems = new Set(contentStems(t));
    if (!tStems.size) continue;
    let shared = 0;
    jobStems.forEach((stem) => {
      if (tStems.has(stem)) shared += 1;
    });
    let sim = shared / jobStems.size;
    if (sim < 1) {
      const jw = JaroWinklerDistance(jobTitle, t);
      sim = Math.max(sim, jw >= 0.9 ? 0.7 : 0);
    }
    if (sim > best) best = sim;
  }
  return clamp01(best);
}

// ============================================================
// Industry
// ============================================================
// A job can be tagged with more than one industry — returns the normalized,
// deduped list (never a bare string), falling back to the employer's own
// industry only when the job itself has none. Tolerates a not-yet-migrated
// document where `industry` is still a plain string.
function resolveJobIndustries(job) {
  const raw = Array.isArray(job?.industry) ? job.industry : [job?.industry];
  const normalized = dedupeNormalized(raw);
  if (normalized.length) return normalized;
  const employerIndustry = normalizeText(job?.employer?.industry);
  return employerIndustry ? [employerIndustry] : [];
}

// Job-board side: does the applicant's stated industry preference line up
// with any industry this job (or its employer) sits in? A job tagged with
// several industries isn't penalized or boosted for breadth here — it
// scores on whether there's a hit at all, same as a single-industry job.
function industryAffinityScore(job, applicant) {
  const jobIndustries = resolveJobIndustries(job);
  if (!jobIndustries.length) return null;
  const preferred = dedupeNormalized(applicant?.profile?.preferredIndustries || []);
  if (!preferred.length) return null; // no signal — skip, don't penalize
  if (jobIndustries.some((ind) => preferred.includes(ind))) return 1;
  if (jobIndustries.every((ind) => ind === 'others')) return 0.4;
  return 0.25;
}

// Employer-side: a stated preference tells an employer little about fit —
// it rewards ticking a box, not relevant background — and would otherwise
// quietly penalise anyone who left preferredIndustries blank (common on
// fresh NSRP profiles). Score instead from what the applicant has actually
// done: job-history company/position text and vocational-training course
// names, matched against the vacancy's industry by stemmed token overlap.
// A stated preference still counts, but only as a small bonus on top of a
// real background signal — never as the whole dimension on its own.
function industryBackgroundScore(job, applicant) {
  const jobIndustries = resolveJobIndustries(job);
  if (!jobIndustries.length) return null;

  const profile = applicant?.profile || {};
  const workHistory = Array.isArray(profile.workHistory) ? profile.workHistory : [];
  const vocationalTrainings = Array.isArray(profile.vocationalTrainings) ? profile.vocationalTrainings : [];
  const backgroundText = [
    ...workHistory.map((w) => `${w?.companyName || ''} ${w?.position || ''}`),
    ...vocationalTrainings.map((t) => t?.course || ''),
  ].join(' ').trim();

  // No job history and no training on file — there is nothing to infer
  // industry fit from. Don't let a bare stated preference carry this
  // dimension on the employer side; that is the exact behaviour being fixed.
  if (!backgroundText) return null;

  const backgroundStems = new Set(contentStems(backgroundText));

  // Best match across the job's industries, not a blended average — a job
  // tagged with several industries should score as well as a job tagged
  // with just the one that actually matches, not be diluted by the others.
  let bestBackgroundScore = 0;
  let hadUsableIndustry = false;
  for (const jobIndustry of jobIndustries) {
    const industryStems = contentStems(jobIndustry);
    if (!industryStems.length) continue;
    hadUsableIndustry = true;
    const shared = industryStems.filter((stem) => backgroundStems.has(stem)).length;
    const score = shared > 0 ? clamp01(shared / industryStems.length) : 0;
    if (score > bestBackgroundScore) bestBackgroundScore = score;
  }
  if (!hadUsableIndustry) return null;

  const preferred = dedupeNormalized(profile.preferredIndustries || []);
  if (!preferred.length) return bestBackgroundScore;

  const preferenceBonus = jobIndustries.some((ind) => preferred.includes(ind)) ? 0.15 : 0;
  return clamp01(bestBackgroundScore + preferenceBonus);
}

// Picks which industry scorer feeds the `industry` dimension: an explicit
// numeric override (the job board's preference-derived score, already
// computed by the caller) always wins; otherwise 'background' (employer
// path, §B.2) or 'preference' (job-board path, default) selects the scorer.
function resolveIndustryScore(job, applicant, industryScoreOverride, industryMode) {
  if (industryScoreOverride !== null && industryScoreOverride !== undefined) {
    return clamp01(industryScoreOverride);
  }
  return industryMode === 'background'
    ? industryBackgroundScore(job, applicant)
    : industryAffinityScore(job, applicant);
}

// ============================================================
// Location
// ============================================================
// `job.location` is free text but not arbitrary — LocationSelect.jsx builds
// it as `[barangay, city, province, region].filter(Boolean).join(", ")`.
// parseLocationValue() (ported from the client — see server/utils/
// locationParser.js) recovers the structured components so this dimension
// compares parsed components, never raw strings.
function hasAnyLocationComponent(parsed) {
  return Boolean(parsed && (parsed.city || parsed.province || parsed.region || parsed.barangay));
}

function sameLocationPart(a, b) {
  return Boolean(a && b && normalizeLocationKey(a) === normalizeLocationKey(b));
}

// Graded, not binary: same municipality/city → 1.0; same province → 0.6;
// same region → 0.3; neither side's gazetteer component lines up → 0.1.
// Returns null when `candidateParsed` itself has no usable component (an
// empty/unparseable preferred-location entry, or a blank present address) —
// that is "no data", not "lowest tier".
function locationMatchLevel(jobParsed, candidateParsed) {
  if (!hasAnyLocationComponent(candidateParsed)) return null;
  if (sameLocationPart(jobParsed.city, candidateParsed.city)) return 1.0;
  if (sameLocationPart(jobParsed.province, candidateParsed.province)) return 0.6;
  if (sameLocationPart(jobParsed.region, candidateParsed.region)) return 0.3;
  return 0.1;
}

// Checks the applicant's STATED location preferences first (an explicit
// preference outranks where they happen to live today), falling back to
// their present address. Null when the vacancy's location can't be parsed,
// the vacancy is remote (physical distance is irrelevant to a remote role
// and shouldn't penalise it), or the applicant has neither a usable
// preference nor a usable address on file.
function locationScore(job, applicant) {
  const jobWorkNature = normalizeText(job?.workNature);
  const jobIsRemote = jobWorkNature === 'remote' || normalizeText(job?.jobType) === 'remote';
  if (jobIsRemote) return null;

  const jobParsed = parseLocationValue(job?.location);
  if (!hasAnyLocationComponent(jobParsed)) return null;

  const profile = applicant?.profile || {};
  const preferredLocal = Array.isArray(profile.preferredWorkLocationLocal) ? profile.preferredWorkLocationLocal : [];

  let best = null;
  preferredLocal.forEach((pref) => {
    const level = locationMatchLevel(jobParsed, parseLocationValue(pref));
    if (level !== null && (best === null || level > best)) best = level;
  });
  if (best !== null) return best;

  const present = profile.presentAddress || {};
  const presentParsed = {
    barangay: present.barangay || '',
    city: present.municipality || '',
    province: present.province || '',
    region: present.region || '',
  };
  return locationMatchLevel(jobParsed, presentParsed);
}

// ============================================================
// Employment type (job type + work nature, blended into one axis)
// ============================================================
// Two schema traps this dimension must not fall into:
//  - `workNature` case differs by side: vacancy stores lowercase
//    (remote/onsite/hybrid), jobseeker stores Capitalised
//    (Remote/Onsite/Hybrid). Compare case-insensitively.
//  - `JobVacancy.jobType` includes "Remote", but `preferredJobTypes` does
//    NOT (only Full-time/Part-time/Contract/Temporary/Internship) — a
//    Remote vacancy can never appear in that list. Treat jobType "Remote"
//    purely as a workNature signal and never compare it against
//    preferredJobTypes.
function normalizeWorkNature(value) {
  const n = normalizeText(value);
  if (/remote/.test(n)) return 'remote';
  if (/onsite|on site/.test(n)) return 'onsite';
  if (/hybrid/.test(n)) return 'hybrid';
  return '';
}

function employmentTypeScore(job, applicant) {
  const profile = applicant?.profile || {};
  const preferredJobTypes = Array.isArray(profile.preferredJobTypes) ? profile.preferredJobTypes : [];
  const preferredWorkNature = Array.isArray(profile.preferredWorkNature) ? profile.preferredWorkNature : [];

  const jobTypeRaw = job?.jobType || '';
  const jobTypeIsRemote = normalizeText(jobTypeRaw) === 'remote';

  let jobTypeMatch = null;
  if (!jobTypeIsRemote && jobTypeRaw && preferredJobTypes.length > 0) {
    jobTypeMatch = preferredJobTypes.some((t) => normalizeText(t) === normalizeText(jobTypeRaw)) ? 1 : 0;
  }

  const jobNature = jobTypeIsRemote ? 'remote' : normalizeWorkNature(job?.workNature);
  let natureMatch = null;
  if (jobNature && preferredWorkNature.length > 0) {
    natureMatch = preferredWorkNature.some((n) => normalizeWorkNature(n) === jobNature) ? 1 : 0;
  }

  const parts = [jobTypeMatch, natureMatch].filter((v) => v !== null);
  if (!parts.length) return null;
  return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

// ============================================================
// Age eligibility (hard gate)
// ============================================================
// `known` is false when the applicant has no usable date of birth — the caller
// must not penalize an unknown age, only an age that is genuinely out of range.
function ageEligibility(job, applicant) {
  const min = finiteOrNull(job?.minAge);
  const max = finiteOrNull(job?.maxAge);
  if (min === null && max === null) {
    return { eligible: true, known: true, constrained: false };
  }
  const dob = applicant?.user?.dateOfBirth ?? applicant?.profile?.dateOfBirth;
  const age = getAgeFromDate(dob);
  if (age === null) return { eligible: true, known: false, constrained: true };
  if (min !== null && age < min) return { eligible: false, known: true, constrained: true };
  if (max !== null && age > max) return { eligible: false, known: true, constrained: true };
  return { eligible: true, known: true, constrained: true };
}

// ============================================================
// Language proficiency
// ============================================================
function matchLanguageKey(proficiency, language) {
  const n = normalizeText(language);
  const keys = Object.keys(proficiency || {});
  const exact = keys.find((k) => normalizeText(k) === n);
  if (exact) return exact;
  if (/tagalog|filipino/.test(n)) return keys.find((k) => /filipino/i.test(k)) || null;
  if (/english/.test(n)) return keys.find((k) => /english/i.test(k)) || null;
  return keys.find((k) => /other/i.test(k)) || null;
}

// Per-requirement boolean version of languageScore()'s matching rule, for
// the checklist breakdown below (which needs a yes/no per language, not an
// aggregate fraction).
function isLanguageRequirementMet(req, proficiency) {
  if (!proficiency || typeof proficiency !== 'object') return false;
  const MODES = ['read', 'write', 'speak', 'understand'];
  const key = matchLanguageKey(proficiency, req.language);
  const have = key ? proficiency[key] : null;
  if (!have) return false;
  const specificModes = MODES.filter((mode) => req[mode]);
  if (specificModes.length) return specificModes.every((mode) => have[mode]);
  return MODES.some((mode) => have[mode]);
}

function languageScore(job, applicant) {
  const reqs = Array.isArray(job?.languageRequirements)
    ? job.languageRequirements.filter((l) => l && l.language && l.required !== false)
    : [];
  if (!reqs.length) return null;

  const proficiency = applicant?.profile?.languageProficiency;
  // No language section filled in at all — treat as unknown, not a zero. Many
  // NSRP profiles leave it blank and shouldn't be pushed down for it.
  if (!proficiency || typeof proficiency !== 'object') return null;
  const anyFilled = Object.values(proficiency).some(
    (v) => v && typeof v === 'object' && ['read', 'write', 'speak', 'understand'].some((m) => v[m])
  );
  if (!anyFilled) return null;

  const MODES = ['read', 'write', 'speak', 'understand'];
  let total = 0;
  let got = 0;
  reqs.forEach((req) => {
    const key = matchLanguageKey(proficiency, req.language);
    const have = key ? proficiency[key] : null;
    const specificModes = MODES.filter((mode) => req[mode]);
    if (specificModes.length) {
      specificModes.forEach((mode) => {
        total += 1;
        if (have && have[mode]) got += 1;
      });
    } else {
      // "required" with no specific mode ticked = any proficiency in it.
      total += 1;
      if (have && MODES.some((mode) => have[mode])) got += 1;
    }
  });
  return total === 0 ? null : clamp01(got / total);
}

// ============================================================
// Salary compatibility
// ============================================================
function salaryCompatibilityScore(job, applicant) {
  const jobMin = finiteOrNull(job?.salaryMin);
  const jobMax = finiteOrNull(job?.salaryMax);
  if (jobMin === null && jobMax === null) return null;

  const profile = applicant?.profile || {};
  const user = applicant?.user || {};
  const expMin = finiteOrNull(profile.expectedSalaryMin ?? user.expectedSalaryMin);
  const expMax = finiteOrNull(profile.expectedSalaryMax ?? user.expectedSalaryMax);
  if (expMin === null && expMax === null) return null;

  const jLo = jobMin !== null ? jobMin : jobMax;
  const jHi = jobMax !== null ? jobMax : jobMin;
  const eLo = expMin !== null ? expMin : expMax;
  const eHi = expMax !== null ? expMax : expMin;

  if (jLo <= eHi && eLo <= jHi) return 1;

  const gap = jHi < eLo ? eLo - jHi : jLo - eHi;
  const scale = eHi || eLo || 1;
  return Math.max(0, 1 - gap / scale);
}

// ============================================================
// Checklist match — a simpler, literal "how many requirements do you meet"
// score for the jobseeker-facing match panel (job cards / job detail). This
// is deliberately separate from computeUnifiedScore()/DEFAULT_DIMENSION_WEIGHTS
// below: that fuzzy, multi-dimension engine drives search RANKING (title,
// industry, salary fit, etc. all contribute), while this one answers a
// narrower, literal question — "of this job's stated requirements, which
// ones does this applicant actually meet?" — using points: each required
// qualification is worth 3, each preferred one 1, plus 2 for meeting the
// education bar and 2 for meeting the experience bar (only when the job
// actually sets them). It does not affect ranking/search order.
// ============================================================
const CHECKLIST_REQUIRED_POINTS = 3;
const CHECKLIST_PREFERRED_POINTS = 1;
const CHECKLIST_EDUCATION_POINTS = 2;
const CHECKLIST_EXPERIENCE_POINTS = 2;

// How confident a fuzzy match needs to be before a qualification counts as
// "met" — bestPhraseSimilarity() returns 1 for an exact/alias hit, 0.9/0.6
// for strong/partial stemmed overlap, and 0.5 for a close typo-level match.
// 0.6 draws the line at "partial overlap or better", excluding only the
// weak 0.5 typo-distance credit.
const CHECKLIST_MATCH_THRESHOLD = 0.6;

function checklistTier(percent) {
  if (percent >= 85) return 'Strong';
  if (percent >= 60) return 'Good';
  if (percent >= 35) return 'Partial';
  return 'Low';
}

// Returns null when the job states no requirements at all (nothing to
// score), or `{ percent, tier, metMustHaves, totalMustHaves, missingRequired,
// disqualified? }` otherwise. `missingRequired` lists only REQUIRED
// qualifications the applicant doesn't meet, in posting order, for the "you
// meet X of Y must-haves / missing: ..." UI.
function computeChecklistMatch(job, applicant) {
  const age = ageEligibility(job, applicant);
  if (!age.eligible) {
    return {
      percent: 0, tier: 'Low', metMustHaves: 0, totalMustHaves: 0, missingRequired: [],
      items: [], basicEligibility: { education: null, experience: null, languages: [] },
      disqualified: 'age',
    };
  }

  const applicantSkills = getApplicantSkills(applicant);
  const applicantCredentials = getApplicantCredentials(applicant);
  const applicantEducationRank = getApplicantEducationRank(applicant);
  const applicantExperienceYears = getApplicantExperienceYears(applicant);

  const quals = Array.isArray(job?.qualifications)
    ? job.qualifications.filter((q) => q && q.value)
    : [];

  let maxPoints = 0;
  let gotPoints = 0;
  let totalMustHaves = 0;
  let metMustHaves = 0;
  const missingRequired = [];
  // Every qualification with its own met/missing flag — richer than
  // missingRequired, for UI that needs to show the full list (met and
  // unmet, required and preferred alike), not just what's missing.
  const items = [];

  quals.forEach((q) => {
    const type = foldQualType(q.type);
    const isRequired = q.optional !== true;
    const points = isRequired ? CHECKLIST_REQUIRED_POINTS : CHECKLIST_PREFERRED_POINTS;
    maxPoints += points;
    if (isRequired) totalMustHaves += 1;

    let met = false;
    if (type === 'skill') {
      met = bestMatchAgainstList(q.value, applicantSkills) >= CHECKLIST_MATCH_THRESHOLD;
    } else if (type === 'certification' || type === 'license') {
      met = bestMatchAgainstList(q.value, applicantCredentials) >= CHECKLIST_MATCH_THRESHOLD;
    } else if (type === 'education') {
      const requiredRank = educationTextToRank(q.value);
      met = requiredRank === 0 ? true : applicantEducationRank >= requiredRank;
    } else if (type === 'experience') {
      const requiredYears = parseRequiredYears(q.value);
      met = requiredYears === null ? applicantExperienceYears >= 1 : applicantExperienceYears >= requiredYears;
    } else {
      met = bestMatchAgainstList(q.value, applicantSkills) >= CHECKLIST_MATCH_THRESHOLD;
    }

    items.push({ type, value: q.value, optional: !isRequired, met });

    if (met) {
      gotPoints += points;
      if (isRequired) metMustHaves += 1;
    } else if (isRequired) {
      missingRequired.push({ type, value: q.value });
    }
  });

  // Basic-eligibility breakdown — informational rows for the jobseeker-facing
  // "Requirements" card (education/experience/each language), separate from
  // the required/preferred qualification list above. Education and
  // experience still earn points per the formula; languages are shown for
  // completeness but aren't weighted into the percent (no point value was
  // specified for them).
  let educationRow = null;
  const structuredEdRank = educationTextToRank(job?.minEducationLevel);
  if (structuredEdRank > 0) {
    maxPoints += CHECKLIST_EDUCATION_POINTS;
    const metEducation = Boolean(
      applicantEducationRank >= structuredEdRank ||
      (job?.educationOrEquivalentExperience &&
        applicantExperienceYears >= (finiteOrNull(job?.minExperienceYears) || 2))
    );
    if (metEducation) gotPoints += CHECKLIST_EDUCATION_POINTS;
    educationRow = { label: job.minEducationLevel, met: metEducation };
  }

  let experienceRow = null;
  const structuredExpYears = finiteOrNull(job?.minExperienceYears);
  if (structuredExpYears !== null && structuredExpYears > 0) {
    maxPoints += CHECKLIST_EXPERIENCE_POINTS;
    const metExperience = applicantExperienceYears >= structuredExpYears;
    if (metExperience) gotPoints += CHECKLIST_EXPERIENCE_POINTS;
    experienceRow = { label: `${structuredExpYears} year${structuredExpYears === 1 ? '' : 's'}`, met: metExperience };
  }

  const languageProficiency = applicant?.profile?.languageProficiency;
  const languageRows = (Array.isArray(job?.languageRequirements) ? job.languageRequirements : [])
    .filter((l) => l && l.language && l.required !== false)
    .map((req) => ({ language: req.language, met: isLanguageRequirementMet(req, languageProficiency) }));

  if (maxPoints === 0) return null;

  const percent = Math.round(clamp01(gotPoints / maxPoints) * 100);
  return {
    percent,
    tier: checklistTier(percent),
    metMustHaves,
    totalMustHaves,
    missingRequired,
    items,
    basicEligibility: { education: educationRow, experience: experienceRow, languages: languageRows },
  };
}

// ============================================================
// Unified scoring
// ============================================================
// Default per-dimension weights — the platform fallback used whenever no
// configured weight profile applies (see
// markdowns/EMPLOYER_RATINGS_AND_MATCH_CONFIG_PLAN.md Part 2 for the
// employer/admin-configurable layer this is the base case for; not built
// yet). `computeUnifiedScore()` takes `weights` as a parameter rather than
// closing over this constant specifically so that layer can supply its own
// table without touching the scoring function itself.
//
// Derivation of this table (ten dimensions, sums to exactly 1.00):
//   - Started from the eight original weights (skills .28, title .17,
//     experience .14, education .10, credentials .07, industry .12,
//     language .05, salary .07).
//   - Carved out weight for the two new dimensions below (location,
//     employmentType) by trimming every existing dimension proportionally.
//   - Pushed `title` down further, into the ~0.10-0.12 band — it is a weak
//     proxy for skills (stemmed-token overlap on free-text job titles) and
//     was weighted nearly as heavily as skills itself — with that reduction
//     credited entirely to `skills`.
// `location` is deliberately kept modest (not the largest of the two new
// dimensions by much): a high weighting there would rank substantially on
// where someone lives, which correlates with characteristics unrelated to
// the job. A hard cap on how high this can be configured belongs to the
// admin-bounds layer above, once it exists — this default is the interim
// safeguard.
//
// Fairness invariant: `JobseekerProfile` also carries `disability`,
// `civilStatus`, `religion`, `height`, `weight`, `is4psBeneficiary`, `isOfw`.
// None of them is read anywhere in this file and none should ever become a
// dimension here.
const DEFAULT_DIMENSION_WEIGHTS = {
  skills: 0.27,
  title: 0.11,
  experience: 0.12,
  education: 0.09,
  credentials: 0.06,
  industry: 0.10,
  language: 0.04,
  salary: 0.06,
  location: 0.09,
  employmentType: 0.06,
};

// Returns { score, breakdown, coverage } — plus `disqualified: 'age'` when the
// applicant falls outside the job's age band — or null when no dimension had
// usable data on either side (the caller may then fall back to TF‑IDF).
// `industryScoreOverride` (0..1) lets the job-board path supply its own
// preference-based industry score instead of a dimension scorer below.
// `weights` defaults to the platform table above; a future configurable
// layer passes its own resolved weights here instead.
// `industryMode` picks the industry scorer when no override is given:
// 'preference' (default, job board — does this match what the applicant
// said they want?) or 'background' (employer path, §B.2 — does the
// applicant's actual job/training history suggest industry fit?).
function computeUnifiedScore(job, applicant, industryScoreOverride = null, weights = DEFAULT_DIMENSION_WEIGHTS, industryMode = 'preference') {
  const age = ageEligibility(job, applicant);
  const applicantSkills = getApplicantSkills(applicant);

  const dims = {
    skills: skillCoverageScore(job, applicantSkills),
    title: titleScore(job, applicant),
    experience: experienceScore(job, applicant),
    education: educationScore(job, applicant),
    credentials: credentialScore(job, applicant),
    industry: resolveIndustryScore(job, applicant, industryScoreOverride, industryMode),
    language: languageScore(job, applicant),
    salary: salaryCompatibilityScore(job, applicant),
    location: locationScore(job, applicant),
    employmentType: employmentTypeScore(job, applicant),
  };

  // P0-01 fix: `weights` may arrive as fractions summing to 1
  // (DEFAULT_DIMENSION_WEIGHTS) or as the configurable-weights layer's
  // integer percentages summing to 100 (server/utils/matchWeights.js
  // CODE_FALLBACK_WEIGHTS, or a resolved MatchWeightProfile) — the floor
  // divisor below is calibrated for a 0-1 scale, so normalize whatever
  // scale came in to fractions summing to 1 right here, the one place
  // every scoring entry point funnels through. No-op for inputs that
  // already sum to 1.
  const rawTotal = Object.values(weights).reduce((sum, w) => sum + (Number(w) || 0), 0);
  const normalizedWeights = {};
  if (rawTotal > 0) {
    for (const key of Object.keys(weights)) {
      normalizedWeights[key] = (Number(weights[key]) || 0) / rawTotal;
    }
  }
  const effectiveWeights = rawTotal > 0 ? normalizedWeights : weights;

  let weightedSum = 0;
  let weightSum = 0;
  const breakdown = {};
  for (const key of Object.keys(effectiveWeights)) {
    const value = dims[key];
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const weight = effectiveWeights[key];
    weightedSum += value * weight;
    weightSum += weight;
    breakdown[key] = Number(value.toFixed(3));
  }

  // Age is a hard gate: outside the band, the candidate can't hold the job.
  if (!age.eligible) {
    return {
      score: 0,
      breakdown: { ...breakdown, ageEligible: false },
      coverage: Number(weightSum.toFixed(2)),
      disqualified: 'age',
    };
  }
  if (age.constrained && !age.known) breakdown.ageUnknown = true;

  if (weightSum === 0) return null;

  // Lightly floor the divisor so a match resting only on a low-weight axis
  // (salary or industry alone) is damped, without crushing a legitimate
  // skills-led match. `coverage` is returned so the UI can show how much of
  // the picture was actually evaluated.
  const score = weightedSum / Math.max(weightSum, 0.2);
  return { score: clamp01(score), breakdown, coverage: Number(weightSum.toFixed(2)) };
}

// ============================================================
// TF‑IDF fallback (only when no structured signal exists at all)
// ============================================================
function buildJobText(job) {
  const parts = [
    job.title || '',
    job.description || '',
    job.responsibilities || '',
    Array.isArray(job.industry) ? job.industry.join(' ') : (job.industry || ''),
  ];
  if (Array.isArray(job.qualifications)) {
    parts.push(
      job.qualifications
        .map((q) => (typeof q === 'string' ? q : q?.value))
        .filter(Boolean)
        .join(' ')
    );
  }
  if (job.requirements) parts.push(job.requirements);
  return parts.join(' ').toLowerCase();
}

function buildApplicantText(applicant) {
  const profile = applicant.profile || {};
  const user = applicant.user || {};
  const skills = [
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(user.skills) ? user.skills : []),
  ];
  const positions = Array.isArray(profile.workHistory)
    ? profile.workHistory.map((w) => w?.position).filter(Boolean)
    : [];
  const parts = [
    user.name || '',
    user.about || '',
    user.desiredJobTitle || '',
    (profile.preferredOccupations || []).join(' '),
    positions.join(' '),
    skills.join(' '),
    profile.workExperience || user.workExperience || '',
    profile.educationalAttainment || user.educationalAttainment || '',
    profile.course || '',
  ];
  return parts.join(' ').toLowerCase();
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key in vecA) {
    if (vecB[key]) dot += vecA[key] * vecB[key];
    normA += vecA[key] * vecA[key];
  }
  for (const key in vecB) normB += vecB[key] * vecB[key];
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Builds the full sorted TF‑IDF ranking (no pagination slice) — the actually
// expensive step: one addDocument() + listTerms() per job/candidate, plus an
// O(n) cosine-similarity pass. Pulled out of tfidfRank() so the cache wrapper
// below can store and reuse this result across requests.
function computeTfidfRanking(job, items) {
  const tfidf = new TfIdf();
  tfidf.addDocument(buildJobText(job));
  items.forEach((item) => tfidf.addDocument(buildApplicantText(item)));

  const jobVector = {};
  tfidf.listTerms(0).forEach((term) => {
    jobVector[term.term] = term.tfidf;
  });

  const ranked = items.map((item, idx) => {
    const vec = {};
    tfidf.listTerms(idx + 1).forEach((term) => {
      vec[term.term] = term.tfidf;
    });
    return {
      ...item,
      relevanceScore: parseFloat(cosineSimilarity(jobVector, vec).toFixed(4)),
      matchBreakdown: { method: 'tfidf' },
    };
  });
  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked;
}

// ------------------------------------------------------------------
// Result cache for the TF‑IDF fallback.
//
// This path is only reached when NO structured qualification data exists
// for any candidate — but on a busy job board or a popular vacancy's
// applicant list, that can mean the same expensive corpus rebuild running
// on every page view/poll for the same job and (near-)identical candidate
// set, causing CPU spikes under load for no new information.
//
// The cache key is a hash of the actual document text (buildJobText /
// buildApplicantText output) rather than an id + timestamp, so correctness
// doesn't depend on remembering to bump an "updatedAt" anywhere: if a job's
// description or a candidate's profile actually changes, the hashed text
// changes, the key changes, and the next request naturally recomputes.
// Hashing that text is itself far cheaper than the TF‑IDF indexing it lets
// us skip on a hit. TTL + a max entry count below are just a memory-hygiene
// backstop, not the correctness mechanism.
const crypto = require('crypto');
const TFIDF_CACHE_TTL_MS = 30 * 1000;
const TFIDF_CACHE_MAX_ENTRIES = 200;
const tfidfCache = new Map();

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function tfidfCacheKey(job, items) {
  const jobKey = hashText(buildJobText(job));
  const itemsKey = hashText(items.map((item) => buildApplicantText(item)).join(' '));
  return `${jobKey}:${items.length}:${itemsKey}`;
}

// Returns the FULL cached-or-computed ranking (no slicing) — callers apply
// their own filter/sort/slice afterwards via finalizeApplicantRanking() so
// the TF‑IDF fallback and the structured-score path share one
// post-processing step instead of each slicing independently.
function tfidfRank(job, items) {
  const key = tfidfCacheKey(job, items);
  const now = Date.now();
  const cached = tfidfCache.get(key);
  if (cached && now - cached.at < TFIDF_CACHE_TTL_MS) {
    return cached.ranked;
  }

  const ranked = computeTfidfRanking(job, items);

  if (tfidfCache.size >= TFIDF_CACHE_MAX_ENTRIES) {
    // Map preserves insertion order — evict the oldest entry.
    tfidfCache.delete(tfidfCache.keys().next().value);
  }
  tfidfCache.set(key, { ranked, at: now });

  return ranked;
}

// ============================================================
// Rankers
// ============================================================
function attachStructuredScore(item, res) {
  return {
    ...item,
    relevanceScore: res ? parseFloat(res.score.toFixed(4)) : 0,
    matchBreakdown: res
      ? { method: 'structured', coverage: res.coverage, ...res.breakdown }
      : { method: 'structured', coverage: 0 },
    ...(res && res.disqualified ? { disqualified: res.disqualified } : {}),
  };
}

// ---------- Applicants for a job (employer dashboard) ----------

// 'match' (default) — fuzzy relevanceScore, highest first.
// 'mustHaves' — literal must-have count from the checklist, highest first,
// tie-broken by relevanceScore so applicants meeting the same number of
// must-haves don't fall back to array order.
// 'date' — most recently applied first.
// 'name' — applicant name, A→Z.
const APPLICANT_SORTERS = {
  match: (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0),
  mustHaves: (a, b) => {
    const aMet = a.checklistMatch ? a.checklistMatch.metMustHaves : -1;
    const bMet = b.checklistMatch ? b.checklistMatch.metMustHaves : -1;
    if (bMet !== aMet) return bMet - aMet;
    return (b.relevanceScore || 0) - (a.relevanceScore || 0);
  },
  date: (a, b) => new Date(b.appliedAt || b.createdAt || 0) - new Date(a.appliedAt || a.createdAt || 0),
  name: (a, b) => {
    const an = String(a.user?.name || '').toLowerCase();
    const bn = String(b.user?.name || '').toLowerCase();
    return an.localeCompare(bn);
  },
};

// Mirrors the jobseeker-facing onlyMeetsRequired rule in rankJobsBySkills():
// a job that states no requirements always passes; an age-disqualified
// applicant never does, even if the job has no other requirements.
function meetsAllRequired(item) {
  const m = item.checklistMatch;
  if (!m || m.disqualified) return false;
  return m.totalMustHaves === 0 || m.metMustHaves === m.totalMustHaves;
}

function isAgeDisqualified(item) {
  return item.disqualified === 'age';
}

// Wraps a sorter so age-disqualified applicants always sort after everyone
// else, regardless of which criterion is active — a hard gate should never
// just blend into the middle of the list at whatever score: 0 happens to
// rank. Within each group (disqualified / not), the normal sort still runs.
function withDisqualifiedLast(sorter) {
  return (a, b) => {
    const aDq = isAgeDisqualified(a);
    const bDq = isAgeDisqualified(b);
    if (aDq !== bDq) return aDq ? 1 : -1;
    return sorter(a, b);
  };
}

// Attaches computeChecklistMatch() to every item, then applies the
// onlyMeetsRequired filter, sortBy ordering, and skip/limit slice — in that
// order, so `filteredTotal` reflects the set pagination actually counts
// against. Shared by the structured-score path and the TF‑IDF fallback below
// so neither one silently ships without a must-have checklist.
// `disqualifiedCount` is counted from the FULL set (before onlyMeetsRequired
// narrows it) — "N outside the age range" should describe every applicant to
// this job, not just whatever is left after an unrelated filter.
function finalizeApplicantRanking(job, items, options) {
  const { sortBy = 'match', onlyMeetsRequired = false, limit = 50, skip = 0 } = options;

  const withChecklist = items.map((item) => ({
    ...item,
    checklistMatch: computeChecklistMatch(job, item),
  }));

  const total = withChecklist.length;
  const disqualifiedCount = withChecklist.filter(isAgeDisqualified).length;
  const filtered = onlyMeetsRequired ? withChecklist.filter(meetsAllRequired) : withChecklist;
  const filteredTotal = filtered.length;

  const sorter = withDisqualifiedLast(APPLICANT_SORTERS[sortBy] || APPLICANT_SORTERS.match);
  const sorted = filtered.slice().sort(sorter);

  return { items: sorted.slice(skip, skip + limit), total, filteredTotal, disqualifiedCount };
}

function rankApplicantsByJob(job, applicants, options = {}) {
  const {
    limit = 50,
    skip = 0,
    industryScoreOverride = null,
    sortBy = 'match',
    onlyMeetsRequired = false,
    // §C.1 — the caller resolves the effective weights for THIS job
    // (per-vacancy override → employer default → admin default → this
    // fallback) once, before calling in; omitting it is a no-op and
    // preserves the original Tier 2 behaviour exactly.
    weights = DEFAULT_DIMENSION_WEIGHTS,
  } = options;
  if (!applicants.length || !job) {
    return { items: [], total: 0, filteredTotal: 0, disqualifiedCount: 0 };
  }

  // 'background' — score industry fit from the applicant's actual work/
  // training history rather than their stated preference; see §B.2 at
  // industryBackgroundScore() above for why the preference-based scorer is
  // the wrong signal for an employer ranking candidates.
  const scored = applicants.map((item) => ({
    item,
    res: computeUnifiedScore(job, item, industryScoreOverride, weights, 'background'),
  }));

  // Only fall back to TF‑IDF when NOTHING structured could be scored for anyone.
  if (scored.every(({ res }) => res === null)) {
    const tfidfRanked = tfidfRank(job, applicants);
    return finalizeApplicantRanking(job, tfidfRanked, { sortBy, onlyMeetsRequired, limit, skip });
  }

  const ranked = scored.map(({ item, res }) => attachStructuredScore(item, res));
  return finalizeApplicantRanking(job, ranked, { sortBy, onlyMeetsRequired, limit, skip });
}

// §A.5 — under the default 'match' sort, a six-month-old vacancy currently
// ranks identically to one posted today; this is a MILD nudge on ordering
// only, not on the displayed relevanceScore/matchBreakdown a jobseeker
// actually sees. No decay for the first month; a gentle half-life afterward,
// floored so an excellent old listing is never buried — at most a 10%
// ordering discount, however old the posting gets.
const FRESHNESS_GRACE_DAYS = 30;
const FRESHNESS_HALF_LIFE_DAYS = 180;
const FRESHNESS_FLOOR = 0.9;
function freshnessMultiplier(createdAt) {
  if (!createdAt) return 1; // unknown posting date — don't penalize
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / 86400000;
  if (!Number.isFinite(ageDays) || ageDays <= FRESHNESS_GRACE_DAYS) return 1;
  const decayDays = ageDays - FRESHNESS_GRACE_DAYS;
  const decay = Math.pow(0.5, decayDays / FRESHNESS_HALF_LIFE_DAYS);
  return FRESHNESS_FLOOR + (1 - FRESHNESS_FLOOR) * decay;
}

// Applicant-facing industry score (0..1) — how well a job's industry/ies
// match what the seeker says they prefer. Shared by the job board
// (rankJobsBySkills below) and the job detail page (jobController.getJobById,
// via module.exports) so the two surfaces never disagree on this dimension —
// see markdowns/MATCHMAKING_DEPLOYMENT_CHECKLIST.md P0-02.
function applicantIndustryPreferenceScore(job, preferredIndustries, industryPreferenceLevel = 'flexible') {
  const jobIndustries = resolveJobIndustries(job);
  const normalizedPreferred = dedupeNormalized(preferredIndustries);
  if (normalizedPreferred.length > 0) {
    if (jobIndustries.some((ind) => normalizedPreferred.includes(ind))) return 1;
    if (industryPreferenceLevel === 'strict') return 0;
    return 0.2;
  }
  if (jobIndustries.length) return 0.5;
  return 0;
}

// ---------- Jobs for a jobseeker (job board) ----------
function rankJobsBySkills(jobs, skills, options = {}) {
  const {
    limit = 50,
    skip = 0,
    preferredIndustries = [],
    industryPreferenceLevel = 'flexible',
    followedEmployerIds = null,
    expectedSalaryMin = null,
    expectedSalaryMax = null,
    preferredOccupations = [],
    educationalAttainment = null,
    workExperienceBand = null,
    workHistory = [],
    desiredJobTitle = null,
    seekerDateOfBirth = null,
    languageProficiency = null,
    // Credential-bearing fields — without these, credentialScore() and
    // educationScore() (via getApplicantCredentials/getApplicantEducationRank)
    // see no licenses, eligibilities, trainings, or course/year, and the
    // `credentials` dimension silently reads near-zero for every applicant.
    professionalLicenses = [],
    eligibilities = [],
    vocationalTrainings = [],
    course = null,
    yearGraduated = null,
    // Location/employment-type fields — without these, locationScore() and
    // employmentTypeScore() have no applicant-side signal to compare the
    // vacancy's location/jobType/workNature against, and both dimensions
    // silently return null for every applicant on the job board.
    presentAddress = null,
    preferredWorkLocationLocal = [],
    preferredJobTypes = [],
    preferredWorkNature = [],
    // 'match' (default) keeps the existing followed-then-relevance order;
    // 'newest' / 'salary' re-sort by posting date / pay after scoring.
    // `onlyMeetsRequired` drops any job the seeker doesn't meet every
    // required (non-"preferred") qualification of — applied before slicing
    // so pagination counts stay correct against the filtered set.
    sortBy = 'match',
    onlyMeetsRequired = false,
    // §C.1 — per-job resolved weights (per-vacancy override → that job's
    // employer default → admin default → code fallback), keyed by
    // String(job._id). The caller batch-resolves this once for the whole
    // result set (see server/services/matchWeightsService.js
    // buildWeightsByJobId) rather than querying per job. Omitting it (or a
    // job missing from the map) falls back to DEFAULT_DIMENSION_WEIGHTS —
    // the original Tier 2 behaviour, unchanged.
    weightsByJobId = null,
  } = options;

  if (!jobs.length) {
    return { items: [], total: 0, unfilteredTotal: 0 };
  }

  const isFollowedJob = (job) => {
    if (!followedEmployerIds || followedEmployerIds.size === 0) return false;
    const employerId = job.employer?._id || job.employer;
    return employerId ? followedEmployerIds.has(String(employerId)) : false;
  };

  const seekerSkills = Array.isArray(skills) ? skills : [];
  const seeker = {
    user: {
      skills: seekerSkills,
      educationalAttainment,
      workExperience: workExperienceBand,
      desiredJobTitle,
      dateOfBirth: seekerDateOfBirth,
    },
    profile: {
      skills: seekerSkills,
      expectedSalaryMin,
      expectedSalaryMax,
      preferredOccupations,
      preferredIndustries,
      workHistory,
      languageProficiency,
      professionalLicenses,
      eligibilities,
      vocationalTrainings,
      course,
      yearGraduated,
      presentAddress,
      preferredWorkLocationLocal,
      preferredJobTypes,
      preferredWorkNature,
    },
  };

  const ranked = jobs.map((job) => {
    // Industry score from the seeker's stated preferences (0..1).
    const industryScore = applicantIndustryPreferenceScore(job, preferredIndustries, industryPreferenceLevel);

    const weights = (weightsByJobId && weightsByJobId[String(job._id)]) || DEFAULT_DIMENSION_WEIGHTS;
    const res = computeUnifiedScore(job, seeker, industryScore, weights);
    return {
      ...attachStructuredScore(job, res),
      isFollowedEmployer: isFollowedJob(job),
      checklistMatch: computeChecklistMatch(job, seeker),
    };
  });

  const filtered = onlyMeetsRequired
    ? ranked.filter((job) => {
        const m = job.checklistMatch;
        if (!m || m.disqualified) return false;
        return m.totalMustHaves === 0 || m.metMustHaves === m.totalMustHaves;
      })
    : ranked;

  if (sortBy === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sortBy === 'salary') {
    const payOf = (job) => finiteOrNull(job.salaryMax) ?? finiteOrNull(job.salaryMin) ?? -1;
    filtered.sort((a, b) => payOf(b) - payOf(a));
  } else {
    // Followed-employer jobs are fast-tracked above everything else; within
    // each group, the displayed checklist % (the number on the card) is the
    // primary order — otherwise "Best match" sorts by the fuzzy 10-dimension
    // relevanceScore while the card prints a completely different number,
    // so a 29% job can visibly outrank a 57% one. relevanceScore (nudged by
    // posting freshness, §A.5) only breaks ties within the same percent.
    filtered.sort((a, b) => {
      if (a.isFollowedEmployer !== b.isFollowedEmployer) {
        return a.isFollowedEmployer ? -1 : 1;
      }
      const aPercent = a.checklistMatch?.percent ?? -1;
      const bPercent = b.checklistMatch?.percent ?? -1;
      if (aPercent !== bPercent) return bPercent - aPercent;
      const aRanked = a.relevanceScore * freshnessMultiplier(a.createdAt);
      const bRanked = b.relevanceScore * freshnessMultiplier(b.createdAt);
      return bRanked - aRanked;
    });
  }

  // `total` reflects the filtered (onlyMeetsRequired) set, not the unfiltered
  // input — pagination has to be computed against what's actually being
  // paged through, or the caller's page/total-pages math goes stale the
  // moment that filter drops anything. `unfilteredTotal` is the count
  // BEFORE that filter — §A.4's "pair onlyMeetsRequired with the count of
  // what it hides" needs both: a filter that silently empties the board
  // should say so, not just show zero results.
  return { items: filtered.slice(skip, skip + limit), total: filtered.length, unfilteredTotal: ranked.length };
}

module.exports = {
  rankJobsBySkills,
  rankApplicantsByJob,
  computeChecklistMatch,
  // Exported for direct unit testing of individual scoring dimensions
  // (§C.3 — every new dimension needs an explicit null-case test) without
  // needing to go through a full ranking call.
  computeUnifiedScore,
  DEFAULT_DIMENSION_WEIGHTS,
  // P0-02 — shared with jobController.getJobById so the job board and job
  // detail page compute the applicant-facing industry dimension identically.
  applicantIndustryPreferenceScore,
};
