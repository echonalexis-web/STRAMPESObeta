const JobVacancy = require('../models/JobVacancy');
const JobseekerProfile = require('../models/JobseekerProfile');
const Follow = require('../models/Follow');
const { rankJobsBySkills } = require('../services/semanticService');
const { getApplicationCountMap } = require('../utils/jobDisplay');

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
    } = req.query;

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

    console.log(`[Job Board] === START ===`);
    console.log(`[Job Board] userId from req.user: ${userId}`);
    console.log(`[Job Board] Full req.user:`, req.user);

    // --- 1. Build filter ---
    const filter = { isActive: true, status: { $ne: 'closed' }, archived: { $ne: true } };
    if (industry) filter.industry = industry;
    if (workNature) filter.workNature = workNature;
    if (jobType) filter.jobType = jobType;
    if (location) filter.location = { $regex: location, $options: 'i' };

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
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
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

    if (userId) {
      try {
        const profile = await JobseekerProfile.findOne({ userId })
          .select('skills preferredIndustries expectedSalaryMin expectedSalaryMax preferredOccupations workHistory languageProficiency')
          .lean();
        const User = require('../models/User');
        const user = await User.findById(userId)
          .select('preferredIndustries industryPreferenceLevel educationalAttainment workExperience desiredJobTitle dateOfBirth')
          .lean();
        
        console.log(`[Job Board] Profile found:`, profile ? 'YES' : 'NO');
        console.log(`[Job Board] Profile skills:`, profile?.skills);
        console.log(`[Job Board] Preferred Industries:`, profile?.preferredIndustries);
        
        const profileSkills = Array.isArray(profile?.skills) ? profile.skills : [];
        const skillSet = new Set();
        profileSkills.forEach(skill => {
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

        console.log(`[Job Board] Profile skills (${skills.length}):`, skills);
        console.log(`[Job Board] Preferred Industries (${preferredIndustries.length}):`, preferredIndustries);
        console.log(`[Job Board] Industry Preference Level:`, industryPreferenceLevel);
      } catch (err) {
        console.error('[Job Board] Error fetching skills/preferences:', err);
      }
    }

    console.log(`[Job Board] hasSkills: ${hasSkills}, Preferred Industries: ${preferredIndustries.length}`);

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
        const userApplications = await JobApplication.find({
          applicant: userId
        }).select('vacancy');
        appliedJobIds = new Set(userApplications.map(app => String(app.vacancy)));
        console.log(`[Job Board] User has applied to ${appliedJobIds.size} jobs`);
      } catch (err) {
        console.error('[Job Board] Error fetching user applications:', err);
      }
    }

    // --- 3. Fetch jobs ---
    const jobs = await JobVacancy.find(filter)
      .select('title description responsibilities qualifications industry workNature jobType location salary slots createdAt salaryMin salaryMax employer status isActive archived applicationDeadline')
      .populate('employer', 'name email phone companyName companyDescription website verificationStatus industry companySize businessAddress profileImage')
      .sort({ createdAt: -1 })
      .lean();

    if (!jobs.length) {
      console.log('[Job Board] No jobs found.');
      return res.json({ jobs: [], total: 0, hasSkills });
    }

    // --- 3.5 Get application counts for all jobs ---
    const jobIds = jobs.map(job => job._id);
    const countMap = await getApplicationCountMap(jobIds);

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
      finalFilteredJobs = filteredJobs.filter(job => preferredIndustries.includes(job.industry));
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

    if (canPersonalize) {
      rankedJobs = rankJobsBySkills(finalFilteredJobs, skills, {
        limit: parsedLimit,
        skip: parsedSkip,
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
      });
    } else {
      const isFollowedJob = (job) => {
        const employerId = job.employer?._id || job.employer;
        return Boolean(employerId && followedEmployerIds.has(String(employerId)));
      };

      // Stable sort: followed-employer jobs float to the top, everything
      // else keeps its existing (newest-first) order.
      const fastTracked = [...finalFilteredJobs].sort((a, b) => {
        const aFollowed = isFollowedJob(a);
        const bFollowed = isFollowedJob(b);
        if (aFollowed !== bFollowed) return aFollowed ? -1 : 1;
        return 0;
      });

      rankedJobs = fastTracked.slice(parsedSkip, parsedSkip + parsedLimit);
      rankedJobs = rankedJobs.map(job => ({ ...job, relevanceScore: 0, isFollowedEmployer: isFollowedJob(job) }));
    }

    // --- 7. Attach application counts and format ---
    const jobsWithCounts = rankedJobs.map(job => {
      const jobObj = { ...job };
      jobObj.applicationCount = Number(countMap[String(job._id)] || 0);
      return jobObj;
    });

    // --- 8. Response ---
    res.json({
      jobs: jobsWithCounts,
      total: finalFilteredJobs.length,
      limit: parsedLimit,
      skip: parsedSkip,
      pagination: {
        total: filteredJobs.length,
        page: parsedPage,
        pages: Math.max(1, Math.ceil(filteredJobs.length / parsedLimit)),
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