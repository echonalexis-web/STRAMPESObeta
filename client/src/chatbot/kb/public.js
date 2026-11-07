// Entries for logged-out visitors (roles: ['public']). Navigation-only; every
// target is a public route, so each link works without logging in. Shared
// public pages (forgot password, news, about, privacy/terms/cookies, contact)
// live in common.js with roles ['*'], which already covers visitors.
//
// POLICY/VERIFY (file-wide): Filipino wording is machine-drafted and needs a
// native-Filipino review; English wording needs PESO content-owner review.
// Approved here means "code-verified navigation", not "PESO-approved policy".
// Who may register (POL-01) is a draft at the bottom of the file.
import { entry, draft } from './entry.js';

const PUB = ['public'];

export default [
  // pages/Register.jsx (jobseeker form: names, email, optional username, password, terms) and
  // pages/Login.jsx ("Register as Applicant" button).
  // POLICY/VERIFY: what happens after submitting (email confirmation, onboarding) is not described on purpose.
  entry({
    id: 'public.register.jobseeker', category: 'getting-started', kind: 'nav+faq', roles: PUB,
    q: { en: 'How do I register as a jobseeker?', fil: 'Paano mag-register bilang jobseeker?' },
    a: {
      en: 'Open Register (on the login page it is the Register as Applicant button). Fill in your name, email and a password, accept the terms and submit the form.',
      fil: 'Buksan ang Register (sa login page, ito ang Register as Applicant na button). Punan ang pangalan, email at password, tanggapin ang terms at i-submit ang form.',
    },
    keywords: {
      en: ['register as applicant', 'jobseeker sign up', 'create applicant account', 'new jobseeker account'],
      fil: ['mag register bilang applicant', 'gumawa ng account na jobseeker', 'rehistro ng naghahanap ng trabaho'],
    },
    target: 'register', followUps: ['public.register.employer'],
  }),

  // pages/EmployeeRegister.jsx (business name, business email, username, password); Login "Register as Employer".
  entry({
    id: 'public.register.employer', category: 'getting-started', kind: 'nav+faq', roles: PUB,
    q: { en: 'How do I register my company as an employer?', fil: 'Paano i-register ang kumpanya ko bilang employer?' },
    a: {
      en: 'Open Register as Employer (also a button on the login page). Fill in the business name, business email and a password, and submit the form. Posting jobs later needs the company to be verified.',
      fil: 'Buksan ang Register as Employer (button din ito sa login page). Punan ang pangalan ng negosyo, business email at password, at i-submit ang form. Kailangang verified ang kumpanya bago makapag-post ng trabaho.',
    },
    keywords: {
      en: ['register as employer', 'employer sign up', 'register my company', 'create employer account'],
      fil: ['mag register bilang employer', 'rehistro ng kumpanya', 'gumawa ng employer account'],
    },
    target: 'register-employer',
  }),

  // pages/Login.jsx: field "Email or username", password, "Forgot password?" link, Google sign-in button.
  entry({
    id: 'public.login.how', category: 'account-login', kind: 'nav', roles: PUB,
    q: { en: 'How do I log in to the portal?', fil: 'Paano mag-login sa portal?' },
    a: {
      en: 'Open Login and enter your email or username with your password, then submit. You can also use the Google sign-in button on that page.',
      fil: 'Buksan ang Login at ilagay ang email o username kasama ang password, saka i-submit. Maaari ding gamitin ang Google sign-in button sa page na iyon.',
    },
    keywords: {
      en: ['log in to portal', 'login page', 'username or email login', 'portal sign in'],
      fil: ['mag login sa portal', 'pumasok sa portal', 'login page ng portal'],
    },
    target: 'login',
  }),

  entry({
    id: 'public.login.google', category: 'account-login', kind: 'faq', roles: PUB,
    q: { en: 'Can I sign in with Google?', fil: 'Puwede ba akong mag-sign in gamit ang Google?' },
    a: {
      en: 'Yes. The Login page has a Google sign-in button below the form. Use the same page to log in with an email or username and password.',
      fil: 'Oo. May Google sign-in button sa ilalim ng form sa Login page. Sa parehong page din ang pag-login gamit ang email o username at password.',
    },
    keywords: {
      en: ['google sign in', 'continue with google', 'login with google', 'google account'],
      fil: ['mag login gamit ang google', 'google button', 'gamitin ang google'],
    },
    target: 'login',
  }),

  // pages/AccountRecovery.jsx: email/username + one backup code (format XXXX-XXXX) + new password.
  // Backup codes are generated in Settings (settings.account.backupCodes), so only people who made them can use this.
  entry({
    id: 'public.recovery.backupcode', category: 'account-login', kind: 'nav+faq', roles: PUB,
    q: { en: 'My email is gone. How do I get back in with a backup code?', fil: 'Hindi ko na mabuksan ang email ko. Paano gamitin ang backup code?' },
    a: {
      en: 'Open Account recovery, enter your email or username and one of your backup codes, then set a new password. Each code works once. Backup codes are made in Settings while you can still log in, so this only works if you made them earlier.',
      fil: 'Buksan ang Account recovery, ilagay ang email o username at isa sa iyong backup codes, saka magtakda ng bagong password. Isang beses lang magagamit ang bawat code. Ginagawa ang backup codes sa Settings habang nakakapag-login ka pa, kaya gagana lang ito kung nakagawa ka na noon.',
    },
    keywords: {
      en: ['backup code entry', 'backup codes page', 'lost email access', 'use a backup code'],
      fil: ['backup code ko', 'gamitin ang backup code', 'nawalan ng access sa email'],
    },
    target: 'account-recovery',
  }),

  // Route /jobs requires a logged-in jobseeker (App.jsx), so visitors are pointed to login/register.
  entry({
    id: 'public.jobs.see', category: 'jobs-applications', kind: 'faq', roles: PUB,
    q: { en: 'Can I see the job openings without an account?', fil: 'Makikita ko ba ang mga job opening kahit walang account?' },
    a: {
      en: 'The job list is for logged-in jobseekers. Log in, or register as an applicant first, then open Browse Jobs from the menu.',
      fil: 'Para sa mga naka-login na jobseeker ang listahan ng trabaho. Mag-login, o mag-register muna bilang applicant, saka buksan ang Browse Jobs sa menu.',
    },
    keywords: {
      en: ['see jobs without account', 'job list as guest', 'view vacancies guest', 'browse without registering'],
      fil: ['makita ang trabaho nang walang account', 'trabaho para sa bisita', 'tingnan ang vacancy bilang bisita'],
    },
    target: 'login', targets: ['register'],
  }),

  // ---- Policy topics: written, held as drafts until PESO answers. Never matched. ----
  draft('POL-01', {
    id: 'public.register.who', category: 'getting-started', roles: PUB,
    q: { en: 'Who is allowed to register? Do I still need to register in person for NSRP?', fil: 'Sino ang puwedeng mag-register? Kailangan pa bang pumunta sa opisina para sa NSRP?' },
    a: {
      en: 'Pending PESO confirmation of who may register and whether walk-in NSRP registration is still required. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO kung sino ang puwedeng mag-register at kung kailangan pa ang personal na NSRP registration. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['who can register', 'registration requirements', 'nsrp walk in'], fil: ['sino ang puwedeng mag register', 'kailangan para mag register', 'nsrp sa opisina'] },
    target: 'register',
  }),
];
