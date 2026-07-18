const JobVacancy = require('../models/JobVacancy');
const JobseekerProfile = require('../models/JobseekerProfile');
const User = require('../models/User');
const { rankJobsBySkills } = require('../services/semanticService');

exports.hybridSearch = async (req, res) => {
  try {
    const {
      industry,
      workNature,
      location,
      salaryMin,
      salaryMax,
      q,
      limit = 50,
      skip = 0,
    } = req.query;

    // Use both id and _id (fallback)
    const userId = req.user?.id || req.user?._id;

    console.log(`[Job Board] === START ===`);
    console.log(`[Job Board] userId from req.user: ${userId}`);
    console.log(`[Job Board] Full req.user:`, req.user);

    // --- 1. Build filter ---
    const filter = { status: 'active' };
    if (industry) filter.industry = industry;
    if (workNature) filter.workNature = workNature;
    if (location) filter.location = { $regex: location, $options: 'i' };

    if (salaryMin !== undefined || salaryMax !== undefined) {
      filter.salaryMin = {};
      filter.salaryMax = {};
      if (salaryMin !== undefined) filter.salaryMin.$gte = Number(salaryMin);
      if (salaryMax !== undefined) filter.salaryMax.$lte = Number(salaryMax);
    }

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ];
    }

    // --- 2. Fetch jobs ---
    const fetchLimit = Math.min(Number(limit) + Number(skip), 300);
    const jobs = await JobVacancy.find(filter)
      .select('title description responsibilities qualifications industry workNature location salary createdAt salaryMin salaryMax employer')
      .populate('employer', 'name email phone companyName companyDescription website verificationStatus industry companySize businessAddress')
      .limit(fetchLimit)
      .lean();

    if (!jobs.length) {
      console.log('[Job Board] No jobs found.');
      return res.json({ jobs: [], total: 0, hasSkills: false });
    }

    // --- 3. Get user skills ---
    let rankedJobs = jobs;
    let hasSkills = false;
    let skills = [];

    if (userId) {
      try {
        // Fetch profile
        const profile = await JobseekerProfile.findOne({ userId }).select('skills').lean();
        console.log(`[Job Board] Profile found:`, profile ? 'YES' : 'NO');
        console.log(`[Job Board] Profile skills:`, profile?.skills);

        // Fetch user (for skills stored directly on user)
        const user = await User.findById(userId).select('skills').lean();
        console.log(`[Job Board] User found:`, user ? 'YES' : 'NO');
        console.log(`[Job Board] User skills:`, user?.skills);

        // Merge
        const profileSkills = Array.isArray(profile?.skills) ? profile.skills : [];
        const userSkills = Array.isArray(user?.skills) ? user.skills : [];

        const skillSet = new Set();
        [...profileSkills, ...userSkills].forEach(skill => {
          const normalized = String(skill).trim();
          if (normalized) skillSet.add(normalized);
        });
        skills = Array.from(skillSet);
        hasSkills = skills.length > 0;

        console.log(`[Job Board] Merged skills (${skills.length}):`, skills);
      } catch (err) {
        console.error('[Job Board] Error fetching skills:', err);
      }
    }

    console.log(`[Job Board] hasSkills: ${hasSkills}`);

    // --- 4. Ranking ---
    if (userId && hasSkills) {
      rankedJobs = rankJobsBySkills(jobs, skills, { limit, skip });
    } else {
      rankedJobs = jobs.slice(skip, skip + limit);
      rankedJobs = rankedJobs.map(job => ({ ...job, relevanceScore: 0 }));
    }

    // --- 5. Response ---
    res.json({
      jobs: rankedJobs,
      total: jobs.length,
      limit: Number(limit),
      skip: Number(skip),
      hasSkills,
    });
  } catch (error) {
    console.error('[Job Board] ERROR:', error);
    res.status(500).json({ message: 'Server error during job search' });
  }
};