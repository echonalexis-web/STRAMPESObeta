const { TfIdf, PorterStemmer, JaroWinklerDistance } = require('natural');
const { getAgeFromDate } = require('../utils/age');

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

function contentStems(value) {
  return tokenize(value)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => PorterStemmer.stem(token));
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
function getApplicantSkills(applicant) {
  const profile = applicant?.profile || {};
  const user = applicant?.user || {};
  return dedupeNormalized([
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(user.skills) ? user.skills : []),
  ]);
}

function getApplicantTitles(applicant) {
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
}

function getApplicantCredentials(applicant) {
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
}

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

function getApplicantEducationRank(applicant) {
  const user = applicant?.user || {};
  const profile = applicant?.profile || {};
  const ranks = [
    educationTextToRank(user.educationalAttainment),
    educationTextToRank(profile.educationalAttainment),
  ].filter((r) => r > 0);
  // A named course with a graduation year implies a completed college degree.
  if (profile.course && profile.yearGraduated) ranks.push(6);
  return ranks.length ? Math.max(...ranks) : 0;
}

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

function getApplicantExperienceYears(applicant) {
  const user = applicant?.user || {};
  const profile = applicant?.profile || {};
  let band = bandToYears(user.workExperience);
  if (band === null) band = bandToYears(profile.workExperience);
  const history = yearsFromWorkHistory(profile.workHistory);
  return band === null ? history : Math.max(history, band);
}

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
function resolveJobIndustry(job) {
  return normalizeText(job?.industry) || normalizeText(job?.employer?.industry) || '';
}

// Employer-side: does the applicant's stated industry preference line up with
// the industry this job (or its employer) sits in?
function industryAffinityScore(job, applicant) {
  const jobIndustry = resolveJobIndustry(job);
  if (!jobIndustry) return null;
  const preferred = dedupeNormalized(applicant?.profile?.preferredIndustries || []);
  if (!preferred.length) return null; // no signal — skip, don't penalize
  if (preferred.includes(jobIndustry)) return 1;
  if (jobIndustry === 'others') return 0.4;
  return 0.25;
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
// Unified scoring
// ============================================================
const DIMENSION_WEIGHTS = {
  skills: 0.28,
  title: 0.17,
  experience: 0.14,
  education: 0.10,
  credentials: 0.07,
  industry: 0.12,
  language: 0.05,
  salary: 0.07,
};

// Returns { score, breakdown, coverage } — plus `disqualified: 'age'` when the
// applicant falls outside the job's age band — or null when no dimension had
// usable data on either side (the caller may then fall back to TF‑IDF).
// `industryScoreOverride` (0..1) lets the job-board path supply its own
// preference-based industry score instead of `industryAffinityScore`.
function computeUnifiedScore(job, applicant, industryScoreOverride = null) {
  const age = ageEligibility(job, applicant);
  const applicantSkills = getApplicantSkills(applicant);

  const dims = {
    skills: skillCoverageScore(job, applicantSkills),
    title: titleScore(job, applicant),
    experience: experienceScore(job, applicant),
    education: educationScore(job, applicant),
    credentials: credentialScore(job, applicant),
    industry:
      industryScoreOverride === null || industryScoreOverride === undefined
        ? industryAffinityScore(job, applicant)
        : clamp01(industryScoreOverride),
    language: languageScore(job, applicant),
    salary: salaryCompatibilityScore(job, applicant),
  };

  let weightedSum = 0;
  let weightSum = 0;
  const breakdown = {};
  for (const key of Object.keys(DIMENSION_WEIGHTS)) {
    const value = dims[key];
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const weight = DIMENSION_WEIGHTS[key];
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
    job.industry || '',
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

function tfidfRank(job, items, { limit, skip }) {
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
  return ranked.slice(skip, skip + limit);
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
function rankApplicantsByJob(job, applicants, options = {}) {
  const { limit = 50, skip = 0, industryScoreOverride = null } = options;
  if (!applicants.length || !job) {
    return applicants.map((item) => ({ ...item, relevanceScore: 0 }));
  }

  const scored = applicants.map((item) => ({
    item,
    res: computeUnifiedScore(job, item, industryScoreOverride),
  }));

  // Only fall back to TF‑IDF when NOTHING structured could be scored for anyone.
  if (scored.every(({ res }) => res === null)) {
    return tfidfRank(job, applicants, { limit, skip });
  }

  const ranked = scored.map(({ item, res }) => attachStructuredScore(item, res));
  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked.slice(skip, skip + limit);
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
  } = options;

  if (!jobs.length) {
    return jobs.map((job) => ({ ...job, relevanceScore: 0 }));
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
    },
  };

  const normalizedPreferred = dedupeNormalized(preferredIndustries);

  const ranked = jobs.map((job) => {
    // Industry score from the seeker's stated preferences (0..1).
    const jobIndustry = resolveJobIndustry(job);
    let industryScore = 0;
    if (normalizedPreferred.length > 0) {
      if (jobIndustry && normalizedPreferred.includes(jobIndustry)) industryScore = 1;
      else if (industryPreferenceLevel === 'strict') industryScore = 0;
      else industryScore = 0.2;
    } else if (jobIndustry) {
      industryScore = 0.5;
    }

    const res = computeUnifiedScore(job, seeker, industryScore);
    return {
      ...attachStructuredScore(job, res),
      isFollowedEmployer: isFollowedJob(job),
    };
  });

  // Followed-employer jobs are fast-tracked above everything else; relevance
  // orders jobs within each group.
  ranked.sort((a, b) => {
    if (a.isFollowedEmployer !== b.isFollowedEmployer) {
      return a.isFollowedEmployer ? -1 : 1;
    }
    return b.relevanceScore - a.relevanceScore;
  });
  return ranked.slice(skip, skip + limit);
}

module.exports = { rankJobsBySkills, rankApplicantsByJob };
