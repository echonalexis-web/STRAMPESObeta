// MVP knowledge base: jobseeker, employer, common and public (logged-out) entries.
// Admin and superadmin KBs are a later phase and are not part of ALL_ENTRIES.
import common from './common.js';
import jobseeker from './jobseeker.js';
import employer from './employer.js';
import publicEntries from './public.js';

export const ALL_ENTRIES = [...common, ...jobseeker, ...employer, ...publicEntries];
export { common, jobseeker, employer, publicEntries };
