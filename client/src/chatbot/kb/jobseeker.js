// Jobseeker entries. Navigation-only; each claim was checked against the page
// code named in the comment above the entry (2026-11-08).
//
// POLICY/VERIFY (file-wide): Filipino wording is machine-drafted and needs a
// native-Filipino review; English wording needs PESO content-owner review.
// Approved here means "code-verified navigation", not "PESO-approved policy".
// Policy topics (POL-01, POL-02, POL-08) are drafts at the bottom of the file.
import { entry, draft } from './entry.js';

const JS = ['jobseeker'];

export default [
  // pages/EditProfile.jsx: tabs Personal Info, Career, Training & Eligibility, NSRP Details, Documents;
  // rail footer says "Fields are saved when you click Save Profile."
  entry({
    id: 'jobseeker.profile.edit', category: 'profile', roles: JS,
    q: { en: 'How do I edit my profile?', fil: 'Paano ko babaguhin ang aking profile?' },
    a: {
      en: 'Open Edit Profile. It has tabs for Personal Info, Career, Training & Eligibility, NSRP Details and Documents. Change what you need, then click Save Profile.',
      fil: 'Buksan ang Edit Profile. May mga tab ito para sa Personal Info, Career, Training & Eligibility, NSRP Details at Documents. Baguhin ang kailangan, saka i-click ang Save Profile.',
    },
    steps: {
      en: ['Open Edit Profile from the link below.', 'Pick a tab on the left, such as Personal Info or Career.', 'Change your details, then click Save Profile.'],
      fil: ['Buksan ang Edit Profile sa link sa ibaba.', 'Pumili ng tab sa kaliwa, tulad ng Personal Info o Career.', 'Baguhin ang iyong detalye, saka i-click ang Save Profile.'],
    },
    keywords: {
      en: ['edit profile', 'update profile', 'change profile details', 'profile information'],
      fil: ['baguhin profile', 'palitan profile', 'i-update profile', 'ayusin profile'],
    },
    target: 'profile.edit', followUps: ['common.profile.photo', 'jobseeker.profile.nsrp'],
  }),

  // EditProfile tab "NSRP Details" (jobseekers and employers both have it).
  entry({
    id: 'jobseeker.profile.nsrp', category: 'profile', roles: JS,
    q: { en: 'Where do I fill in my NSRP details?', fil: 'Saan ko pupunan ang NSRP details ko?' },
    a: {
      en: 'Open Edit Profile and choose the NSRP Details tab. Fill in the fields there and click Save Profile.',
      fil: 'Buksan ang Edit Profile at piliin ang NSRP Details tab. Punan ang mga field doon at i-click ang Save Profile.',
    },
    keywords: {
      en: ['nsrp details', 'nsrp form', 'national skills registry', 'nsrp tab'],
      fil: ['detalye ng nsrp', 'punan ang nsrp', 'nsrp form ko'],
    },
    target: 'profile.edit',
  }),

  // pages/ResumeStudio.jsx: modes Resume Builder / Cover Letter Generator; buttons Save to Profile,
  // Save to Library, Export Printable PDF.
  entry({
    id: 'jobseeker.resume.build', category: 'resume-documents', roles: JS,
    q: { en: 'How do I make a resume or cover letter?', fil: 'Paano gumawa ng resume o cover letter?' },
    a: {
      en: 'Open the Resume & Cover Letter Studio. Switch between Resume Builder and Cover Letter Generator, edit the text, then click Save to Library to keep it for job applications or Export Printable PDF to download it.',
      fil: 'Buksan ang Resume & Cover Letter Studio. Magpalipat-lipat sa Resume Builder at Cover Letter Generator, i-edit ang teksto, saka i-click ang Save to Library para magamit sa aplikasyon o Export Printable PDF para ma-download.',
    },
    keywords: {
      en: ['make resume', 'build resume', 'create cv', 'resume studio', 'cover letter generator'],
      fil: ['gumawa resume', 'gumawa cv', 'gumawa cover letter', 'resume builder'],
    },
    target: 'profile.resume', followUps: ['jobseeker.documents.manage'],
  }),

  // components/JobseekerDocumentsPanel.jsx: "Resumes & Cover Letters" tab at /profile/documents,
  // "Upload New" button, PDF/DOCX.
  entry({
    id: 'jobseeker.documents.manage', category: 'resume-documents', roles: JS,
    q: { en: 'Where do I upload or find my saved resume files?', fil: 'Saan ako mag-a-upload o makikita ang mga na-save kong resume file?' },
    a: {
      en: 'Open My Profile and go to the Resumes & Cover Letters tab. Click Upload New to add a PDF or DOCX file, or open an item you saved from the Studio.',
      fil: 'Buksan ang My Profile at pumunta sa Resumes & Cover Letters tab. I-click ang Upload New para magdagdag ng PDF o DOCX, o buksan ang na-save mo mula sa Studio.',
    },
    keywords: {
      en: ['upload pdf or docx', 'resumes tab', 'saved resumes library', 'resume file upload'],
      fil: ['mag upload ng pdf', 'aklatan ng resume', 'naka save na resume'],
    },
    target: 'profile.documents',
  }),

  // pages/JobBoard.jsx. Age gate: utils/age.js JOB_VACANCY_MIN_AGE = 18 (resolveLink explains when blocked).
  // POLICY/VERIFY: the 18+ wording mirrors code, PESO should confirm the public wording.
  entry({
    id: 'jobseeker.jobs.browse', category: 'jobs-applications', roles: JS,
    q: { en: 'Where can I find job openings in Marinduque?', fil: 'Saan ako makakahanap ng bakanteng trabaho sa Marinduque?' },
    a: {
      en: 'Open Browse Jobs in the menu to see the current vacancies in Marinduque, then click a job to read its details. Browse Jobs is for jobseekers aged 18 and above; if it is not open to you, the link will point you to a page you can use.',
      fil: 'Buksan ang Browse Jobs sa menu para makita ang mga kasalukuyang bakante sa Marinduque, saka i-click ang job para mabasa ang detalye. Para sa mga jobseeker na 18 pataas ang Browse Jobs; kung hindi ito bukas sa iyo, ituturo ka ng link sa page na magagamit mo.',
    },
    keywords: {
      en: ['browse jobs', 'job openings in marinduque', 'find jobs', 'available vacancies'],
      fil: ['maghanap trabaho', 'bakanteng trabaho', 'trabaho sa marinduque', 'tumingin ng trabaho'],
    },
    target: 'jobs', followUps: ['jobseeker.jobs.filter', 'jobseeker.apply.how'],
  }),

  // components/JobSearchFilters.jsx: search box, Location, Job type, Sort, salary range, industry chips; Clear filters.
  entry({
    id: 'jobseeker.jobs.filter', category: 'jobs-applications', roles: JS,
    q: { en: 'How do I narrow the results by location or salary?', fil: 'Paano paliitin ang resulta ayon sa lokasyon o sahod?' },
    a: {
      en: 'On Browse Jobs, type in the search box, then narrow the list by location, job type, salary range or industry. The sort menu reorders the results and Clear filters starts over.',
      fil: 'Sa Browse Jobs, mag-type sa search box, saka paliitin ang listahan ayon sa lokasyon, uri ng trabaho, sahod o industriya. Inaayos ng sort menu ang resulta at binubura ng Clear filters ang mga filter.',
    },
    keywords: {
      en: ['filter results', 'filter by location', 'sort by salary', 'salary range filter'],
      fil: ['salain ang resulta', 'ayon sa lokasyon', 'filter ng sahod'],
    },
    target: 'jobs',
  }),

  // pages/JobDetail.jsx "Apply now" -> components/ApplyModal.jsx (resume + cover letter required, "Submit application").
  entry({
    id: 'jobseeker.apply.how', category: 'jobs-applications', kind: 'nav+faq', roles: JS,
    q: { en: 'How do I apply for a job?', fil: 'Paano mag-apply sa isang trabaho?' },
    a: {
      en: 'Open a job from Browse Jobs and click Apply now. The form asks for a resume and a cover letter, then you click Submit application. Both are needed before it can be sent.',
      fil: 'Buksan ang job mula sa Browse Jobs at i-click ang Apply now. Hihingi ang form ng resume at cover letter, saka i-click ang Submit application. Kailangan ang dalawa bago ito maipadala.',
    },
    steps: {
      en: ['Open Browse Jobs and click the job you want.', 'On the job page, click Apply now.', 'Choose a saved resume or upload one.', 'Add a cover letter: tailor one in the Studio or upload a file.', 'Click Submit application.'],
      fil: ['Buksan ang Browse Jobs at i-click ang job na gusto mo.', 'Sa page ng job, i-click ang Apply now.', 'Pumili ng na-save na resume o mag-upload.', 'Magdagdag ng cover letter: gumawa sa Studio o mag-upload ng file.', 'I-click ang Submit application.'],
    },
    keywords: {
      en: ['apply for job', 'apply now button', 'send job application', 'apply to vacancy'],
      fil: ['mag apply sa trabaho', 'mag-apply sa job', 'magpasa ng aplikasyon'],
    },
    target: 'jobs', followUps: ['jobseeker.apply.coverletter', 'jobseeker.applications.track'],
  }),

  // ApplyModal: "Tailor a cover letter for this job" -> /profile/resume?mode=coverLetter&jobId=...;
  // JobDetail reopens Apply afterwards (?apply=1).
  entry({
    id: 'jobseeker.apply.coverletter', category: 'jobs-applications', roles: JS,
    q: { en: 'Why does the apply form ask for a cover letter?', fil: 'Bakit humihingi ng cover letter ang apply form?' },
    a: {
      en: 'The apply form needs a cover letter as well as a resume. Click Tailor a cover letter for this job to write one in the Studio, or upload your own file, then come back and finish applying.',
      fil: 'Kailangan ng apply form ang cover letter bukod sa resume. I-click ang Tailor a cover letter for this job para gumawa sa Studio, o mag-upload ng sarili mong file, saka bumalik at tapusin ang pag-apply.',
    },
    keywords: {
      en: ['cover letter required', 'tailor cover letter', 'attach cover letter', 'cover letter for application'],
      fil: ['kailangan ng cover letter', 'ilakip ang cover letter', 'cover letter sa aplikasyon'],
    },
    target: 'profile.resume',
  }),

  // pages/YourApplications.jsx: status tabs (All, Pending, Under Review, Shortlisted, Approved, Accepted, Rejected, Withdrawn).
  // Navigation only: the bot never reports the status itself.
  entry({
    id: 'jobseeker.applications.track', category: 'jobs-applications', roles: JS,
    q: { en: 'Where are the tabs for my submitted applications?', fil: 'Saan makikita ang mga in-applyan ko?' },
    a: {
      en: 'Open Your Applications under My Dashboard. Use the status tabs, such as Pending, Shortlisted or Withdrawn, to filter the list. The bot cannot show you the status itself, the page does.',
      fil: 'Buksan ang Your Applications sa ilalim ng My Dashboard. Gamitin ang mga status tab, tulad ng Pending, Shortlisted o Withdrawn, para salain ang listahan. Hindi maipapakita ng bot ang status mismo, ang page ang magpapakita nito.',
    },
    keywords: {
      en: ['submitted applications', 'application tabs', 'your applications page', 'list of applications'],
      fil: ['mga in-applyan ko', 'listahan ng aplikasyon', 'tingnan ang aplikasyon'],
    },
    target: 'applications',
  }),

  // YourApplications row buttons "Edit" and "Withdraw" (Withdraw hidden once withdrawn or hired).
  entry({
    id: 'jobseeker.applications.manage', category: 'jobs-applications', roles: JS,
    q: { en: 'How do I edit or withdraw an application?', fil: 'Paano baguhin o bawiin ang aplikasyon?' },
    a: {
      en: 'Open Your Applications. Most applications have Edit and Withdraw buttons; they are hidden once an application is withdrawn or you are hired. Edit lets you change the documents you sent. Withdraw removes the application, and you can apply again while the vacancy is still open.',
      fil: 'Buksan ang Your Applications. May Edit at Withdraw button ang karamihan ng aplikasyon; nakatago ang mga ito kapag na-withdraw na ang aplikasyon o na-hire ka na. Sa Edit, mababago mo ang mga dokumentong ipinadala mo. Inaalis ng Withdraw ang aplikasyon, at maaari kang mag-apply muli habang bukas pa ang vacancy.',
    },
    keywords: {
      en: ['withdraw application', 'cancel an application', 'edit sent application', 'undo apply'],
      fil: ['bawiin ang aplikasyon', 'i-withdraw', 'baguhin ang naipadalang aplikasyon'],
    },
    target: 'applications',
  }),

  // components/JobFavoriteButton.jsx (label "Save job" on JobDetail) and ProfilePage "Favorites" tab (/profile/favorites).
  entry({
    id: 'jobseeker.jobs.save', category: 'jobs-applications', roles: JS,
    q: { en: 'How do I save a job to look at later?', fil: 'Paano mag-save ng job para mabalikan ko?' },
    a: {
      en: 'Open the job and click Save job next to Apply now. Your saved jobs are listed under My Profile in the Favorites tab.',
      fil: 'Buksan ang job at i-click ang Save job sa tabi ng Apply now. Makikita ang mga na-save mong job sa My Profile, sa Favorites tab.',
    },
    keywords: {
      en: ['save job', 'favorite job', 'bookmark a job', 'saved jobs list'],
      fil: ['i-save ang trabaho', 'paboritong trabaho', 'naka save na trabaho'],
    },
    target: 'profile.favorites',
  }),

  // pages/SpesPostings.jsx (/spes/postings) lists the published SPES postings; pages/SpesPostingDetail.jsx shows
  // one posting and its "Apply for SPES" button, which opens the 3-step apply dialog (components/SpesApplyFlow.jsx).
  // Sidebar: "My SPES" group with "SPES Postings" and "My Applications". Sends to onboarding if the NSRP profile is unfinished.
  // POLICY/VERIFY: who may apply and when applications open is POL-02, deliberately not stated.
  entry({
    id: 'jobseeker.spes.apply', category: 'spes', kind: 'nav+faq', roles: JS, contact: true,
    q: { en: 'Where do I apply for SPES?', fil: 'Saan ako mag-a-apply sa SPES?' },
    a: {
      en: 'Open SPES Postings under My SPES in the menu, open a posting and click Apply for SPES. You fill in your details, upload the required documents, then review and submit. Afterwards, follow your application under My Applications. If no posting is open, none may be taking applications now. For eligibility and dates, please ask PESO.',
      fil: 'Buksan ang SPES Postings sa ilalim ng My SPES sa menu, buksan ang isang posting at i-click ang Apply for SPES. Ilalagay mo ang iyong detalye, mag-a-upload ng mga kinakailangang dokumento, saka susuriin at isusumite. Pagkatapos, subaybayan ang iyong aplikasyon sa My Applications. Kung walang bukas na posting, maaaring walang tumatanggap ng aplikasyon ngayon. Para sa eligibility at petsa, magtanong sa PESO.',
    },
    keywords: {
      en: ['apply for spes', 'spes application form', 'join spes', 'spes posting'],
      fil: ['mag apply sa spes', 'aplikasyon sa spes', 'saan mag apply sa spes', 'spes posting'],
    },
    target: 'spes.postings', followUps: ['jobseeker.spes.track', 'jobseeker.spes.age'],
  }),

  // pages/MySpesApplications.jsx; nav label "My Applications" inside the "My SPES" group.
  entry({
    id: 'jobseeker.spes.track', category: 'spes', roles: JS,
    q: { en: 'Where is the page for my SPES submissions?', fil: 'Nasaan ang pahina ng mga naipasa kong SPES?' },
    a: {
      en: 'Open My Applications under My SPES in the menu. It lists the SPES applications you submitted, with a progress tracker, your documents and the next step. If you have none yet, start from SPES Postings.',
      fil: 'Buksan ang My Applications sa ilalim ng My SPES sa menu. Nakalista rito ang mga SPES application na naipasa mo, kasama ang progress tracker, ang iyong mga dokumento at ang susunod na hakbang. Kung wala pa, magsimula sa SPES Postings.',
    },
    keywords: {
      en: ['spes page', 'spes submissions', 'track spes', 'submitted spes', 'spes progress'],
      fil: ['pahina ng spes ko', 'listahan ng spes submission', 'subaybayan ang spes'],
    },
    target: 'spes.mine',
  }),

  // Server rules: 15-17 may apply to SPES but not to regular job vacancies; 31 and older may read SPES postings but not apply.
  // The age range itself (15-30) is enforced by the system; PESO's own eligibility policy stays POL-02 (not stated here).
  entry({
    id: 'jobseeker.spes.age', category: 'spes', roles: JS,
    q: { en: 'What is the age limit for SPES?', fil: 'Ano ang limitasyon sa edad ng SPES?' },
    a: {
      en: 'If you are 15 to 17, you can apply to SPES postings, but not to regular job vacancies, which open at 18. If you are 31 or older, you can read SPES postings but cannot apply. For the full eligibility rules, please ask PESO.',
      fil: 'Kung 15 hanggang 17 ka, maaari kang mag-apply sa mga SPES posting, pero hindi sa mga regular na bakanteng trabaho na bukas sa edad na 18. Kung 31 pataas ka, maaari mong basahin ang mga SPES posting pero hindi ka makakapag-apply. Para sa kumpletong patakaran sa eligibility, magtanong sa PESO.',
    },
    keywords: {
      en: ['spes age limit', 'spes under 18', 'spes over 30', 'age requirement spes'],
      fil: ['edad sa spes', 'spes wala pang 18', 'spes lampas 30'],
    },
    target: 'spes.postings', contact: true,
  }),

  // pages/Settings.jsx PrivacySection (jobseeker): Profile visibility, Who can message me, Show my active status.
  entry({
    id: 'jobseeker.privacy.settings', category: 'settings-privacy', roles: JS,
    q: { en: 'How do I control who sees my profile and messages me?', fil: 'Paano kontrolin kung sino ang makakakita ng profile at makakapag-message sa akin?' },
    a: {
      en: 'Open Settings and choose Privacy. Set Profile visibility (public, employers only or hidden), choose Who can message me, and switch Show my active status on or off.',
      fil: 'Buksan ang Settings at piliin ang Privacy. Itakda ang Profile visibility (public, employers lang o nakatago), piliin ang Who can message me, at i-on o i-off ang Show my active status.',
    },
    keywords: {
      en: ['profile visibility', 'who can message me setting', 'active status setting', 'hide profile'],
      fil: ['sino ang makakakita ng profile', 'itago ang profile', 'active status setting'],
    },
    target: 'settings',
  }),

  // pages/Dashboard.jsx: job counts, Top matches, Recent job openings, News & Updates.
  entry({
    id: 'jobseeker.dashboard.open', category: 'getting-started', roles: JS,
    q: { en: 'Where is my dashboard overview?', fil: 'Nasaan ang buod ng aking dashboard?' },
    a: {
      en: 'Open My Dashboard in the menu. It shows how many jobs are open, your top matches, recent job openings and news.',
      fil: 'Buksan ang My Dashboard sa menu. Ipinapakita nito kung ilang job ang bukas, ang iyong top matches, mga bagong job opening at balita.',
    },
    keywords: {
      en: ['my dashboard', 'dashboard overview', 'recent openings section', 'dashboard top openings section'],
      fil: ['aking dashboard', 'buod ng dashboard', 'dashboard ng jobseeker'],
    },
    target: 'dashboard',
  }),

  // ---- Policy topics: written, held as drafts until PESO answers. Never matched. ----
  draft('POL-02', {
    id: 'jobseeker.spes.eligibility', category: 'spes', roles: JS,
    q: { en: 'Who is eligible for SPES and when can I apply?', fil: 'Sino ang puwedeng mag-SPES at kailan puwedeng mag-apply?' },
    a: {
      en: 'Pending PESO confirmation of SPES eligibility and the application period. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa eligibility at panahon ng SPES. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['spes eligibility', 'spes requirements', 'spes application period'], fil: ['sino ang puwede sa spes', 'kailangan sa spes', 'kailan ang spes'] },
  }),
  draft('POL-02', {
    id: 'jobseeker.spes.documents', category: 'spes', roles: JS,
    q: { en: 'What documents do I submit for SPES?', fil: 'Anong mga dokumento ang ipapasa ko sa SPES?' },
    a: {
      en: 'Pending PESO confirmation of the SPES documents. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa mga dokumento ng SPES. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['spes documents', 'spes papers needed', 'spes attachments'], fil: ['dokumento sa spes', 'papeles sa spes', 'ilakip sa spes'] },
  }),
  draft('POL-08', {
    id: 'jobseeker.messages.peso', category: 'messages-notifications', roles: JS,
    q: { en: 'Can I message PESO staff in the portal?', fil: 'Puwede ba akong mag-message sa PESO staff sa portal?' },
    a: {
      en: 'Pending PESO confirmation. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['message peso staff', 'chat with peso', 'ask peso in app'], fil: ['mag message sa peso staff', 'kausapin ang peso', 'magtanong sa peso'] },
  }),
];
