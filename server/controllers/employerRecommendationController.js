const JobVacancy = require('../models/JobVacancy');
const JobApplication = require('../models/JobApplication');
const User = require('../models/User');
const JobseekerProfile = require('../models/JobseekerProfile');
const { rankApplicantsByJob } = require('../services/semanticService');

/**
 * GET /api/employer/jobs/:jobId/applicants/ranked
 * Returns applicants for a job, sorted by semantic relevance.
 */
exports.getRankedApplicants = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    // 1. Find the job (with the employer's industry, used as a fallback when
    //    the job itself has no industry set).
    const job = await JobVacancy.findById(jobId).populate('employer', 'industry companyName');
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // 2. Check ownership
    const jobEmployerId = String(job.employer?._id || job.employer);
    if (jobEmployerId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // 3. Fetch applications with applicant user and profile
    let applications = await JobApplication.find({ vacancy: jobId })
      .populate({
        path: 'applicant',
        select: 'name email phone address about desiredJobTitle workExperience educationalAttainment skills dateOfBirth isActive',
      })
      .lean();

    // Exclude applicants whose account is suspended/deleted.
    applications = applications.filter(app => app.applicant && app.applicant.isActive !== false);

    if (!applications.length) {
      return res.json({ applicants: [], total: 0 });
    }

    // 4. Fetch jobseeker profiles for these applicants. Pull the NSRP Form 1
    //    fields the matcher now scores against (occupation, education detail,
    //    work history, trainings, eligibilities, licenses, industry prefs).
    const applicantIds = applications.map(app => app.applicant._id);
    const profiles = await JobseekerProfile.find({ userId: { $in: applicantIds } })
      .select(
        'userId skills expectedSalaryMin expectedSalaryMax preferredIndustries ' +
        'preferredOccupations course schoolAttended yearGraduated workHistory ' +
        'vocationalTrainings eligibilities professionalLicenses languageProficiency'
      )
      .lean();

    const profileMap = {};
    profiles.forEach(p => {
      profileMap[String(p.userId)] = p;
    });

    // 5. Build applicant objects for ranking
    const applicantsForRanking = applications.map(application => {
      const applicantUser = application.applicant;
      const profile = profileMap[String(applicantUser._id)] || {};
      return {
        ...application,
        user: applicantUser,
        profile: {
          // Skills may exist in either the normalized profile or the legacy
          // User document. Merge both so ranking never silently scores 0.
          skills: [
            ...(Array.isArray(profile.skills) ? profile.skills : []),
            ...(Array.isArray(applicantUser.skills) ? applicantUser.skills : []),
          ].filter((skill, index, skills) =>
            skills.findIndex(item => String(item).trim().toLowerCase() === String(skill).trim().toLowerCase()) === index
          ),
          workExperience: applicantUser.workExperience || '',
          educationalAttainment: applicantUser.educationalAttainment || '',
          expectedSalaryMin: Number.isFinite(profile.expectedSalaryMin) ? profile.expectedSalaryMin : null,
          expectedSalaryMax: Number.isFinite(profile.expectedSalaryMax) ? profile.expectedSalaryMax : null,
          preferredIndustries: Array.isArray(profile.preferredIndustries) ? profile.preferredIndustries : [],
          preferredOccupations: Array.isArray(profile.preferredOccupations) ? profile.preferredOccupations : [],
          course: profile.course || null,
          yearGraduated: profile.yearGraduated || null,
          workHistory: Array.isArray(profile.workHistory) ? profile.workHistory : [],
          vocationalTrainings: Array.isArray(profile.vocationalTrainings) ? profile.vocationalTrainings : [],
          eligibilities: Array.isArray(profile.eligibilities) ? profile.eligibilities : [],
          professionalLicenses: Array.isArray(profile.professionalLicenses) ? profile.professionalLicenses : [],
          languageProficiency: profile.languageProficiency || null,
        },
      };
    });

    // 6. Rank
    const ranked = rankApplicantsByJob(job, applicantsForRanking, { limit: Number(limit), skip: Number(skip) });

    // 7. Format response (clean up)
    const formatted = ranked.map(item => ({
      _id: item._id,
      applicant: {
        _id: item.user._id,
        name: item.user.name,
        email: item.user.email,
        phone: item.user.phone,
        skills: item.profile.skills,
        workExperience: item.user.workExperience,
        educationalAttainment: item.user.educationalAttainment,
      },
      vacancy: item.vacancy,
      status: item.status,
      appliedAt: item.createdAt || item.appliedAt,
      employerNote: item.employerNote,
      resume: item.resume,
      interview: item.interview || null,
      relevanceScore: item.relevanceScore,
      matchBreakdown: item.matchBreakdown || null,
      disqualified: item.disqualified || null,
    }));

    res.json({
      applicants: formatted,
      total: applications.length,
      limit: Number(limit),
      skip: Number(skip),
    });
  } catch (error) {
    console.error('Ranked applicants error:', error);
    res.status(500).json({ message: 'Failed to fetch ranked applicants' });
  }
};