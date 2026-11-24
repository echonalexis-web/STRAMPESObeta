// Pure sample-data generator for STRAM-PESO. Returns plain objects only: no database, no
// network, no file writes, no Math.random. Same options (seed, batch, now) => same output.
//
// The writer (seedSample.js) replaces PLACEHOLDER_HASH with a real bcrypt hash and inserts the
// documents. Plaintext passwords never exist in this module.

const mongoose = require("mongoose");
const locationData = require("../../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json");
const VALID_INDUSTRIES = require("../../data/industries");
const VALID_JOB_TYPES = require("../../data/jobTypes");
const { WORK_EXPERIENCE_VALUES } = require("../../utils/enumValues");
const { normalizeQualificationList } = require("../../utils/qualificationRules");
const { setApplicationStatus } = require("../../services/applicationStatusService");
const { createRng, allocate, createIdFactory } = require("./prng");
const data = require("./data");

const { EMAIL_DOMAIN, USERNAME_PREFIX, TOWNS, DEFAULT_EMPLOYER_ALLOCATION, EDU, ROLES, EMPLOYER_TEMPLATES, PERSONAS } = data;

const PLACEHOLDER_HASH = "SEED_PLACEHOLDER_HASH_REPLACED_BY_WRITER";
const PLACEHOLDER_FILE = "seed-placeholder://no-file";
const TERMS_VERSION = "2026-01"; // CURRENT_TERMS_VERSION in controllers/authController.js
const DAY = 86400000;
const HOUR = 3600000;
const TOWN_ORDER = ["BOAC", "SANTA CRUZ", "GASAN", "MOGPOG", "BUENAVISTA", "TORRIJOS"];
const SOFT_SKILLS = ["Communication", "Teamwork", "Time Management", "Work Ethic", "Adaptability", "Problem Solving"];

const pad = (n, width) => String(n).padStart(width, "0");
const round500 = (n) => Math.round(n / 500) * 500;

// Copy of formatSalaryDisplay in controllers/employerController.js (it is not exported).
const formatSalaryDisplay = (min, max) => {
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) return "";
  const fmt = (n) => `PHP ${Number(n).toLocaleString("en-PH")}`;
  if (hasMin && hasMax && min !== max) return `${fmt(min)} - ${fmt(max)}`;
  return fmt(hasMin ? min : max);
};

const getMarinduque = () => {
  const region = Object.values(locationData).find((r) => r.province_list && r.province_list.MARINDUQUE);
  if (!region) throw new Error("Marinduque not found in the location data file.");
  return { regionName: region.region_name, province: region.province_list.MARINDUQUE };
};

// Counts per town for `total` items. Default employer layout is fixed when total is 10.
const townCounts = (total, { employers = false } = {}) => {
  if (employers && total === 10) return TOWN_ORDER.map((key) => DEFAULT_EMPLOYER_ALLOCATION[key]);
  const weights = TOWN_ORDER.map((key) => TOWNS.find((t) => t.key === key).weight);
  if (total >= TOWN_ORDER.length) return allocate(total, weights, { minOne: true });
  // Fewer items than towns: the biggest towns get one each.
  const byWeight = TOWN_ORDER.map((key, i) => ({ i, w: weights[i] })).sort((a, b) => b.w - a.w || a.i - b.i);
  const counts = TOWN_ORDER.map(() => 0);
  for (let n = 0; n < total; n += 1) counts[byWeight[n].i] = 1;
  return counts;
};

const generateSample = (options = {}) => {
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : 1;
  const batch = String(options.batch || "batch");
  const employerCount = Math.max(1, Math.floor(Number(options.employers ?? 10)));
  const jobseekerCount = Math.max(1, Math.floor(Number(options.jobseekers ?? 100)));
  const now = options.now instanceof Date ? options.now : new Date();
  const verifierId = options.verifierId ? new mongoose.Types.ObjectId(String(options.verifierId)) : null;

  const rng = createRng(seed);
  const nextHex = createIdFactory(seed, batch);
  const oid = () => new mongoose.Types.ObjectId(nextHex());
  const nowMs = now.getTime();
  const msAgo = (days) => new Date(nowMs - Math.round(days * DAY) - rng.int(0, 86399) * 1000);
  const minDate = (a, b) => (a.getTime() <= b.getTime() ? a : b);

  const { regionName, province } = getMarinduque();
  const townByKey = Object.fromEntries(TOWNS.map((t) => [t.key, t]));
  const locationString = (barangay, townKey) => [barangay, townKey, "MARINDUQUE", regionName].join(", ");
  const structuredAddress = (barangay, townKey) => ({
    street: `Purok ${rng.int(1, 7)}`,
    barangay,
    municipality: townKey,
    province: "MARINDUQUE",
    region: regionName,
  });
  const barangaysOf = (townKey) => province.municipality_list[townKey].barangay_list;

  let phoneCounter = 0;
  // Reserved fake pattern: +63 9 00000 NNNN (see README). Passes the app's phone format check
  // but starts with the 0900 prefix; never use it as a contact number.
  const fakePhone = () => {
    phoneCounter += 1;
    return `+63900000${pad(phoneCounter, 4)}`;
  };

  const personName = (gender) => {
    const firstPool = gender === "Female" ? data.FEMALE_NAMES : gender === "Male" ? data.MALE_NAMES : rng.chance(0.5) ? data.FEMALE_NAMES : data.MALE_NAMES;
    const firstName = rng.pick(firstPool);
    const surname = rng.pick(data.SURNAMES);
    let middleName = rng.chance(0.7) ? rng.pick(data.SURNAMES) : null;
    if (middleName === surname) middleName = null;
    const suffix = gender === "Male" && rng.chance(0.05) ? "Jr." : null;
    return { firstName, middleName, surname, suffix, name: [firstName, middleName, surname, suffix].filter(Boolean).join(" ") };
  };

  // ---------------------------------------------------------------- employers
  const counts = townCounts(employerCount, { employers: true });
  const employerTowns = [];
  TOWN_ORDER.forEach((key, i) => {
    for (let n = 0; n < counts[i]; n += 1) employerTowns.push(key);
  });
  const perTownNo = {};
  const employers = employerTowns.map((townKey, index) => {
    const template = EMPLOYER_TEMPLATES[index % EMPLOYER_TEMPLATES.length];
    const cycle = Math.floor(index / EMPLOYER_TEMPLATES.length);
    const town = townByKey[townKey];
    perTownNo[townKey] = (perTownNo[townKey] || 0) + 1;
    const contact = personName(rng.chance(0.5) ? "Female" : "Male");
    const barangay = rng.pick(barangaysOf(townKey));
    const address = structuredAddress(barangay, townKey);
    const createdAt = msAgo(rng.int(100, 115));
    const submittedAt = new Date(createdAt.getTime() + rng.int(1, 3) * DAY);
    const reviewedAt = new Date(submittedAt.getTime() + rng.int(1, 3) * DAY);
    const companyName = cycle === 0 ? template.name : `${template.name} (${cycle + 1})`;
    const userId = oid();
    const user = {
      _id: userId,
      name: contact.name,
      surname: contact.surname,
      firstName: contact.firstName,
      middleName: contact.middleName,
      email: `employer.${town.slug}.${pad(perTownNo[townKey], 2)}@${EMAIL_DOMAIN}`,
      password: PLACEHOLDER_HASH,
      role: "employer",
      phone: fakePhone(),
      companyName,
      industry: template.industry,
      companySize: template.size,
      companyDescription: template.about,
      businessAddress: `${address.street}, ${locationString(barangay, townKey)}`,
      website: "",
      // Same fields applyVerificationDecision (controllers/verificationController.js) sets on approve.
      verificationStatus: "verified",
      verificationSubmittedAt: submittedAt,
      verificationReviewedAt: reviewedAt,
      verificationReviewedBy: verifierId,
      verificationNote: null,
      // Metadata placeholders only: no document files exist.
      businessPermitUrl: PLACEHOLDER_FILE,
      registrationDocUrl: PLACEHOLDER_FILE,
      isEmailVerified: true,
      emailVerifiedAt: createdAt,
      isActive: true,
      accountStatus: "active",
      tokenVersion: 0,
      loginLock: { failures: 0, level: 0 },
      hasCompletedOnboarding: true,
      onboardingComplete: true,
      acceptedTermsAt: createdAt,
      termsVersion: TERMS_VERSION,
      lastActiveAt: new Date(nowMs - rng.int(1, 5) * DAY),
      createdAt,
    };
    const profile = {
      _id: oid(),
      userId,
      tradeName: companyName,
      officeType: "main",
      employerClassification: { type: "private", subtype: null },
      totalWorkforceSize: template.size,
      businessAddress: address,
      ownerName: contact.name,
      contactPersonName: contact.name,
      contactPersonPosition: template.position,
    };
    return { user, profile, townKey, template, barangay, contactName: contact.name };
  });

  // --------------------------------------------------------------------- jobs
  const totalJobs = Math.min(6 * employerCount, Math.max(3 * employerCount, Math.round(4.5 * employerCount)));
  const perEmployer = employers.map(() => 3);
  for (let extra = totalJobs - 3 * employerCount; extra > 0; ) {
    const e = rng.int(0, employerCount - 1);
    if (perEmployer[e] < 6) {
      perEmployer[e] += 1;
      extra -= 1;
    }
  }

  // Quotas over the whole set: Closed >= 3, Archived >= 2, no drafts (the app never creates one).
  let closedQuota = Math.max(3, Math.round(0.12 * totalJobs));
  let archivedQuota = Math.max(2, Math.round(0.05 * totalJobs));
  const capacity = perEmployer.reduce((sum, n) => sum + (n - 2), 0); // every employer keeps >= 2 Open
  while (closedQuota + archivedQuota > capacity) {
    if (closedQuota > 0) closedQuota -= 1;
    else archivedQuota -= 1;
  }
  const slotsPool = [];
  perEmployer.forEach((n, e) => {
    for (let k = 0; k < n - 2; k += 1) slotsPool.push(e);
  });
  const nonOpenEmployers = rng.shuffle(slotsPool).slice(0, closedQuota + archivedQuota);
  const kindsByEmployer = employers.map((_, e) => {
    const kinds = new Array(perEmployer[e]).fill("open");
    return { kinds, next: 0 };
  });
  nonOpenEmployers.forEach((e, n) => {
    kindsByEmployer[e].kinds[kindsByEmployer[e].next] = n < archivedQuota ? "archived" : "closed";
    kindsByEmployer[e].next += 1;
  });

  const jobs = [];
  const jobMeta = [];
  employers.forEach((employer, e) => {
    const roleKeys = rng.sample(employer.template.roles, perEmployer[e]);
    const kinds = rng.shuffle(kindsByEmployer[e].kinds);
    roleKeys.forEach((roleKey, j) => {
      const role = ROLES[roleKey];
      const kind = kinds[j];
      const slots = rng.weighted([1, 2, 3, 4, 5], [20, 30, 25, 15, 10]);

      let salaryMin = null;
      let salaryMax = null;
      if (!rng.chance(0.08)) {
        const shift = rng.int(-2, 2) * 500;
        salaryMin = round500(role.salary[0] + shift);
        salaryMax = Math.max(salaryMin + 1000, round500(role.salary[1] + shift + rng.int(0, 2) * 500));
      }

      const quals = role.skills.slice(0, rng.int(Math.min(3, role.skills.length), role.skills.length)).map((value, order) => ({
        type: "skill", value, optional: true, order,
      }));
      quals.push({ type: "education", value: role.edu, optional: false, order: quals.length });
      if (role.exp > 0) quals.push({ type: "experience", value: `${role.exp} year${role.exp > 1 ? "s" : ""} of experience`, optional: true, order: quals.length });

      let createdAt;
      let closedAt = null;
      let archivedAt = null;
      let closeReason = null;
      let closedBy = null;
      let archiveReason = null;
      let deadline = null;
      if (kind === "open") {
        createdAt = msAgo(rng.int(2, 85));
        deadline = rng.chance(0.9) ? new Date(nowMs + rng.int(7, 60) * DAY) : null;
      } else {
        const ageDays = rng.int(20, 90);
        createdAt = msAgo(ageDays);
        closeReason = rng.weighted(["filled", "manual", "expired"], [45, 30, 25]);
        closedAt = new Date(createdAt.getTime() + rng.int(5, ageDays - 2) * DAY);
        closedBy = closeReason === "manual" ? "employer" : "system";
        if (closeReason === "expired") deadline = closedAt;
        else if (rng.chance(0.5)) deadline = new Date(closedAt.getTime() + rng.int(1, 20) * DAY);
        if (kind === "archived") {
          archivedAt = minDate(new Date(closedAt.getTime() + rng.int(1, 10) * DAY), new Date(nowMs - HOUR));
          archiveReason = { filled: "quota_reached", manual: "manual_close", expired: "deadline_passed" }[closeReason];
        }
      }

      const doc = {
        _id: oid(),
        title: role.title,
        description: `${employer.user.companyName} is hiring a ${role.title} at its ${townByKey[employer.townKey].label} branch. ${role.text}`,
        location: locationString(employer.barangay, employer.townKey),
        salary: formatSalaryDisplay(salaryMin, salaryMax),
        salaryMin,
        salaryMax,
        qualifications: normalizeQualificationList(quals),
        requirements: "",
        applicationDeadline: deadline,
        jobType: role.jobType,
        slots,
        employer: employer.user._id,
        isActive: true,
        status: kind === "open" ? "active" : "closed",
        isFeatured: false,
        featuredOrder: null,
        createdAt,
        updatedAt: archivedAt || closedAt || createdAt,
        industry: [employer.template.industry],
        workNature: "onsite",
        hiringManagerName: employer.contactName,
        minAge: 18,
        maxAge: null,
        minEducationLevel: role.edu,
        educationOrEquivalentExperience: role.exp > 0 && rng.chance(0.4),
        minExperienceYears: role.exp,
        languageRequirements: [],
        archived: kind === "archived",
        archivedAt,
        archiveReason,
        closedAt,
        closeReason,
        closedBy,
      };
      jobs.push(doc);
      jobMeta.push({ index: jobs.length - 1, doc, kind, employerIndex: e, townKey: employer.townKey, family: role.family, industry: employer.template.industry, slots });
    });
  });

  // -------------------------------------------------------------- jobseekers
  const jsTowns = [];
  townCounts(jobseekerCount).forEach((n, i) => {
    for (let k = 0; k < n; k += 1) jsTowns.push(TOWN_ORDER[i]);
  });
  const shuffledTowns = rng.shuffle(jsTowns);
  const protectedSet = new Set(rng.shuffle([...Array(jobseekerCount).keys()]).slice(0, Math.round(0.4 * jobseekerCount)));
  const completeN = Math.round(0.3 * jobseekerCount);
  const mostlyN = Math.round(0.4 * jobseekerCount);
  const tiers = rng.shuffle(
    [...Array(jobseekerCount).keys()].map((i) => (i < completeN ? "complete" : i < completeN + mostlyN ? "mostly" : "partial"))
  );

  const jobseekers = shuffledTowns.map((townKey, i) => {
    const persona = rng.weighted(PERSONAS, PERSONAS.map((p) => p.weight));
    const gender = rng.weighted(["Male", "Female", "Prefer not to say"], [48, 50, 2]);
    const who = personName(gender);
    const tier = tiers[i];
    const isProtected = protectedSet.has(i);

    const ageBand = rng.weighted([[18, 24], [25, 34], [35, 44], [45, 55]], [35, 35, 20, 10]);
    const age = rng.int(ageBand[0], ageBand[1]);
    const dobRaw = new Date(nowMs - (Math.round(age * 365.25) + 2 + rng.int(0, 360)) * DAY);
    const dateOfBirth = new Date(Date.UTC(dobRaw.getUTCFullYear(), dobRaw.getUTCMonth(), dobRaw.getUTCDate()));

    const eduChoices = persona.education.filter(([level]) => !(level === EDU.CG && age < 22));
    const [educationalAttainment, course] = rng.pick(eduChoices.length ? eduChoices : persona.education);
    const freshOnly = age < 22 || (educationalAttainment === EDU.CG && age < 24);
    const maxExp = freshOnly ? 1 : age < 26 ? 2 : age < 32 ? 3 : 4;
    const workExperience = WORK_EXPERIENCE_VALUES[rng.int(0, maxExp)];

    const skillCount = rng.int(3, 8);
    const skills = rng.sample(persona.skills, Math.min(skillCount, persona.skills.length));
    for (const soft of rng.shuffle(SOFT_SKILLS)) {
      if (skills.length >= skillCount) break;
      if (!skills.includes(soft)) skills.push(soft);
    }

    const desiredJobTitle = rng.pick(persona.titles);
    const town = townByKey[townKey];
    const barangay = rng.pick(barangaysOf(townKey));
    const userId = oid();
    const username = `${USERNAME_PREFIX}${who.firstName[0].toLowerCase()}${who.surname.toLowerCase().replace(/[^a-z]/g, "")}${pad(i + 1, 3)}`;
    const availabilityStatus = rng.weighted(["Actively Looking", "Open to Offers", "Currently Employed"], [65, 25, 10]);
    const onboarded = tier !== "partial";

    const user = {
      _id: userId,
      name: who.name,
      surname: who.surname,
      firstName: who.firstName,
      middleName: who.middleName,
      suffix: who.suffix,
      username,
      // Protected = verified email; basic = username only, no email (utils/accountType.js).
      ...(isProtected ? { email: `seed.js.${pad(i + 1, 3)}@${EMAIL_DOMAIN}`, isEmailVerified: true, emailVerifiedAt: now } : {}),
      password: PLACEHOLDER_HASH,
      role: "jobseeker",
      dateOfBirth,
      dobLockedAt: now,
      dobSource: "registration",
      gender,
      skills,
      educationalAttainment,
      isActive: true,
      accountStatus: "active",
      tokenVersion: 0,
      loginLock: { failures: 0, level: 0 },
      acceptedTermsAt: now,
      termsVersion: TERMS_VERSION,
      hasCompletedOnboarding: onboarded,
      onboardingComplete: onboarded,
      createdAt: now,
    };
    if (tier !== "partial") {
      Object.assign(user, {
        desiredJobTitle,
        preferredIndustries: persona.industries,
        industryPreferenceLevel: "flexible",
        workExperience,
        availabilityStatus,
        address: `${barangay}, ${town.label}, Marinduque`,
        about: `Looking for a ${desiredJobTitle} position in ${town.label}. ${rng.pick([
          "Hardworking and willing to learn.",
          "Reliable, punctual and good with people.",
          "Ready to start right away.",
          "Experienced in the basics and eager to grow.",
        ])}`,
      });
      user.phone = fakePhone();
    }

    const present = structuredAddress(barangay, townKey);
    const profile = { _id: oid(), userId, civilStatus: rng.weighted(data.CIVIL_STATUSES, [55, 28, 10, 4, 3]) };
    if (age < 22) profile.civilStatus = "Single";
    if (tier !== "partial") {
      const role = Object.values(ROLES).find((r) => r.title === desiredJobTitle);
      Object.assign(profile, {
        presentAddress: present,
        permanentAddress: present,
        citizenship: "Filipino",
        skills,
        preferredIndustries: persona.industries,
        preferredJobTypes: ["Full-time"],
        preferredWorkNature: ["Onsite"],
        industrySelectionStep: true,
        course,
        yearGraduated: String(now.getUTCFullYear() - Math.max(0, age - 22) - rng.int(0, 2)),
      });
      if (tier === "complete") {
        const salary = role ? role.salary : [10500, 14000];
        Object.assign(profile, {
          preferredOccupations: [desiredJobTitle],
          expectedSalaryMin: salary[0],
          expectedSalaryMax: salary[1],
          languageProficiency: {
            English: { read: true, write: true, speak: true, understand: true },
            Filipino: { read: true, write: true, speak: true, understand: true },
          },
          employmentStatus: availabilityStatus === "Currently Employed" ? "employed" : "unemployed",
          ...(availabilityStatus === "Currently Employed"
            ? { employmentType: "wage" }
            : { unemploymentReason: freshOnly ? "fresh_grad" : "finished_contract" }),
        });
        if (!freshOnly) {
          profile.workHistory = [{ companyName: "Previous employer (sample)", address: `${town.label}, Marinduque`, position: desiredJobTitle, dateFrom: "2021-03", dateTo: "2024-02", status: "Finished contract" }];
        }
      }
    }
    return { user, profile, townKey, persona, isProtected, tier, age };
  });

  // ------------------------------------------------------------ applications
  const openJobs = jobMeta.filter((m) => m.kind === "open");
  const perSeekerCount = jobseekers.map(() => rng.weighted([2, 3, 4, 5, 6], [15, 20, 30, 20, 15]));
  const totalApps = perSeekerCount.reduce((sum, n) => sum + n, 0);
  const capPerJob = Math.floor(0.25 * totalApps);
  const minApps = jobMeta.map((m) => (m.kind !== "open" && m.doc.closeReason === "filled" ? Math.max(3, m.slots + 1) : 3));
  if (minApps.reduce((sum, n) => sum + n, 0) > totalApps) {
    throw new Error(`Too few jobseekers (${jobseekerCount}) for ${jobs.length} jobs: not enough applications to give every job its minimum applicants.`);
  }

  const load = jobMeta.map(() => 0);
  const chosen = jobseekers.map(() => new Set());
  const pairs = []; // [seekerIndex, jobIndex]
  const addPair = (s, j) => {
    chosen[s].add(j);
    load[j] += 1;
    pairs.push([s, j]);
  };
  const affinity = (s, m) => 1 + 3 * (jobseekers[s].persona.family === m.family ? 1 : 0) + 2 * (jobseekers[s].persona.industries.includes(m.industry) ? 1 : 0);
  const avgLoad = () => Math.max(1, pairs.length / jobMeta.length);
  const pickJob = (s) => {
    const mine = jobseekers[s].townKey;
    const free = (m) => !chosen[s].has(m.index) && load[m.index] < capPerJob;
    let candidates = rng.chance(0.6) ? openJobs.filter((m) => m.townKey === mine && free(m)) : [];
    if (!candidates.length) candidates = jobMeta.filter((m) => m.townKey !== mine && free(m));
    if (!candidates.length) candidates = jobMeta.filter(free);
    if (!candidates.length) return null;
    const weights = candidates.map((m) => affinity(s, m) * (1 / (1 + load[m.index] / (avgLoad() * 1.5 + 1))) * (m.kind === "open" ? 1 : 0.8));
    return rng.weighted(candidates, weights).index;
  };
  for (let round = 0; round < 6; round += 1) {
    for (const s of rng.shuffle([...Array(jobseekers.length).keys()])) {
      if (perSeekerCount[s] <= round) continue;
      const j = pickJob(s);
      if (j !== null) addPair(s, j);
    }
  }
  // Repair: every job needs its minimum applicants. Move one application from a busy job.
  for (let guard = 0; guard < 20000; guard += 1) {
    const needy = jobMeta.find((m) => load[m.index] < minApps[m.index]);
    if (!needy) break;
    const donors = pairs
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => load[p[1]] > minApps[p[1]] + 1 && load[p[1]] >= avgLoad() && !chosen[p[0]].has(needy.index));
    if (!donors.length) throw new Error("Could not give every job its minimum applicants; try more jobseekers.");
    const weights = donors.map(({ p }) => affinity(p[0], needy));
    const { p, idx } = rng.weighted(donors, weights);
    chosen[p[0]].delete(p[1]);
    load[p[1]] -= 1;
    chosen[p[0]].add(needy.index);
    load[needy.index] += 1;
    pairs[idx] = [p[0], needy.index];
  }

  // Status plan.
  const appsByJob = jobMeta.map(() => []);
  const apps = pairs.map(([s, j], n) => {
    const app = { s, j, status: "pending", n };
    appsByJob[j].push(app);
    return app;
  });
  const A = apps.length;
  const target = { under_review: Math.round(0.25 * A), shortlisted: Math.round(0.18 * A), hired: Math.round(0.1 * A), rejected: Math.round(0.12 * A) };
  target.pending = A - target.under_review - target.shortlisted - target.hired - target.rejected;

  let histHired = 0;
  let histRejected = 0;
  let histApps = 0;
  for (const m of jobMeta.filter((x) => x.kind !== "open")) {
    const list = rng.shuffle(appsByJob[m.index]);
    const hires = m.doc.closeReason === "filled" ? Math.min(m.slots, list.length - 1) : rng.int(0, Math.min(m.slots, list.length - 1));
    list.forEach((app, k) => {
      app.status = k < hires ? "hired" : "rejected";
    });
    histHired += hires;
    histRejected += list.length - hires;
    histApps += list.length;
  }
  const openApps = rng.shuffle(apps.filter((a) => jobMeta[a.j].kind === "open"));
  const hireCap = jobMeta.map((m) => (m.kind === "open" ? Math.max(0, Math.min(m.slots - 1, appsByJob[m.index].length - 1)) : 0));
  const hiredOpen = Math.min(Math.max(0, target.hired - histHired), hireCap.reduce((sum, n) => sum + n, 0));
  let rejectedOpen = Math.max(0, target.rejected - histRejected);
  rejectedOpen = Math.min(rejectedOpen, openApps.length - hiredOpen);
  const rest = openApps.length - hiredOpen - rejectedOpen;
  const [nPending, nReview, nShort] = allocate(rest, [35, 25, 18]);

  const unassigned = new Set(openApps);
  for (let h = 0; h < hiredOpen; h += 1) {
    const jobsWithRoom = jobMeta.filter((m) => hireCap[m.index] > 0 && appsByJob[m.index].some((a) => unassigned.has(a)));
    if (!jobsWithRoom.length) break;
    const m = rng.weighted(jobsWithRoom, jobsWithRoom.map((x) => hireCap[x.index]));
    const app = rng.pick(appsByJob[m.index].filter((a) => unassigned.has(a)));
    app.status = "hired";
    hireCap[m.index] -= 1;
    unassigned.delete(app);
  }
  const pool = rng.shuffle([
    ...Array(rejectedOpen).fill("rejected"),
    ...Array(nPending).fill("pending"),
    ...Array(nReview).fill("under_review"),
    ...Array(nShort).fill("shortlisted"),
  ]);
  for (const app of unassigned) app.status = pool.length ? pool.pop() : "pending";

  // Build application documents with dates and the fields the app sets (setApplicationStatus).
  const coverLine = [
    "I am interested in this position and can start as soon as needed.",
    "I live nearby and am available for the schedule you need.",
    "I am hardworking and willing to learn on the job.",
  ];
  const applications = apps.map((app) => {
    const seeker = jobseekers[app.s];
    const meta = jobMeta[app.j];
    const job = meta.doc;
    const startMs = job.createdAt.getTime() + HOUR;
    const endMs = meta.kind === "open" ? nowMs - DAY : job.closedAt.getTime() - 2 * DAY;
    const appliedAt = new Date(startMs + Math.floor(rng.next() * Math.max(1, endMs - startMs)));
    const cap = new Date(meta.kind === "open" ? nowMs - HOUR : job.closedAt.getTime());
    const step = (from) => minDate(cap, new Date(from.getTime() + rng.int(2 * 3600, 3 * 86400) * 1000));

    const doc = {
      _id: oid(),
      applicant: seeker.user._id,
      vacancy: job._id,
      resume: PLACEHOLDER_FILE,
      resumeDocumentId: null,
      coverLetter: `Good day! I would like to apply for the ${job.title} position. ${rng.pick(coverLine)} Thank you.`,
      coverLetterFile: "",
      coverLetterDocumentId: null,
      status: "pending",
      employerNote: "",
      includePhoto: false,
      statusUpdatedAt: null,
      hiredAt: null,
      hiredAtApproximate: false,
      firstResponseAt: null,
      appliedAt,
      createdAt: appliedAt,
    };
    const t1 = step(appliedAt);
    if (app.status === "under_review") {
      setApplicationStatus(doc, "under_review", { now: t1 });
    } else if (app.status === "shortlisted") {
      setApplicationStatus(doc, "under_review", { now: t1 });
      setApplicationStatus(doc, "shortlisted", { now: step(t1) });
    } else if (app.status === "hired") {
      const t2 = step(t1);
      setApplicationStatus(doc, "under_review", { now: t1 });
      setApplicationStatus(doc, "shortlisted", { now: t2 });
      setApplicationStatus(doc, "hired", { now: step(t2) });
    } else if (app.status === "rejected") {
      if (rng.chance(0.6)) {
        setApplicationStatus(doc, "under_review", { now: t1 });
        setApplicationStatus(doc, "rejected", { now: step(t1) });
      } else {
        setApplicationStatus(doc, "rejected", { now: t1 });
      }
    }
    return doc;
  });

  // Account dates follow the first and last application.
  const firstApplied = new Map();
  const lastTouched = new Map();
  for (const doc of applications) {
    const key = String(doc.applicant);
    const touched = doc.statusUpdatedAt || doc.appliedAt;
    if (!firstApplied.has(key) || doc.appliedAt < firstApplied.get(key)) firstApplied.set(key, doc.appliedAt);
    if (!lastTouched.has(key) || touched > lastTouched.get(key)) lastTouched.set(key, touched);
  }
  for (const { user } of jobseekers) {
    const first = firstApplied.get(String(user._id));
    user.createdAt = new Date(first.getTime() - rng.int(1, 30) * DAY);
    user.dobLockedAt = user.createdAt;
    user.acceptedTermsAt = user.createdAt;
    if (user.emailVerifiedAt) user.emailVerifiedAt = user.createdAt;
    user.lastActiveAt = lastTouched.get(String(user._id));
  }

  // Archived snapshot, same shape as buildArchivedJobSnapshot in controllers/jobController.js.
  const rate = (value, total) => (total ? Number(((value / total) * 100).toFixed(2)) : 0);
  const nameById = new Map(jobseekers.map(({ user }) => [String(user._id), user.name]));
  for (const m of jobMeta.filter((x) => x.kind === "archived")) {
    const list = applications.filter((a) => String(a.vacancy) === String(m.doc._id));
    const qualified = list.filter((a) => ["under_review", "shortlisted", "approved", "hired"].includes(a.status)).length;
    const shortlisted = list.filter((a) => ["shortlisted", "approved", "hired"].includes(a.status)).length;
    const hired = list.filter((a) => a.status === "hired");
    m.doc.archivedMetrics = {
      totalApplicants: list.length,
      qualifiedCount: qualified,
      shortlistedCount: shortlisted,
      hiredCount: hired.length,
      hiredCandidateIds: hired.map((_, k) => String(k + 1)),
      hiredCandidateNames: hired.map((a) => nameById.get(String(a.applicant))),
      qualifiedRate: rate(qualified, list.length),
      shortlistedRate: rate(shortlisted, list.length),
      hireRate: rate(hired.length, list.length),
      daysActive: Math.max(0, Math.ceil((m.doc.archivedAt.getTime() - m.doc.createdAt.getTime()) / DAY)),
      archiveReason: m.doc.archiveReason,
      archivedAt: m.doc.archivedAt,
    };
  }

  // Credentials list WITHOUT passwords. The writer adds them.
  const credentials = [
    ...employers.map(({ user }) => ({ role: "employer", userId: String(user._id), username: "", email: user.email, accountType: "protected" })),
    ...jobseekers.map(({ user, isProtected }) => ({
      role: "jobseeker", userId: String(user._id), username: user.username, email: user.email || "", accountType: isProtected ? "protected" : "basic",
    })),
  ];

  return {
    meta: { seed, batch, now: now.toISOString(), employerCount, jobseekerCount, validIndustries: VALID_INDUSTRIES.length, validJobTypes: VALID_JOB_TYPES.length },
    employers,
    jobseekers,
    jobs,
    jobMeta: jobMeta.map(({ index, kind, employerIndex, townKey }) => ({ index, kind, employerIndex, townKey })),
    applications,
    credentials,
  };
};

module.exports = { generateSample, PLACEHOLDER_HASH, PLACEHOLDER_FILE, TERMS_VERSION, TOWN_ORDER };
