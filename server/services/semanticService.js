const { TfIdf } = require('natural');

// ---------- Helper functions ----------
function buildJobText(job) {
  const parts = [
    job.title || '',
    job.description || '',
    job.responsibilities || '',
  ];
  if (Array.isArray(job.qualifications)) {
    const qualText = job.qualifications
      .map(q => typeof q === 'string' ? q : q?.value)
      .filter(Boolean)
      .join(' ');
    parts.push(qualText);
  }
  if (job.requirements) {
    parts.push(job.requirements);
  }
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------- Skill extraction ----------
function getApplicantSkills(applicant) {
  const profileSkills = Array.isArray(applicant?.profile?.skills)
    ? applicant.profile.skills
    : [];
  const userSkills = Array.isArray(applicant?.user?.skills)
    ? applicant.user.skills
    : [];

  return [...profileSkills, ...userSkills]
    .map(normalizeText)
    .filter(Boolean)
    .filter((skill, index, skills) => skills.indexOf(skill) === index);
}

function getRequiredSkills(job) {
  if (!Array.isArray(job?.qualifications)) return [];
  return job.qualifications
    .filter(q => q?.type === 'skill' && q?.value && q.optional !== true)
    .map(q => normalizeText(q.value))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function skillCoverageScore(job, skills) {
  const required = getRequiredSkills(job);
  if (!required.length) return null;
  const applicantSkills = skills
    .map(normalizeText)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const matched = required.filter(r => applicantSkills.includes(r));
  return matched.length / required.length;
}

// ---------- Education scoring ----------
function getRequiredEducation(job) {
  if (!Array.isArray(job?.qualifications)) return [];
  return job.qualifications
    .filter(q => q?.type === 'education' && q?.value && q.optional !== true)
    .map(q => normalizeText(q.value))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function getApplicantEducation(applicant) {
  const user = applicant.user || {};
  const profile = applicant.profile || {};
  const texts = [
    user.educationalAttainment,
    profile.educationalAttainment,
  ];
  return texts.map(normalizeText).filter(Boolean);
}

function educationScore(job, applicant) {
  const required = getRequiredEducation(job);
  if (!required.length) return null;
  const applicantEdu = getApplicantEducation(applicant);
  const matched = required.some(r => applicantEdu.includes(r));
  return matched ? 1 : 0;
}

// ---------- Experience scoring ----------
function getRequiredExperience(job) {
  if (!Array.isArray(job?.qualifications)) return [];
  return job.qualifications
    .filter(q => q?.type === 'experience' && q?.value && q.optional !== true)
    .map(q => normalizeText(q.value))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function getApplicantExperience(applicant) {
  const user = applicant.user || {};
  const profile = applicant.profile || {};
  const texts = [
    user.workExperience,
    profile.workExperience,
  ];
  return texts.map(normalizeText).filter(Boolean);
}

function experienceScore(job, applicant) {
  const required = getRequiredExperience(job);
  if (!required.length) return null;
  const applicantExp = getApplicantExperience(applicant);
  const matched = required.some(r => applicantExp.includes(r));
  return matched ? 1 : 0;
}

// ---------- Unified scoring ----------
function computeUnifiedScore(job, applicant, industryScore = 0) {
  const skillScore = skillCoverageScore(job, getApplicantSkills(applicant));
  const eduScore = educationScore(job, applicant);
  const expScore = experienceScore(job, applicant);

  const scores = [];
  if (skillScore !== null) scores.push(skillScore);
  if (eduScore !== null) scores.push(eduScore);
  if (expScore !== null) scores.push(expScore);

  if (scores.length === 0) {
    // If no skill/edu/exp data, use industry score as fallback
    return industryScore > 0 ? industryScore : null;
  }

  // Weighted average: skills 40%, education 20%, experience 20%, industry 20%
  let weightedSum = 0;
  let weightSum = 0;
  if (skillScore !== null) { weightedSum += skillScore * 0.4; weightSum += 0.4; }
  if (eduScore !== null) { weightedSum += eduScore * 0.2; weightSum += 0.2; }
  if (expScore !== null) { weightedSum += expScore * 0.2; weightSum += 0.2; }
  if (industryScore > 0) { weightedSum += industryScore * 0.2; weightSum += 0.2; }

  return weightedSum / (weightSum || 1);
}

// ---------- Unified ranker (used by both endpoints) ----------
function rankItemsByUnifiedScore(job, items, options = {}) {
  const { limit = 50, skip = 0 } = options;
  if (!items.length || !job) {
    return items.map(item => ({ ...item, relevanceScore: 0 }));
  }

  // If the job has no structured qualifications, fall back to TF‑IDF
  const hasStructuredQuals = job.qualifications && job.qualifications.length > 0;
  if (!hasStructuredQuals) {
    const jobText = buildJobText(job);
    const tfidf = new TfIdf();
    tfidf.addDocument(jobText);
    items.forEach(item => {
      const text = buildApplicantText(item);
      tfidf.addDocument(text);
    });
    const jobVector = {};
    const jobTerms = tfidf.listTerms(0);
    jobTerms.forEach(term => { jobVector[term.term] = term.tfidf; });

    const ranked = items.map((item, idx) => {
      const docIdx = idx + 1;
      const vec = {};
      const terms = tfidf.listTerms(docIdx);
      terms.forEach(term => { vec[term.term] = term.tfidf; });
      return { ...item, relevanceScore: parseFloat(cosineSimilarity(jobVector, vec).toFixed(4)) };
    });
    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return ranked.slice(skip, skip + limit);
  }

  // Use structured scoring
  const ranked = items.map(item => {
    const score = computeUnifiedScore(job, item, 0);
    return { ...item, relevanceScore: score !== null ? parseFloat(score.toFixed(4)) : 0 };
  });
  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked.slice(skip, skip + limit);
}

// ---------- For jobs ranking (Phase 1) ----------
function rankJobsBySkills(jobs, skills, options = {}) {
  const { limit = 50, skip = 0, preferredIndustries = [], industryPreferenceLevel = 'flexible' } = options;

  if (!jobs.length) {
    return jobs.map(job => ({ ...job, relevanceScore: 0 }));
  }

  // Build a fake applicant object with the user's skills
  const fakeApplicant = {
    user: { skills: skills && skills.length > 0 ? skills : [] },
    profile: { skills: skills && skills.length > 0 ? skills : [] },
  };

  // Score each job using the unified scoring function with industry weighting
  const ranked = jobs.map(job => {
    // Industry scoring: 1.0 if matches preferred, 0.5 if no preference, 0 if strict mode and doesn't match
    let industryScore = 0;
    if (preferredIndustries && preferredIndustries.length > 0) {
      const isPreferred = preferredIndustries.includes(job.industry);
      if (isPreferred) {
        industryScore = 1.0; // Perfect match
      } else if (industryPreferenceLevel === 'strict') {
        industryScore = 0; // Non-matching in strict mode gets penalized
      } else {
        industryScore = 0.2; // Slight boost for non-matching in flexible mode
      }
    } else if (job.industry) {
      industryScore = 0.5; // Default boost if no preferences set
    }

    const score = computeUnifiedScore(job, fakeApplicant, industryScore);
    return {
      ...job,
      relevanceScore: score !== null ? parseFloat(score.toFixed(4)) : 0,
    };
  });

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return ranked.slice(skip, skip + limit);
}

// ---------- For applicants ranking (Phase 2) ----------
function rankApplicantsByJob(job, applicants, options = {}) {
  return rankItemsByUnifiedScore(job, applicants, options);
}

// ---------- Helper to build applicant text for TF‑IDF fallback ----------
function buildApplicantText(applicant) {
  const profile = applicant.profile || {};
  const user = applicant.user || {};
  const skills = [
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(user.skills) ? user.skills : []),
  ];
  const parts = [
    user.name || '',
    user.about || '',
    user.desiredJobTitle || '',
    skills.join(' '),
    profile.workExperience || '',
    profile.educationalAttainment || '',
  ];
  return parts.join(' ').toLowerCase();
}

module.exports = { rankJobsBySkills, rankApplicantsByJob };