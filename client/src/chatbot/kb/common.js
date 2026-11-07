// Entries shared across audiences. Navigation-only: every approved entry points
// at a page or control that exists in the code today (verified 2026-11-08 by
// reading the page components named beside each entry).
//
// POLICY/VERIFY (file-wide): Filipino wording is machine-drafted and needs a
// native-Filipino review; English wording needs PESO content-owner review.
// Entries are marked 'approved' because they only describe where things are in
// the app; none states PESO policy. Policy topics are drafts at the bottom.
import { entry, draft } from './entry.js';

const JS_EMP = ['jobseeker', 'employer'];

export default [
  // Public routes /forgot-password (pages/ForgotPassword.jsx) and /account-recovery (pages/AccountRecovery.jsx).
  entry({
    id: 'common.password.forgot', category: 'account-login', kind: 'nav+faq', roles: ['*'],
    q: { en: 'I forgot my password. Where do I get the reset link?', fil: 'Nakalimutan ko ang password. Saan makukuha ang reset link?' },
    a: {
      en: 'Open Forgot password, type the email of your account, and a link to set a new password is sent to that email. If you cannot open that email either, use Account recovery with one of your backup codes.',
      fil: 'Buksan ang Forgot password, ilagay ang email ng account mo, at may ipapadalang link para sa bagong password. Kung hindi mo rin mabuksan ang email, gamitin ang Account recovery at isa sa iyong backup codes.',
    },
    keywords: {
      en: ['forgot password link', 'reset link email', 'lost password email', 'password reset link'],
      fil: ['nakalimutan password link', 'reset link sa email', 'link para sa bagong password'],
    },
    target: 'forgot-password', targets: ['account-recovery'],
  }),

  entry({
    id: 'common.contact.peso', category: 'contact-peso', kind: 'faq', roles: ['*'], contact: true,
    q: { en: 'How do I contact PESO?', fil: 'Paano makipag-ugnayan sa PESO?' },
    a: {
      en: 'You can reach the PESO office by phone, email or its Facebook page. The contact details are shown below.',
      fil: 'Maaari mong kontakin ang PESO sa telepono, email o sa Facebook page nito. Nasa ibaba ang contact details.',
    },
    keywords: {
      en: ['contact peso', 'call peso', 'email peso', 'peso office number'],
      fil: ['makipag ugnayan peso', 'tawagan ang peso', 'numero ng peso', 'opisina ng peso'],
    },
  }),

  // pages/LegalCenter.jsx: /terms, /privacy, /cookies each open the matching policy.
  entry({
    id: 'common.privacy.read', category: 'settings-privacy', kind: 'nav', roles: ['*'],
    q: { en: 'Where can I read the privacy policy and terms?', fil: 'Saan ko mababasa ang privacy policy at terms?' },
    a: {
      en: 'The portal has three policy pages: Terms of Service, Privacy Policy and Cookie Policy. Open the link below and pick the one you want to read.',
      fil: 'May tatlong policy page ang portal: Terms of Service, Privacy Policy at Cookie Policy. Buksan ang link sa ibaba at piliin ang gusto mong basahin.',
    },
    keywords: {
      en: ['privacy policy', 'terms of service', 'cookie policy', 'terms and conditions'],
      fil: ['patakaran sa privacy', 'mga tuntunin ng serbisyo', 'patakaran sa cookies'],
    },
    target: 'privacy', targets: ['terms', 'cookies'],
  }),

  // pages/NewsFeed.jsx, public route /news.
  entry({
    id: 'common.news.read', category: 'getting-started', kind: 'nav', roles: ['*'],
    q: { en: 'Where can I read PESO news and announcements?', fil: 'Saan ko mababasa ang balita at anunsyo ng PESO?' },
    a: {
      en: 'Open the News Feed. You can filter announcements by category or search them by keyword, then open one to read the full post.',
      fil: 'Buksan ang News Feed. Maaari mong salain ang mga anunsyo ayon sa category o hanapin gamit ang keyword, at buksan ang isa para mabasa nang buo.',
    },
    keywords: {
      en: ['news feed', 'latest announcements', 'read news', 'community announcements'],
      fil: ['balita', 'mga anunsyo', 'basahin ang balita', 'bagong anunsyo'],
    },
    target: 'news',
  }),

  // pages/About.jsx, public route /about.
  entry({
    id: 'common.about.peso', category: 'getting-started', kind: 'nav+faq', roles: ['*'],
    q: { en: 'Where can I learn more about STRAM PESO?', fil: 'Saan ko malalaman ang tungkol sa STRAM PESO?' },
    a: {
      en: 'The About page explains what the portal does, who it serves, and what jobseekers and employers get from it. The PESO office details are at the bottom of the page.',
      fil: 'Ipinapaliwanag ng About page kung ano ang ginagawa ng portal, sino ang pinaglilingkuran nito, at ano ang makukuha ng mga jobseeker at employer. Nasa ibaba ng page ang detalye ng opisina ng PESO.',
    },
    keywords: {
      en: ['about stram peso', 'what is stram peso', 'about this website', 'peso background'],
      fil: ['tungkol sa stram peso', 'ano ang stram peso', 'tungkol sa website'],
    },
    target: 'about',
  }),

  // Report buttons: pages/JobDetail.jsx ("Report this job"), pages/Messages.jsx (chat header),
  // pages/NewsFeedDetail.jsx (on each comment). Nowhere else.
  entry({
    id: 'common.report.how', category: 'report-appeal', kind: 'faq', roles: JS_EMP,
    q: { en: 'How do I report a job, a user or a comment?', fil: 'Paano mag-report ng job, user o comment?' },
    a: {
      en: 'There is a Report button on a job page (Report this job), in the header of a conversation in Messages (reports that person), and beside each comment on a news post. Pick a reason and submit. It is not on every page.',
      fil: 'May Report button sa page ng job (Report this job), sa itaas ng usapan sa Messages (nire-report ang taong kausap), at sa tabi ng bawat comment sa news post. Pumili ng dahilan at i-submit. Wala ito sa lahat ng page.',
    },
    keywords: {
      en: ['report job', 'report user', 'report comment', 'report abuse'],
      fil: ['i-report ang trabaho', 'mag report ng user', 'i-report ang comment', 'ireport'],
    },
  }),

  // Settings > Language & Region (pages/Settings.jsx LanguageSection). There is no switch on public pages.
  entry({
    id: 'common.language.switch', category: 'settings-privacy', kind: 'nav', roles: JS_EMP,
    q: { en: 'How do I change the language?', fil: 'Paano palitan ang wika?' },
    a: {
      en: 'Open Settings, choose Language & Region, and pick English or Filipino under Display language. Your choice is remembered on that device.',
      fil: 'Buksan ang Settings, piliin ang Language & Region, at piliin ang English o Filipino sa Display language. Maaalala ito sa device na iyon.',
    },
    keywords: {
      en: ['change language', 'switch language', 'english or filipino', 'display language'],
      fil: ['palitan ang wika', 'gawing tagalog', 'gawing english', 'wika ng site'],
    },
    target: 'settings',
  }),

  // Settings > Account > Change password (pages/Settings.jsx) links to /change-password.
  entry({
    id: 'common.password.change', category: 'account-login', kind: 'nav', roles: JS_EMP,
    q: { en: 'How do I change my password?', fil: 'Paano ko papalitan ang password ko?' },
    a: {
      en: 'Open Settings, go to the Account section and click Change password. This is for when you can still log in; if you cannot, use Forgot password on the login page.',
      fil: 'Buksan ang Settings, pumunta sa Account section at i-click ang Change password. Para ito kung nakakapag-login ka pa; kung hindi, gamitin ang Forgot password sa login page.',
    },
    keywords: {
      en: ['change password', 'update password', 'new password settings', 'password change'],
      fil: ['palitan ang password', 'bagong password sa settings', 'baguhin ang password'],
    },
    target: 'change-password',
  }),

  // pages/Messages.jsx: "Search users..." box starts a conversation.
  entry({
    id: 'common.messages.open', category: 'messages-notifications', kind: 'nav', roles: JS_EMP,
    q: { en: 'How do I send a message to someone?', fil: 'Paano magpadala ng mensahe sa isang tao?' },
    a: {
      en: 'Open Messages. Type a name in the Search users box to start a conversation, or pick an existing conversation on the left and use the message box. Who can message you is set in Settings under Privacy.',
      fil: 'Buksan ang Messages. Mag-type ng pangalan sa Search users para magsimula ng usapan, o pumili ng umiiral na usapan sa kaliwa at gamitin ang message box. Sa Settings, sa Privacy, itinatakda kung sino ang puwedeng mag-message sa iyo.',
    },
    keywords: {
      en: ['send message', 'open messages', 'start conversation', 'chat with someone'],
      fil: ['magpadala ng mensahe', 'mag message sa tao', 'simulan ang usapan', 'usapan sa messages'],
    },
    target: 'messages',
  }),

  // pages/Notifications.jsx has "Mark all read".
  entry({
    id: 'common.notifications.view', category: 'messages-notifications', kind: 'nav', roles: JS_EMP,
    q: { en: 'Where do I find my notifications?', fil: 'Saan makikita ang mga abiso ko?' },
    a: {
      en: 'Open Notifications from the menu or the top bar. Mark all read clears the unread marks.',
      fil: 'Buksan ang Notifications mula sa menu o sa itaas na bar. Nililinis ng Mark all read ang mga hindi pa nababasa.',
    },
    keywords: {
      en: ['notifications page', 'unread alerts', 'mark all read', 'see notifications'],
      fil: ['tingnan ang abiso', 'hindi pa nabasang abiso', 'pahina ng notification'],
    },
    target: 'notifications',
  }),

  // Settings > Notifications (settings.notifications: In-app / Email per event).
  entry({
    id: 'common.notifications.settings', category: 'messages-notifications', kind: 'nav', roles: JS_EMP,
    q: { en: 'How do I turn email notifications on or off?', fil: 'Paano buksan o patayin ang email notifications?' },
    a: {
      en: 'Open Settings and choose Notifications. For each event you can switch In-app and Email on or off, and one switch turns off every notification email at once.',
      fil: 'Buksan ang Settings at piliin ang Notifications. Sa bawat event, maaari mong i-on o i-off ang In-app at Email, at may isang switch para patayin ang lahat ng notification email.',
    },
    keywords: {
      en: ['email notifications', 'notification settings', 'turn off emails', 'stop notification emails'],
      fil: ['email notification', 'patayin ang email', 'setting ng abiso', 'itigil ang email'],
    },
    target: 'settings',
  }),

  // pages/ProfilePage.jsx: camera button on the avatar ("Change profile photo"), both roles, own profile only.
  entry({
    id: 'common.profile.photo', category: 'profile', kind: 'nav', roles: JS_EMP,
    q: { en: 'How do I upload a new profile photo?', fil: 'Paano mag-upload ng bagong profile photo?' },
    a: {
      en: 'Open My Profile and click the camera button on your photo. Choose a JPG, PNG or WEBP image, adjust it, and it is saved as your new photo.',
      fil: 'Buksan ang My Profile at i-click ang camera button sa iyong larawan. Pumili ng JPG, PNG o WEBP na larawan, ayusin ito, at ito na ang magiging bagong larawan mo.',
    },
    keywords: {
      en: ['profile photo', 'profile picture', 'upload photo', 'new avatar'],
      fil: ['larawan ng profile', 'bagong litrato', 'ibang larawan'],
    },
    target: 'profile',
  }),

  // ---- Policy topics: written, held as drafts until PESO answers. Never matched. ----
  draft('POL-03', {
    id: 'common.fees.free', category: 'getting-started', roles: ['*'],
    q: { en: 'Is the portal free to use?', fil: 'Libre ba gamitin ang portal?' },
    a: {
      en: 'Pending PESO confirmation. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['is it free', 'any fees', 'portal cost'], fil: ['libre ba', 'may bayad ba', 'magkano ang bayad'] },
  }),
  draft('POL-06', {
    id: 'common.recovery.staff', category: 'account-login', roles: ['*'],
    q: { en: 'Can PESO staff help me recover my account? What do I bring?', fil: 'Tutulungan ba ako ng PESO na mabawi ang account? Ano ang dadalhin ko?' },
    a: {
      en: 'Pending PESO confirmation of the staff-assisted recovery steps and the ID needed. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa mga hakbang ng tulong ng staff at ang kailangang ID. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['staff account recovery', 'recover with id', 'peso help account'], fil: ['tulong ng staff account', 'bawiin account id', 'tulong ng peso account'] },
  }),
  draft('POL-07', {
    id: 'common.account.delete', category: 'settings-privacy', roles: JS_EMP,
    q: { en: 'Can my account and data be deleted?', fil: 'Maaari bang burahin ang account at data ko?' },
    a: {
      en: 'Pending PESO and data-protection officer confirmation. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO at ng data protection officer. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['erase account data', 'data retention', 'remove all data'], fil: ['burahin ang data', 'gaano katagal itatago', 'alisin ang lahat ng data'] },
  }),
  draft('POL-09', {
    id: 'common.office.hours', category: 'contact-peso', roles: ['*'],
    q: { en: 'What are the PESO office hours and address?', fil: 'Anong oras bukas ang PESO at saan ang address?' },
    a: {
      en: 'Pending PESO confirmation of office hours and address. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO sa oras at address ng opisina. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['office hours', 'office address', 'what time open'], fil: ['oras ng opisina', 'address ng opisina', 'anong oras bukas'] },
  }),
  draft('POL-10', {
    id: 'common.jobfair.referral', category: 'getting-started', roles: ['*'],
    q: { en: 'Does PESO hold job fairs or give referral slips?', fil: 'May job fair o referral slip ba ang PESO?' },
    a: {
      en: 'Pending PESO confirmation. Please contact PESO directly.',
      fil: 'Hinihintay pa ang kumpirmasyon ng PESO. Mangyaring makipag-ugnayan sa PESO.',
    },
    keywords: { en: ['job fair schedule', 'referral slip', 'job placement'], fil: ['iskedyul ng job fair', 'referral slip ng peso', 'tulong sa pagkakatrabaho'] },
  }),
];
