// Employer entries. Navigation-only; each claim was checked against the page
// code named in the comment above the entry (2026-11-08).
//
// POLICY/VERIFY (file-wide): Filipino wording is machine-drafted and needs a
// native-Filipino review; English wording needs PESO content-owner review.
// Approved here means "code-verified navigation", not "PESO-approved policy".
// Which documents prove a company is legitimate (POL-04) and how long review
// takes (POL-05) are drafts at the bottom of the file.
import { entry, draft } from './entry.js';

const EMP = ['employer'];

export default [
  // components/JobPostingForm.jsx steps: Job basics, Pay & location, Eligibility, Qualifications, Matching weights;
  // submit button "Post job vacancy". Route is verified-employers-only (routes/registry.js post-job);
  // unverified employers get the verification explanation via resolveLink, never a dead link.
  entry({
    id: 'employer.post.how', category: 'post-and-manage-jobs', kind: 'nav+faq', roles: EMP,
    q: { en: 'How do I post a job vacancy?', fil: 'Paano mag-post ng job vacancy?' },
    a: {
      en: 'Open Post Vacancy and work through the steps. Only verified companies can post; if yours is not verified yet, open My Profile and check the Verification section first.',
      fil: 'Buksan ang Post Vacancy at sundan ang mga hakbang. Mga verified na kumpanya lang ang puwedeng mag-post; kung hindi pa verified ang sa iyo, buksan muna ang My Profile at tingnan ang Verification section.',
    },
    steps: {
      en: ['Open Post Vacancy from the menu.', 'Fill in Job basics, then Pay & location.', 'Complete Eligibility, Qualifications and Matching weights.', 'When it says Ready to post, click Post job vacancy.'],
      fil: ['Buksan ang Post Vacancy sa menu.', 'Punan ang Job basics, saka ang Pay & location.', 'Kumpletuhin ang Eligibility, Qualifications at Matching weights.', 'Kapag sinabing Ready to post, i-click ang Post job vacancy.'],
    },
    keywords: {
      en: ['post job', 'post vacancy', 'create job posting', 'add new vacancy'],
      fil: ['mag post ng trabaho', 'maglagay ng vacancy', 'mag post ng bakante'],
    },
    target: 'post-job', followUps: ['employer.verification.where', 'employer.templates.use'],
  }),

  // pages/ProfilePage.jsx employer view: section "Verification" (sec-verification) renders components/VerificationTab.jsx
  // (status banner Unverified / Pending verification / Verified / Rejected, two upload areas, submit).
  // Also the EmployerDashboard "Verification Required" dialog sends the employer to /profile.
  // POLICY/VERIFY: deliberately does not list which documents count (POL-04).
  entry({
    id: 'employer.verification.where', category: 'employer-verification', kind: 'nav+faq', roles: EMP, contact: true,
    q: { en: 'Where do I verify my company?', fil: 'Saan ko ive-verify ang kumpanya ko?' },
    a: {
      en: 'Open My Profile and go to the Verification section. It shows your verification status and lets you upload the documents it asks for and submit them for review. Questions about what to submit can go to PESO.',
      fil: 'Buksan ang My Profile at pumunta sa Verification section. Ipinapakita nito ang status ng verification at doon mo maia-upload ang hinihinging dokumento at maipapasa para ma-review. Maaaring itanong sa PESO kung ano ang ipapasa.',
    },
    keywords: {
      en: ['verify company', 'employer verification', 'submit verification documents', 'company verified'],
      fil: ['beripikasyon ng kumpanya', 'i-verify ang negosyo', 'ipasa ang dokumento ng verification'],
    },
    target: 'profile',
  }),

  // Same page; explains why posting is blocked. The bot cannot read the account's status.
  entry({
    id: 'employer.verification.blocked', category: 'employer-verification', kind: 'faq', roles: EMP,
    q: { en: 'Why am I asked for verification when I try to post?', fil: 'Bakit hinihingan ako ng verification kapag magpo-post ako?' },
    a: {
      en: 'Posting and managing vacancies needs a verified company account. The Verification section on My Profile shows whether your account is unverified, pending, verified or rejected, and what to do next.',
      fil: 'Kailangan ng verified na company account para mag-post at mag-manage ng vacancy. Ipinapakita ng Verification section sa My Profile kung unverified, pending, verified o rejected ang account mo, at ang susunod na gagawin.',
    },
    keywords: {
      en: ['verification required', 'cannot post unverified', 'verification pending', 'rejected verification'],
      fil: ['kailangan ng verification', 'hindi makapag post dahil unverified', 'pending na verification'],
    },
    target: 'profile',
  }),

  // pages/EmployerDashboard.jsx tabs: Overview, Job Postings, Applicants, Matching Preferences, Archived.
  // Applicants tab: pick a job, then filter All / Pending / Shortlisted / Hired / Rejected.
  entry({
    id: 'employer.applicants.review', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'Where do I review applicants?', fil: 'Saan ko titingnan ang mga applicant?' },
    a: {
      en: 'Open the Employer Dashboard and click the Applicants tab. Pick one of your job postings to see its ranked applicants, then filter by All, Pending, Shortlisted, Hired or Rejected.',
      fil: 'Buksan ang Employer Dashboard at i-click ang Applicants tab. Pumili ng isa sa mga job posting mo para makita ang mga ranked na applicant, saka salain ayon sa All, Pending, Shortlisted, Hired o Rejected.',
    },
    keywords: {
      en: ['review applicants', 'ranked applicants', 'applicants tab', 'see who applied'],
      fil: ['tingnan ang mga applicant', 'sino ang nag apply', 'applicants tab'],
    },
    target: 'employer.dashboard', followUps: ['employer.applicants.actions', 'employer.interview.schedule'],
  }),

  // components/RankedApplicantsTable.jsx RowMenu: Shortlist, Reject, Schedule interview, Mark as no-show,
  // View full profile, Send message. EmployerDashboard bulk bar: Shortlist, Schedule Interview, Reject.
  entry({
    id: 'employer.applicants.actions', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'How do I shortlist, reject or message an applicant?', fil: 'Paano mag-shortlist, mag-reject o mag-message ng applicant?' },
    a: {
      en: 'In the Applicants tab, open the More actions menu on an applicant: Shortlist, Reject, Schedule interview, View full profile or Send message. To act on several at once, tick their boxes and use the bar that appears.',
      fil: 'Sa Applicants tab, buksan ang More actions menu ng applicant: Shortlist, Reject, Schedule interview, View full profile o Send message. Para sa marami nang sabay, lagyan ng tsek ang mga kahon at gamitin ang lumalabas na bar.',
    },
    keywords: {
      en: ['shortlist applicant', 'reject applicant', 'message applicant', 'bulk applicant actions'],
      fil: ['i-shortlist ang applicant', 'i-reject ang applicant', 'mag message sa applicant'],
    },
    target: 'employer.dashboard',
  }),

  // EmployerDashboard: toast "Interview scheduled and applicant notified"; RowMenu label
  // "Schedule interview" / "Reschedule interview"; bulk "Schedule Interview".
  entry({
    id: 'employer.interview.schedule', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'How do I schedule an interview?', fil: 'Paano mag-schedule ng interview?' },
    a: {
      en: 'In the Applicants tab, open the More actions menu on the applicant and choose Schedule interview. The applicant is notified. To book several people at once, tick them and use Schedule Interview in the bar.',
      fil: 'Sa Applicants tab, buksan ang More actions menu ng applicant at piliin ang Schedule interview. Aabisuhan ang applicant. Para sa marami nang sabay, lagyan sila ng tsek at gamitin ang Schedule Interview sa bar.',
    },
    keywords: {
      en: ['schedule interview', 'book an interview', 'reschedule interview', 'interview date'],
      fil: ['mag schedule ng interview', 'iskedyul ng interview', 'petsa ng interview'],
    },
    target: 'employer.dashboard',
  }),

  // EmployerDashboard Job Postings tab: job menu has "Edit posting", "Close posting" / "Reopen posting", "Delete";
  // Archived tab holds closed and filled postings (employerDashboard.archived.emptyBody).
  entry({
    id: 'employer.jobs.manage', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'How do I edit or close one of my vacancies?', fil: 'Paano baguhin o isara ang isa sa mga vacancy ko?' },
    a: {
      en: 'Open the Employer Dashboard and the Job Postings tab. The menu on each posting has Edit posting and Close posting (or Reopen posting for a closed one).',
      fil: 'Buksan ang Employer Dashboard at ang Job Postings tab. Nasa menu ng bawat posting ang Edit posting at Close posting (o Reopen posting kung sarado na).',
    },
    keywords: {
      en: ['edit job', 'close job', 'reopen closed job', 'manage my vacancies'],
      fil: ['baguhin ang vacancy', 'isara ang vacancy', 'buksan muli ang vacancy'],
    },
    target: 'employer.dashboard',
  }),

  entry({
    id: 'employer.jobs.archived', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'Where are my closed or filled vacancies kept?', fil: 'Nasaan ang mga sarado o napunan nang vacancy?' },
    a: {
      en: 'Open the Employer Dashboard and click the Archived tab. Closed and filled postings are kept there, with a short report on how each one went.',
      fil: 'Buksan ang Employer Dashboard at i-click ang Archived tab. Doon nakalagay ang mga sarado at napunan nang posting, may maikling ulat kung paano ito nangyari.',
    },
    keywords: {
      en: ['archived vacancies', 'closed and filled jobs', 'archived tab', 'old vacancies summary'],
      fil: ['mga archived na vacancy', 'saradong vacancy', 'archived tab ng employer'],
    },
    target: 'employer.dashboard',
  }),

  // EmployerDashboard Matching Preferences tab (employerDashboard.matchWeights): weights must total 100%;
  // individual jobs can override from their own edit page.
  entry({
    id: 'employer.matching.preferences', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'Where do I set the matching preferences for applicants?', fil: 'Saan ko itatakda ang matching preferences ng mga applicant?' },
    a: {
      en: 'Open the Employer Dashboard and click the Matching Preferences tab. Move the sliders for how much each factor counts; the weights must add up to exactly 100% before you can save. A single job can still override this from its own edit page.',
      fil: 'Buksan ang Employer Dashboard at i-click ang Matching Preferences tab. Galawin ang mga slider kung gaano kabigat ang bawat factor; dapat eksaktong 100% ang kabuuan bago ma-save. Puwede pa ring i-override ito ng isang job sa sarili nitong edit page.',
    },
    keywords: {
      en: ['matching preferences', 'matching weights', 'weight sliders', 'sliders total 100 percent'],
      fil: ['matching preferences tab', 'timbang ng matching', 'slider ng timbang'],
    },
    target: 'employer.dashboard',
  }),

  // pages/EditProfile.jsx employer tabs: Company Info, NSRP Details, Documents; "Save Profile".
  entry({
    id: 'employer.profile.edit', category: 'profile', roles: EMP,
    q: { en: 'How do I update my company details?', fil: 'Paano baguhin ang detalye ng kumpanya ko?' },
    a: {
      en: 'Open Edit Profile. Use the Company Info tab for your company details, then click Save Profile.',
      fil: 'Buksan ang Edit Profile. Gamitin ang Company Info tab para sa detalye ng kumpanya, saka i-click ang Save Profile.',
    },
    keywords: {
      en: ['update company details', 'edit company profile', 'change business information', 'company info tab'],
      fil: ['baguhin ang detalye ng kumpanya', 'palitan ang impormasyon ng negosyo', 'profile ng kumpanya'],
    },
    target: 'profile.edit',
  }),

  // pages/ProfilePage.jsx: tab "Followers (n)" at /profile/followers for employers.
  entry({
    id: 'employer.followers.view', category: 'profile', roles: EMP,
    q: { en: 'Where can I see who follows my company?', fil: 'Saan makikita kung sino ang sumusubaybay sa kumpanya ko?' },
    a: {
      en: 'Open My Profile and click the Followers tab. It lists the people who follow your company.',
      fil: 'Buksan ang My Profile at i-click ang Followers tab. Nakalista roon ang mga sumusubaybay sa kumpanya mo.',
    },
    keywords: {
      en: ['company followers', 'who follows us', 'followers tab', 'follower count'],
      fil: ['mga follower ng kumpanya', 'sino ang nag follow', 'followers tab'],
    },
    target: 'profile.followers',
  }),

  // pages/Settings.jsx TemplatesSection (employer only): "Qualification Templates", saved from the
  // Qualifications step of the posting form ("Save as template").
  entry({
    id: 'employer.templates.use', category: 'post-and-manage-jobs', roles: EMP,
    q: { en: 'Where are my saved qualification templates?', fil: 'Nasaan ang mga na-save kong qualification template?' },
    a: {
      en: 'Open Settings and choose Templates. Templates are saved from the Qualifications step of the posting form with Save as template, and you can delete ones you no longer need here.',
      fil: 'Buksan ang Settings at piliin ang Templates. Sine-save ang template sa Qualifications step ng posting form gamit ang Save as template, at dito mo mabubura ang hindi mo na kailangan.',
    },
    keywords: {
      en: ['qualification templates', 'saved templates', 'reuse qualifications', 'save as template'],
      fil: ['mga template ng qualification', 'naka save na template', 'gamitin muli ang qualifications'],
    },
    target: 'settings',
  }),

  // pages/EmployerDashboard.jsx Overview tab: Pending review, Active jobs, Total applicants, Hired; Recent applicants.
  entry({
    id: 'employer.dashboard.open', category: 'getting-started', roles: EMP,
    q: { en: 'Where is the employer dashboard?', fil: 'Nasaan ang employer dashboard?' },
    a: {
      en: 'Open Employer Dashboard in the menu. Its Overview tab shows pending reviews, active jobs, total applicants and recent applicants, and the other tabs cover postings, applicants, matching and archived jobs.',
      fil: 'Buksan ang Employer Dashboard sa menu. Ipinapakita ng Overview tab ang pending na review, active na job, kabuuang applicant at mga bagong applicant, at ang ibang tab ay para sa postings, applicants, matching at archived na job.',
    },
    keywords: {
      en: ['employer dashboard', 'employer home', 'overview tab', 'dashboard tabs'],
      fil: ['dashboard ng employer', 'unang pahina ng employer', 'overview tab'],
    },
    target: 'employer.dashboard',
  }),

  // ---- Policy topics: written, held as drafts until PESO answers. Never matched. ----
  draft('POL-04', {
    id: 'employer.verification.documents', category: 'employer-verification', roles: EMP,
    q: { en: 'Which documents prove my company is legitimate?', fil: 'Anong mga dokumento ang magpapatunay na lehitimo ang kumpanya ko?' },
    a: {
      en: 'Pending PESO confirmation of the accepted documents and their format. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa mga tinatanggap na dokumento at format. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['accepted business documents', 'verification requirements', 'proof of company'], fil: ['kailangang dokumento ng kumpanya', 'requirements sa verification', 'patunay ng negosyo'] },
    target: 'profile',
  }),
  draft('POL-05', {
    id: 'employer.verification.turnaround', category: 'employer-verification', roles: EMP,
    q: { en: 'How long does employer verification take and what if it is rejected?', fil: 'Gaano katagal ang verification ng employer at ano ang gagawin kung na-reject?' },
    a: {
      en: 'Pending PESO confirmation of the review time and what to do after a rejection. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa tagal ng review at susunod na gagawin kapag na-reject. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['verification turnaround', 'how long to verify', 'verification rejected what next'], fil: ['gaano katagal ang verification', 'na reject ang verification', 'ilang araw ang review'] },
  }),
];
