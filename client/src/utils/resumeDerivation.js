// Pure helpers that turn a JobseekerProfile + User pair into the initial
// content for the Resume Studio's editable, reorderable resume sections.
// Kept separate from ResumeStudio.jsx so the derivation logic is easy to
// unit-test independent of React.

export const formatStructuredAddress = (addr) => {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  return [addr.street, addr.barangay, addr.municipality, addr.province, addr.region]
    .filter((part) => part && String(part).trim())
    .join(", ");
};

export const fullNameOf = (user) =>
  [user?.firstName, user?.middleName, user?.surname || user?.name, user?.suffix]
    .filter((part) => part && String(part).trim())
    .join(" ") || user?.name || "Your Name";

const buildSkillsList = (user, profile) => {
  const merged = new Set([...(profile?.skills || []), ...(user?.skills || [])]);
  return Array.from(merged);
};

const buildExperienceText = (workHistory) => {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return "";
  return workHistory
    .map((job) => {
      const range = [job.dateFrom, job.dateTo || "Present"].filter(Boolean).join(" – ");
      return [
        [job.position, job.companyName].filter(Boolean).join(" — "),
        [range, job.status].filter(Boolean).join(" · "),
        job.address || "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
};

const buildEducationText = (user, profile) => {
  const lines = [];
  if (profile?.course || profile?.schoolAttended) {
    const school = profile.schoolAttended === "Other" ? profile.schoolAttendedOther : profile.schoolAttended;
    const year = profile.yearGraduated ? ` (${profile.yearGraduated})` : "";
    lines.push(`${[profile.course, school].filter(Boolean).join(" — ")}${year}`);
  }
  if (user?.educationalAttainment) lines.push(user.educationalAttainment);
  return lines.join("\n");
};

const buildTrainingText = (trainings) => {
  if (!Array.isArray(trainings) || trainings.length === 0) return "";
  return trainings
    .map((t) => {
      const institution = t.institution === "Other" ? t.institutionOther : t.institution;
      const range = [t.durationFrom, t.durationTo].filter(Boolean).join(" – ");
      const base = [t.course, institution].filter(Boolean).join(" — ");
      return [base, range ? `(${range})` : "", t.certificate || ""].filter(Boolean).join(" · ");
    })
    .join("\n");
};

const buildLicensesText = (eligibilities, licenses) => {
  const lines = [];
  (eligibilities || []).forEach((item) => {
    lines.push(
      [item.name, item.rating ? `Rating: ${item.rating}` : "", item.examDate ? `(${item.examDate})` : ""]
        .filter(Boolean)
        .join(" — "),
    );
  });
  (licenses || []).forEach((item) => {
    lines.push([item.name, item.validUntil ? `Valid until ${item.validUntil}` : ""].filter(Boolean).join(" — "));
  });
  return lines.join("\n");
};

const buildLanguagesText = (languageProficiency, othersLabel) => {
  if (!languageProficiency || typeof languageProficiency !== "object") return "";
  const lines = [];
  Object.entries(languageProficiency).forEach(([language, skills]) => {
    const active = Object.entries(skills || {})
      .filter(([, value]) => value)
      .map(([skill]) => skill);
    if (active.length) {
      const label = language === "Others" && othersLabel ? othersLabel : language;
      lines.push(`${label}: ${active.join(", ")}`);
    }
  });
  return lines.join("\n");
};

/**
 * Drafts a starter Professional Summary sentence from whatever profile data
 * exists, phrased for one of the three section-order personas so a
 * jobseeker always has something reasonable to edit instead of a blank box.
 * Only used when the jobseeker hasn't written their own "about" bio —
 * real, hand-written bios are never replaced by this.
 */
export const buildSummaryDraft = (persona, user, profile) => {
  const skills = buildSkillsList(user, profile);
  const topSkills = skills.slice(0, 3).join(", ");
  const desiredTitle = (user?.desiredJobTitle || "").trim();
  const course = profile?.course || "";
  const school = profile?.schoolAttended === "Other" ? profile?.schoolAttendedOther : profile?.schoolAttended;
  const latestJob = Array.isArray(profile?.workHistory) && profile.workHistory.length > 0 ? profile.workHistory[0] : null;

  if (persona === "freshGraduate") {
    const degreeLine = course && school ? `${course} graduate from ${school}` : course ? `${course} graduate` : "recent graduate";
    return (
      `Motivated ${degreeLine} eager to begin a career${desiredTitle ? ` as ${desiredTitle}` : ""}. ` +
      `${topSkills ? `Brings foundational skills in ${topSkills} and` : "Brings"} a strong willingness to learn, adapt, and contribute from day one.`
    );
  }

  if (persona === "experienced") {
    const roleLine = latestJob?.position || desiredTitle || "professional";
    return (
      `Experienced ${roleLine} with a track record of reliable performance${topSkills ? ` in ${topSkills}` : ""}. ` +
      `Known for strong work ethic, attention to detail, and the ability to deliver results in fast-paced environments.`
    );
  }

  const roleLine = desiredTitle || "jobseeker";
  return (
    `Detail-oriented ${roleLine}${topSkills ? ` with skills in ${topSkills}` : ""}, looking to bring strong communication, ` +
    `reliability, and a proactive attitude to a growing team.`
  );
};

/**
 * Returns the initial ordered, toggleable resume sections derived from the
 * jobseeker's profile. A section starts hidden only when there was nothing
 * to derive for it — the user can still turn it on and write their own text.
 */
export const buildInitialResumeSections = (user, profile) => {
  const skills = buildSkillsList(user, profile);
  const experience = buildExperienceText(profile?.workHistory);
  const education = buildEducationText(user, profile);
  const training = buildTrainingText(profile?.vocationalTrainings);
  const licenses = buildLicensesText(profile?.eligibilities, profile?.professionalLicenses);
  const languages = buildLanguagesText(profile?.languageProficiency, profile?.languageOthersLabel);
  const summary = user?.about || "";

  return [
    { id: "summary", title: "Professional Summary", content: summary, visible: Boolean(summary) },
    { id: "skills", title: "Skills", content: skills.join(", "), visible: skills.length > 0 },
    { id: "experience", title: "Work Experience", content: experience, visible: Boolean(experience) },
    { id: "education", title: "Education", content: education, visible: Boolean(education) },
    { id: "training", title: "Training & Certifications", content: training, visible: Boolean(training) },
    { id: "licenses", title: "Eligibility & Licenses", content: licenses, visible: Boolean(licenses) },
    { id: "languages", title: "Languages", content: languages, visible: Boolean(languages) },
  ];
};

// Ready-made section orderings so a jobseeker can pick a layout that fits
// their situation instead of manually toggling/reordering every section.
// Applying a preset reorders the existing sections (keeping their derived
// content) and makes every section in the preset visible.
export const RESUME_SECTION_PRESETS = [
  {
    key: "standard",
    label: "Standard",
    description: "Balanced order: summary, skills, then experience.",
    order: ["summary", "skills", "experience", "education", "training", "licenses", "languages"],
  },
  {
    key: "freshGraduate",
    label: "Fresh Graduate",
    description: "Leads with education and skills ahead of work experience.",
    order: ["summary", "education", "skills", "training", "licenses", "experience", "languages"],
  },
  {
    key: "experienced",
    label: "Experienced Professional",
    description: "Leads with work experience to highlight a track record.",
    order: ["summary", "experience", "skills", "licenses", "education", "training", "languages"],
  },
];

export const applyResumeSectionPreset = (sections, presetKey) => {
  const preset = RESUME_SECTION_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return sections;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ordered = preset.order.map((id) => byId.get(id)).filter(Boolean).map((section) => ({ ...section, visible: true }));
  // Preserve any section not covered by the preset (defensive, shouldn't
  // normally happen since the preset lists every known section id) by
  // appending it at the end rather than silently dropping it.
  const remaining = sections.filter((section) => !preset.order.includes(section.id));
  return [...ordered, ...remaining];
};
