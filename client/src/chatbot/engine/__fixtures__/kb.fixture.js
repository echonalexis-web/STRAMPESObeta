// Small hand-written KB used only by engine tests. NOT the real KB (Task 4).
// Schema per plan Part B.
const base = {
  kind: 'nav+faq',
  followUps: [],
  contact: false,
  status: 'approved',
  policy: null,
  reviewedAt: '2026-11-07',
  reviewedBy: 'test-fixture',
  priority: 0,
};

const e = (o) => ({ ...base, ...o });

export default [
  e({
    id: 'public.account.register', category: 'account-login', roles: ['public'],
    q: { en: 'How do I create an account?', fil: 'Paano gumawa ng account?' },
    a: { en: 'Open Register and fill in the form.', fil: 'Buksan ang Register at punan ang form.' },
    keywords: { en: ['register account', 'sign up'], fil: ['mag register', 'gumawa account'] },
    target: 'register',
  }),
  e({
    id: 'public.account.login', category: 'account-login', roles: ['public'],
    q: { en: 'How do I log in?', fil: 'Paano mag-login?' },
    a: { en: 'Open Login and enter your email and password.', fil: 'Buksan ang Login.' },
    keywords: { en: ['log in', 'sign in to account'], fil: ['mag login', 'pasok account'] },
    target: 'login',
  }),
  e({
    id: 'jobseeker.profile.edit', category: 'profile', roles: ['jobseeker'],
    q: { en: 'How do I edit my profile?', fil: 'Paano ko babaguhin ang aking profile?' },
    a: { en: 'Open Edit Profile to update your details.', fil: 'Buksan ang Edit Profile.' },
    keywords: { en: ['edit profile', 'update profile', 'change my details'], fil: ['baguhin profile', 'palitan profile'] },
    target: 'profile.edit',
  }),
  e({
    id: 'jobseeker.profile.privacy', category: 'settings-privacy', roles: ['jobseeker'],
    q: { en: 'Who can see my profile?', fil: 'Sino ang makakakita ng profile ko?' },
    a: { en: 'Open Settings to control profile visibility.', fil: 'Buksan ang Settings.' },
    keywords: { en: ['profile privacy', 'profile visibility'], fil: ['privacy ng profile', 'visibility profile'] },
    target: 'settings',
  }),
  e({
    id: 'jobseeker.photo.change', category: 'profile', roles: ['jobseeker'],
    q: { en: 'How do I change my photo?', fil: 'Paano palitan ang aking larawan?' },
    a: { en: 'Open Edit Profile and pick a new photo.', fil: 'Buksan ang Edit Profile.' },
    keywords: { en: ['new picture', 'replace picture'], fil: ['ibang larawan', 'bagong litrato'] },
    target: 'profile.edit',
  }),
  e({
    id: 'jobseeker.apply.how', category: 'jobs-applications', roles: ['jobseeker'],
    q: { en: 'How do I apply for a job?', fil: 'Paano mag-apply sa trabaho?' },
    a: { en: 'Open Browse Jobs, pick a vacancy and press Apply.', fil: 'Buksan ang Browse Jobs.' },
    keywords: { en: ['apply for job', 'apply job', 'send application'], fil: ['mag apply trabaho', 'apply sa trabaho'] },
    target: 'jobs',
  }),
  e({
    id: 'jobseeker.applications.status', category: 'jobs-applications', roles: ['jobseeker'],
    q: { en: 'How do I check my application status?', fil: 'Paano makita ang status ng aking application?' },
    a: { en: 'Open Your Applications to see each status.', fil: 'Buksan ang Your Applications.' },
    keywords: { en: ['check application status', 'application status', 'track application'], fil: ['status ng application', 'tingnan application'] },
    target: 'applications',
  }),
  e({
    id: 'jobseeker.jobs.browse', category: 'jobs-applications', roles: ['jobseeker'],
    q: { en: 'Where is Browse Jobs?', fil: 'Nasaan ang Browse Jobs?' },
    a: { en: 'Browse Jobs is in the top menu.', fil: 'Nasa itaas na menu ang Browse Jobs.' },
    keywords: { en: ['browse jobs', 'find jobs', 'job list'], fil: ['maghanap trabaho', 'listahan trabaho'] },
    target: 'jobs',
  }),
  e({
    id: 'jobseeker.resume.upload', category: 'resume-documents', roles: ['jobseeker'],
    q: { en: 'How do I upload my resume?', fil: 'Paano mag-upload ng resume?' },
    a: { en: 'Open My Resume and upload your file.', fil: 'Buksan ang My Resume.' },
    keywords: { en: ['upload resume', 'resume file'], fil: ['mag upload resume', 'ilagay resume'] },
    target: 'profile.resume',
  }),
  e({
    id: 'jobseeker.resume.delete', category: 'resume-documents', roles: ['jobseeker'],
    q: { en: 'How do I delete my resume?', fil: 'Paano burahin ang aking resume?' },
    a: { en: 'Open My Resume and remove the file.', fil: 'Buksan ang My Resume.' },
    keywords: { en: ['delete resume', 'remove old resume'], fil: ['burahin resume', 'alisin resume'] },
    target: 'profile.resume',
  }),
  e({
    id: 'jobseeker.draft.stars', category: 'getting-started', roles: ['jobseeker'],
    status: 'draft', policy: 'POL-03', reviewedAt: undefined,
    q: { en: 'How do I redeem loyalty stars?', fil: 'Paano i-redeem ang loyalty stars?' },
    a: { en: 'Pending PESO decision.', fil: 'Naghihintay ng desisyon ng PESO.' },
    keywords: { en: ['redeem loyalty stars', 'loyalty stars'], fil: ['i redeem stars', 'loyalty stars points'] },
  }),
  e({
    id: 'employer.job.post', category: 'post-and-manage-jobs', roles: ['employer'],
    q: { en: 'How do I post a job?', fil: 'Paano mag-post ng trabaho?' },
    a: { en: 'Open Post Vacancy once your company is verified.', fil: 'Buksan ang Post Vacancy.' },
    keywords: { en: ['post job', 'create vacancy'], fil: ['mag post trabaho', 'maglagay vacancy'] },
    target: 'post-job',
  }),
  e({
    id: 'employer.verification.how', category: 'employer-verification', roles: ['employer'],
    q: { en: 'How does employer verification work?', fil: 'Paano gumagana ang verification ng employer?' },
    a: { en: 'PESO reviews your documents before you can post.', fil: 'Rerepasuhin ng PESO ang dokumento.' },
    keywords: { en: ['employer verification', 'verify company'], fil: ['verification employer', 'patunayan kumpanya'] },
    target: 'employer.dashboard',
  }),
  e({
    id: 'admin.employers.approve', category: 'admin-tools', roles: ['admin', 'superadmin'],
    q: { en: 'How do admins approve employers?', fil: 'Paano mag-approve ng employer ang admin?' },
    a: { en: 'Open the employer queue.', fil: 'Buksan ang employer queue.' },
    keywords: { en: ['approve employer', 'employer queue'], fil: ['approve employer admin', 'pila employer'] },
  }),
  e({
    id: 'admin.audit.log', category: 'admin-tools', roles: ['admin', 'superadmin'],
    q: { en: 'Where is the audit log?', fil: 'Nasaan ang audit log?' },
    a: { en: 'Open Audit Log from the admin menu.', fil: 'Buksan ang Audit Log.' },
    keywords: { en: ['audit log', 'activity history'], fil: ['audit log admin', 'kasaysayan aktibidad'] },
  }),
  e({
    id: 'general.contact.peso', category: 'contact-peso', roles: ['*'], contact: true,
    q: { en: 'How do I contact PESO?', fil: 'Paano makipag-ugnayan sa PESO?' },
    a: { en: 'Use the contact details below.', fil: 'Gamitin ang contact details sa ibaba.' },
    keywords: { en: ['contact peso', 'peso office'], fil: ['makipag ugnayan peso', 'opisina peso'] },
  }),
];
