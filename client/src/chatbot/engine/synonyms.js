// canonical concept -> variants (English + Filipino/Taglish).
// Multi-word variants (and hyphenated ones, which normalize to spaces) are
// matched as phrases before tokenizing. Keys map to themselves implicitly.
const SYNONYMS = {
  resume: ['cv', 'resume', 'resumes', 'biodata', 'bio data', 'curriculum vitae', 'curriculum', 'vitae'],
  edit: ['edit', 'editing', 'update', 'updating', 'change', 'changing', 'modify', 'baguhin', 'palitan', 'i update', 'iupdate', 'ayusin', 'correct'],
  apply: ['apply', 'applying', 'application', 'applications', 'applied', 'aplay', 'aply', 'mag apply', 'magapply', 'mag aplay', 'magaplay'],
  post: ['post', 'posting', 'publish', 'create', 'magpost', 'mag post', 'maglagay', 'mag lagay', 'ilagay'],
  job: ['job', 'jobs', 'vacancy', 'vacancies', 'trabaho', 'work', 'opening', 'openings', 'hiring', 'position', 'positions'],
  login: ['login', 'log in', 'sign in', 'signin', 'mag login', 'maglogin', 'pasok', 'pumasok', 'logging in'],
  logout: ['logout', 'log out', 'sign out', 'signout', 'mag logout', 'maglogout', 'labas', 'lumabas'],
  register: ['register', 'registration', 'signup', 'sign up', 'mag register', 'magregister', 'mag sign up', 'create account', 'gumawa account', 'enroll', 'mag rehistro', 'magrehistro', 'rehistro'],
  password: ['password', 'passwords', 'pass word', 'passcode', 'pw', 'forgot', 'nakalimutan', 'reset', 'recover', 'recovery'],
  verify: ['verify', 'verified', 'verification', 'verifying', 'beripikasyon', 'i verify', 'iverify', 'patunayan', 'approval', 'approve', 'approved'],
  employer: ['employer', 'employers', 'company', 'companies', 'kumpanya', 'negosyo', 'business', 'amo', 'hiring manager'],
  jobseeker: ['jobseeker', 'jobseekers', 'job seeker', 'seeker', 'applicant', 'naghahanap trabaho', 'naghahanap ng trabaho', 'hanap trabaho'],
  spes: ['spes', 'spe', 'special program', 'student program', 'estudyante', 'student', 'students'],
  profile: ['profile', 'profiles', 'account info', 'my info', 'impormasyon'],
  settings: ['settings', 'setting', 'preferences', 'preference', 'configuration', 'config', 'privacy'],
  message: ['message', 'messages', 'messaging', 'chat', 'inbox', 'mensahe', 'mag message', 'magmessage', 'dm'],
  notification: ['notification', 'notifications', 'notif', 'notifs', 'alert', 'alerts', 'abiso', 'paalala'],
  news: ['news', 'announcement', 'announcements', 'balita', 'anunsyo'],
  contact: ['contact', 'contacts', 'email us', 'call us', 'hotline', 'office', 'opisina', 'tanggapan', 'support', 'makipag ugnayan', 'makipag-ugnayan'],
  photo: ['photo', 'photos', 'picture', 'pictures', 'pic', 'larawan', 'litrato', 'avatar', 'image', 'images'],
  document: ['document', 'documents', 'dokumento', 'file', 'files', 'attachment', 'attachments', 'requirements', 'requirement'],
  upload: ['upload', 'uploading', 'uploaded', 'attach', 'i upload', 'iupload', 'mag upload', 'magupload', 'submit', 'isumite', 'ipasa'],
  delete: ['delete', 'remove', 'erase', 'burahin', 'tanggalin', 'alisin', 'cancel', 'deactivate'],
  search: ['search', 'searching', 'find', 'looking', 'hanap', 'maghanap', 'mag hanap', 'browse'],
  free: ['free', 'libre', 'walang bayad', 'fee', 'fees', 'bayad', 'cost', 'price', 'magkano'],
};

// Hyphens normalize to spaces, so 'i-update' and 'i update' are the same variant.
function norm(v) {
  return v.toLowerCase().replace(/-/g, ' ').trim();
}

const WORD_MAP = new Map();
const PHRASE_MAP = new Map();
for (const [canonical, variants] of Object.entries(SYNONYMS)) {
  WORD_MAP.set(canonical, canonical);
  for (const raw of variants) {
    const v = norm(raw);
    if (v.includes(' ')) PHRASE_MAP.set(v, canonical);
    else if (!WORD_MAP.has(v)) WORD_MAP.set(v, canonical);
  }
}

export const PHRASES = [...PHRASE_MAP.keys()];
export const PHRASE_TO_CANONICAL = PHRASE_MAP;
export const WORD_TO_CANONICAL = WORD_MAP;
export const MAX_PHRASE_WORDS = Math.max(1, ...PHRASES.map((p) => p.split(' ').length));
export default SYNONYMS;
