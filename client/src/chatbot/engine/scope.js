// Scope classification (plan D.5, layer 2). Wording-level only; the structural
// control is that the module has no access to account data at all.
// All patterns are linear (no nested quantifiers) and run on text already cut
// to MAX_CHARS.
import { MAX_CHARS } from './normalize.js';

const STAFF = new Set(['admin', 'superadmin']);
const COMBINING = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const HOW_CUE = /\b(how|where|paano|paanu|pano|saan|nasaan)\b/;

function fold(text) {
  return String(text)
    .slice(0, MAX_CHARS)
    .normalize('NFKD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(NON_ALNUM, ' ')
    .trim();
}

// cueExempt: pattern does not fire when the text has a how/where cue.
const p = (re, cueExempt = true) => ({ re, cueExempt });

// Checked in this order; first hit wins.
const CLASSES = [
  ['probe', [
    p(/\bignore (all |any |the )?(previous|prior|above|earlier)\b/, false),
    p(/\b(system|hidden|initial) prompt\b/, false),
    p(/\bwhat (rules|instructions) (were you|are you|did you)\b/, false),
    p(/\b(your|the) (rules|instructions|configuration|source code)\b/, false),
    p(/\blist (every|all) (the |your )?(question|answer|entr|topic|faq)/, false),
    p(/\bwhat (api|model|llm|database|framework)\b.*\b(use|using|run|running|built)\b/, false),
    p(/\b(jailbreak|developer mode|act as|pretend (to be|you are))\b/, false),
  ]],
  // Only meaningful for non-staff; handled below.
  ['privileged', [
    p(/\b(super ?admins?|audit logs?)\b/, false),
    p(/\badmins?\b/, false),
    p(/\b(back ?end|database|server) (access|password|credentials)\b/, false),
  ]],
  ['legal', [
    p(/\b(legal|illegal|lawsuit|sue|sued|labor (code|law)|labour (code|law)|overtime pay|visa|abroad|overseas|passport|contract|minimum wage|harassment|illegal dismissal|dole)\b/, false),
  ]],
  ['people', [
    p(/\bwho is\b/, false),
    p(/\b(legit|legitimate|scam|scammer|trustworthy|reputable)\b/, true),
    p(/\b(show|list|see|view) (me )?(the )?(all )?(applicants?|candidates?|users?|jobseekers?|employees)\b/, false),
  ]],
  ['recommendation', [
    p(/\bmatch (score|percent|percentage|rate|results?)\b/),
    p(/\b(my|the) match\b/),
    p(/\bwhy is my\b/),
    p(/\bwhat jobs? (should|can|do) i (take|apply|choose|get|pick)\b/),
    p(/\bbest (jobs?|work|candidates?|applicants?)\b/),
    p(/\bwho should i (hire|choose|pick|select|interview)\b/),
    p(/\b(recommend|suggest)(ed|ion|ions)?\b.*\b(job|jobs|candidate|applicant)\b/),
  ]],
  ['account-data', [
    p(/\bstatus\b.*\b(my|ko)\b/),
    p(/\bmy\b.*\bstatus\b/),
    p(/\b(read|show|see|view|open|check|display) (me )?my (messages?|inbox|notifications?|applications?|profile|documents?|resume|account)\b/),
    p(/\bis my \w+ (verified|approved|complete|visible|rejected)\b/),
    p(/\bmy (verification|score|rating|ranking)\b/),
  ]],
  ['action', [
    p(/\b(apply|delete|edit|post|submit|send|update|change|remove|approve|reject|verify|upload|cancel)\b.*\bfor me\b/),
    p(/\b(delete|deactivate|remove|close) my account\b/),
    p(/\bapprove (this|the|that) \w+/),
    p(/\b(ikaw na|pwede mo bang) (mag )?(apply|post|edit)\b/),
  ]],
  ['general', [
    p(/\b(capital of|joke|weather|recipe|poem|lyrics|bitcoin|stock price|homework|horoscope|president of|translate|calculate)\b/, false),
    p(/\bwrite (me |my |a |an |the )/),
    p(/\btell me (a|about)\b/, true),
  ]],
];

/**
 * @param {string} text raw user text
 * @param {{role?: string}} [ctx]
 * @returns {null | 'account-data'|'action'|'recommendation'|'legal'|'general'|'people'|'probe'}
 * 'privileged' is reported as 'general' (identical output, no confirmation of tooling).
 */
export function classify(text, ctx = {}) {
  if (typeof text !== 'string' || text === '') return null;
  const s = fold(text);
  if (!s) return null;
  const cue = HOW_CUE.test(s);
  const staff = STAFF.has(ctx && ctx.role);
  for (const [name, patterns] of CLASSES) {
    if (name === 'privileged' && staff) continue;
    for (const { re, cueExempt } of patterns) {
      if (cueExempt && cue) continue;
      if (re.test(s)) return name === 'privileged' ? 'general' : name;
    }
  }
  return null;
}
