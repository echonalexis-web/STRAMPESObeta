const JobVacancy = require('../models/JobVacancy');
const JobseekerProfile = require('../models/JobseekerProfile');
const Follow = require('../models/Follow');
const { rankJobsBySkills, computeChecklistMatch } = require('../services/semanticService');
const { SEEKER_USER_FIELDS, SEEKER_PROFILE_FIELDS, buildSeekerForMatching } = require('../services/matchProfileService');
const { buildWeightsByJobId } = require('../services/matchWeightsService');
const { getApplicationCountMap, getHiredCountMap } = require('../utils/jobDisplay');
const { escapeRegex } = require('../utils/sanitize');
const logger = require('../utils/logger');

exports.hybridSearch = async (req, res) => {
  try {
    const {
      industry,
      workNature,
      jobType,
      location,
      salaryMin,
      salaryMax,
      q,
      page,
      limit = 50,
      skip,
      sortBy,
      onlyMeetsRequired,
    } = req.query;

    const normalizedSortBy = ['newest', 'salary'].includes(sortBy) ? sortBy : 'match';
    const requireAllMustHaves = onlyMeetsRequired === 'true' || onlyMeetsRequired === true;

    const parsedLimit = Math.max(1, Number(limit) || 50);
    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedSkip = Number.isFinite(Number(skip)) && Number(skip) >= 0
      ? Number(skip)
      : (parsedPage - 1) * parsedLimit;

    const userId = req.user?.id || req.user?._id;
    const now = new Date();

    await JobVacancy.updateMany(
      {
        status: "active",
        archived: { $ne: true },
        applicationDeadline: { $ne: null, $lt: now },
      },
      {
        $set: {
          status: "closed",
          closedAt: now,
        },
      }
    );

    logger.debug('[Job Board] search started', { userId: userId ? String(userId) : null });

    // --- 1. Build filter ---
    const filter = { isActive: true, status: { $ne: 'closed' }, archived: { $ne: true } };
    if (industry) {
      // `industry` may arrive as a repeated query param (array), or as a
      // single/comma-separated string — normalize to a list either way.
      // `$in` against JobVacancy.industry (now an array field) matches a job
      // tagged with ANY of the requested industries, and still works
      // unchanged against a not-yet-migrated string-valued document.
      const industries = Array.isArray(industry)
        ? industry
        : String(industry).split(',').map((s) => s.trim()).filter(Boolean);
      if (industries.length) filter.industry = { $in: industries };
    }
    if (workNature) filter.workNature = workNature;
    if (jobType) filter.jobType = jobType;
    if (location) filter.location = { $regex: escapeRegex(location), $options: 'i' };

    // Match jobs whose salary range overlaps the requested range, rather than
    // requiring the job's entire range to sit inside it (which would wrongly
    // exclude e.g. a 15k-25k job from a 20k-30k search).
    if (salaryMin !== undefined && Number.isFinite(Number(salaryMin))) {
      filter.salaryMax = { $ne: null, $gte: Number(salaryMin) };
    }
    if (salaryMax !== undefined && Number.isFinite(Number(salaryMax))) {
      filter.salaryMin = { $ne: null, $lte: Number(salaryMax) };
    }

    if (q) {
      const qRegex = escapeRegex(q);
      filter.$or = [
        { title: { $regex: qRegex, $options: 'i' } },
        { description: { $regex: qRegex, $options: 'i' } },
      ];
    }

    // --- 2. Get user skills, preferred industries, and preference level ---
    let hasSkills = false;
    let skills = [];
    let preferredIndustries = [];
    let industryPreferenceLevel = 'flexible';
    let expectedSalaryMin = null;
    let expectedSalaryMax = null;
    let preferredOccupations = [];
    let workHistory = [];
    let educationalAttainment = null;
    let workExperienceBand = null;
    let desiredJobTitle = null;
    let seekerDateOfBirth = null;
    let languageProficiency = null;
    // Credential-bearing fields — previously never selected here (see
    // server/services/matchProfileService.js), so the `credentials`
    // dimension read near-zero for every applicant on the job board
    // regardless of what licenses/eligibilities/trainings they actually
    // hold, and the checklist card falsely listed them as "Missing".
    let professionalLicenses = [];
    let eligibilities = [];
    let vocationalTrainings = [];
    let course = null;
    let yearGraduated = null;
    // Location/employment-type fields — without these, the `location` and
    // `employmentType` dimensions have no applicant-side signal and return
    // null (skipped) for every job on the board.
    let presentAddress = null;
    let preferredWorkLocationLocal = [];
    let preferredJobTypes = [];
    let preferredWorkNature = [];

    if (userId) {
      try {
        const profile = await JobseekerProfile.findOne({ userId })
          .select(SEEKER_PROFILE_FIELDS)
          .lean();
        const User = require('../models/User');
        const user = await User.findById(userId)
          .select(`${SEEKER_USER_FIELDS} preferredIndustries industryPreferenceLevel`)
          .lean();

        logger.debug('[Job Board] profile lookup', { userId: String(userId), hasProfile: Boolean(profile) });

        // Skills can live on either the normalized profile or the legacy
        // User document — merge both so scoring never silently misses one.
        const skillSet = new Set();
        [
          ...(Array.isArray(profile?.skills) ? profile.skills : []),
          ...(Array.isArray(user?.skills) ? user.skills : []),
        ].forEach(skill => {
          const normalized = String(skill).trim();
          if (normalized) skillSet.add(normalized);
        });
        skills = Array.from(skillSet);
        hasSkills = skills.length > 0;

        // Fetch preferred industries from both profile and user model (use user model as source of truth)
        preferredIndustries = Array.isArray(user?.preferredIndustries) ? user.preferredIndustries :
                            (Array.isArray(profile?.preferredIndustries) ? profile.preferredIndustries : []);
        industryPreferenceLevel = user?.industryPreferenceLevel || 'flexible';
        expectedSalaryMin = Number.isFinite(profile?.expectedSalaryMin) ? profile.expectedSalaryMin : null;
        expectedSalaryMax = Number.isFinite(profile?.expectedSalaryMax) ? profile.expectedSalaryMax : null;
        preferredOccupations = Array.isArray(profile?.preferredOccupations) ? profile.preferredOccupations : [];
        workHistory = Array.isArray(profile?.workHistory) ? profile.workHistory : [];
        educationalAttainment = user?.educationalAttainment || null;
        workExperienceBand = user?.workExperience || null;
        desiredJobTitle = user?.desiredJobTitle || null;
        seekerDateOfBirth = user?.dateOfBirth || null;
        languageProficiency = profile?.languageProficiency || null;
        professionalLicenses = Array.isArray(profile?.professionalLicenses) ? profile.professionalLicenses : [];
        eligibilities = Array.isArray(profile?.eligibilities) ? profile.eligibilities : [];
        vocationalTrainings = Array.isArray(profile?.vocationalTrainings) ? profile.vocationalTrainings : [];
        course = profile?.course || null;
        yearGraduated = profile?.yearGraduated || null;
        presentAddress = profile?.presentAddress || null;
        preferredWorkLocationLocal = Array.isArray(profile?.preferredWorkLocationLocal) ? profile.preferredWorkLocationLocal : [];
        preferredJobTypes = Array.isArray(profile?.preferredJobTypes) ? profile.preferredJobTypes : [];
        preferredWorkNature = Array.isArray(profile?.preferredWorkNature) ? profile.preferredWorkNature : [];

        logger.debug('[Job Board] seeker signal loaded', {
          userId: String(userId),
          skillCount: skills.length,
          preferredIndustryCount: preferredIndustries.length,
          industryPreferenceLevel,
        });
      } catch (err) {
        logger.error('[Job Board] Error fetching skills/preferences:', err);
      }
    }

    logger.debug('[Job Board] search context', {
      userId: userId ? String(userId) : null,
      hasSkills,
      preferredIndustryCount: preferredIndustries.length,
    });

    // --- 2.6. Followed employers are fast-tracked to the top of recommendations ---
    let followedEmployerIds = new Set();
    if (userId) {
      try {
        const follows = await Follow.find({ follower: userId }).select('following');
        followedEmployerIds = new Set(follows.map((f) => String(f.following)));
      } catch (err) {
        console.error('[Job Board] Error fetching followed employers:', err);
      }
    }

    // --- 2.5. Get user's applied jobs (to filter them out) ---
    let appliedJobIds = new Set();
    if (userId) {
      try {
        const JobApplication = require('../models/JobApplication');
        // A withdrawn application should reappear as a normal, un-applied
        // job on the board — applyToJob reactivates that same row if the
        // seeker applies again, so it shouldn't stay hidden as "applied".
        const userApplications = await JobApplication.find({
          applicant: userId,
          status: { $ne: 'withdrawn' },
        }).select('vacancy');
        appliedJobIds = new Set(userApplications.map(app => String(app.vacancy)));
        console.log(`[Job Board] User has applied to ${appliedJobIds.size} jobs`);
      } catch (err) {
        console.error('[Job Board] Error fetching user applications:', err);
      }
    }

    // --- 3. Fetch jobs ---
    const jobs = await JobVacancy.find(filter)
      // Must mirror every job field computeChecklistMatch()/computeUnifiedScore()
      // read (see jobController.getJobById, which fetches the full document) —
      // omitting one here silently drops that dimension's points only on the
      // board, producing a match % that disagrees with the job detail page for
      // the same applicant/job.
      .select('title description responsibilities qualifications industry workNature jobType location salary slots createdAt salaryMin salaryMax employer status isActive archived applicationDeadline minAge maxAge minEducationLevel educationOrEquivalentExperience minExperienceYears languageRequirements')
      .populate('employer', 'name email phone companyName companyDescription website verificationStatus industry companySize businessAddress profileImage')
      .sort({ createdAt: -1 })
      .lean();

    if (!jobs.length) {
      console.log('[Job Board] No jobs found.');
      return res.json({ jobs: [], total: 0, hasSkills });
    }

    // --- 3.5 Get application counts for all jobs ---
    const jobIds = jobs.map(job => job._id);
    const [countMap, hiredCountMap] = await Promise.all([
      getApplicationCountMap(jobIds),
      getHiredCountMap(jobIds),
    ]);

    const visibleJobs = jobs.filter((job) => {
      if (job.archived || job.status === "closed") return false;
      if (!job.applicationDeadline) return true;

      const deadline = new Date(job.applicationDeadline);
      if (Number.isNaN(deadline.getTime())) return true;

      return deadline >= now;
    });

    let rankedJobs = [];

    // --- 4. Filter out jobs user has already applied to ---
    let filteredJobs = visibleJobs.filter(job => !appliedJobIds.has(String(job._id)));
    if (appliedJobIds.size > 0) {
      console.log(`[Job Board] Filtered out ${jobs.length - filteredJobs.length} applied jobs`);
    }

    // --- 5. Apply strict mode filtering if needed ---
    let finalFilteredJobs = filteredJobs;
    if (industryPreferenceLevel === 'strict' && preferredIndustries.length > 0) {
      finalFilteredJobs = filteredJobs.filter((job) => {
        const jobIndustries = Array.isArray(job.industry) ? job.industry : [job.industry].filter(Boolean);
        return jobIndustries.some((ind) => preferredIndustries.includes(ind));
      });
      console.log(`[Job Board] Strict mode: ${finalFilteredJobs.length}/${filteredJobs.length} jobs match preferred industries`);
    }

    // --- 6. Ranking ---
    // Personalize whenever the seeker has any usable signal, not just skills /
    // industry — a freshly completed NSRP profile often has an occupation,
    // education level and work history before discrete "skills" are typed in.
    const canPersonalize =
      hasSkills ||
      preferredIndustries.length > 0 ||
      preferredOccupations.length > 0 ||
      workHistory.length > 0 ||
      Boolean(educationalAttainment) ||
      Boolean(desiredJobTitle);

    // Starts equal to finalFilteredJobs.length; onlyMeetsRequired narrows it
    // to however many of those actually survive the checklist filter, so
    // pagination (below) counts the set actually being paged through.
    let matchedTotal = finalFilteredJobs.length;
    // The count BEFORE onlyMeetsRequired narrows it — stays equal to
    // matchedTotal when the filter is off. §A.4: "pair onlyMeetsRequired
    // with the count of what it hides" needs both numbers so a filter that
    // empties the board can say how many it hid, not just show zero.
    let unfilteredMatchedTotal = finalFilteredJobs.length;

    if (canPersonalize) {
      // §C.1 — batch-resolve every job's effective weights (per-vacancy
      // override → that job's employer default → admin default → code
      // fallback) in 3 queries total, regardless of how many jobs or
      // employers are in this result set — never one query per job.
      const weightsByJobId = await buildWeightsByJobId(finalFilteredJobs);
      const ranked = rankJobsBySkills(finalFilteredJobs, skills, {
        limit: parsedLimit,
        skip: parsedSkip,
        weightsByJobId,
        preferredIndustries,
        industryPreferenceLevel,
        followedEmployerIds,
        expectedSalaryMin,
        expectedSalaryMax,
        preferredOccupations,
        workHistory,
        educationalAttainment,
        workExperienceBand,
        desiredJobTitle,
        seekerDateOfBirth,
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
        sortBy: normalizedSortBy,
        onlyMeetsRequired: requireAllMustHaves,
      });
      rankedJobs = ranked.items;
      matchedTotal = ranked.total;
      unfilteredMatchedTotal = ranked.unfilteredTotal;
    } else {
      const isFollowedJob = (job) => {
        const employerId = job.employer?._id || job.employer;
        return Boolean(employerId && followedEmployerIds.has(String(employerId)));
      };

      // Still-minimal seeker signal (no skills/industry/etc. on file) is
      // enough to compute the literal "requirements met" checklist, even
      // though it's not enough to personalize ranking above. Built through
      // the same buildSeekerForMatching() shape every other call site uses
      // (see server/services/matchProfileService.js), so this path can't
      // silently drop a field the others have.
      const minimalSeeker = buildSeekerForMatching(
        { skills, educationalAttainment, workExperience: workExperienceBand, desiredJobTitle, dateOfBirth: seekerDateOfBirth },
        {
          skills, expectedSalaryMin, expectedSalaryMax, preferredOccupations, preferredIndustries,
          workHistory, languageProficiency, professionalLicenses, eligibilities, vocationalTrainings,
          course, yearGraduated, presentAddress, preferredWorkLocationLocal, preferredJobTypes, preferredWorkNature,
        }
      );

      let withChecklist = finalFilteredJobs.map((job) => ({
        ...job,
        relevanceScore: 0,
        isFollowedEmployer: isFollowedJob(job),
        checklistMatch: computeChecklistMatch(job, minimalSeeker),
      }));
      unfilteredMatchedTotal = withChecklist.length;

      if (requireAllMustHaves) {
        withChecklist = withChecklist.filter((job) => {
          const m = job.checklistMatch;
          if (!m || m.disqualified) return false;
          return m.totalMustHaves === 0 || m.metMustHaves === m.totalMustHaves;
        });
        matchedTotal = withChecklist.length;
      }

      if (normalizedSortBy === 'salary') {
        const payOf = (job) => (Number.isFinite(job.salaryMax) ? job.salaryMax : Number.isFinite(job.salaryMin) ? job.salaryMin : -1);
        withChecklist.sort((a, b) => payOf(b) - payOf(a));
      } else {
        // Stable sort: followed-employer jobs float to the top, then the
        // displayed checklist % (highest first) — even a seeker too bare to
        // personalize ranking still has a computed checklistMatch.percent,
        // and the board should never show it out of order with that number.
        // Ties keep their existing (newest-first) order.
        withChecklist.sort((a, b) => {
          const aFollowed = a.isFollowedEmployer;
          const bFollowed = b.isFollowedEmployer;
          if (aFollowed !== bFollowed) return aFollowed ? -1 : 1;
          const aPercent = a.checklistMatch?.percent ?? -1;
          const bPercent = b.checklistMatch?.percent ?? -1;
          return bPercent - aPercent;
        });
      }

      rankedJobs = withChecklist.slice(parsedSkip, parsedSkip + parsedLimit);
    }

    // --- 7. Attach application counts and format ---
    const jobsWithCounts = rankedJobs.map(job => {
      const jobObj = { ...job };
      jobObj.applicationCount = Number(countMap[String(job._id)] || 0);
      jobObj.remainingSlots = Math.max(0, Number(jobObj.slots || 0) - Number(hiredCountMap[String(job._id)] || 0));
      return jobObj;
    });

    // --- 8. Response ---
    res.json({
      jobs: jobsWithCounts,
      total: matchedTotal,
      // Count before the onlyMeetsRequired filter narrowed it — equal to
      // `total` when the filter is off. Lets the UI say "N hidden by this
      // filter" instead of leaving an emptied board unexplained.
      unfilteredTotal: unfilteredMatchedTotal,
      limit: parsedLimit,
      skip: parsedSkip,
      pagination: {
        total: matchedTotal,
        page: parsedPage,
        pages: Math.max(1, Math.ceil(matchedTotal / parsedLimit)),
        limit: parsedLimit,
      },
      hasSkills,
      preferredIndustries, // Send back to frontend so it can update user context
      industryPreferenceLevel,
    });
  } catch (error) {
    console.error('[Job Board] ERROR:', error);
    res.status(500).json({ message: 'Server error during job search' });
  }
};