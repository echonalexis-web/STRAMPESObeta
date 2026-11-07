// KB validator (plan Part B). validateEntries returns a list of problem strings.
import { ROUTES } from '../routes/registry.js';
import { resolveLink } from '../routes/resolveLink.js';
import { CATEGORIES, KINDS, STATUSES, ROLE_NAMES } from './categories.js';
import { LIMITS } from './schema.js';

const DAY = 86400000;
// A date written in a timezone ahead of UTC (up to UTC+14) is not "in the future" yet.
const TZ_SLACK = 14 * 3600000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POLICY_ID = /^POL-\d{2}$/;
// Links come only from the route registry and contact.js, never from KB text.
const FORBIDDEN = /<|\{\{|http/i;
// A visitor fully allowed everywhere: used to ask "can this role reach the page at all".
const OPEN_CTX = Object.freeze({
  mustChangePassword: false, onboardingDone: true, verifiedEmployer: true, canViewJobs: true, canApplySpes: true,
});

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const expand = (roles) => (roles.includes('*') ? [...ROLE_NAMES] : roles);

function reachable(routeId, role) {
  return resolveLink(routeId, { ...OPEN_CTX, role }).kind === 'link';
}

function textProblems(id, label, value, max, out) {
  if (typeof value !== 'string') return;
  if (FORBIDDEN.test(value)) out.push(`${id}: forbidden text ("<", "{{" or "http") in ${label}`);
  if (max && value.length > max) out.push(`${id}: ${label} too long (${value.length} > ${max})`);
}

function checkEntry(e, ctx, out) {
  const id = e && e.id;
  if (!isStr(id)) { out.push('entry without id'); return; }
  const p = (m) => out.push(`${id}: ${m}`);

  if (!CATEGORIES.includes(e.category)) p(`bad category "${e.category}"`);
  if (!KINDS.includes(e.kind)) p(`bad kind "${e.kind}"`);
  if (!STATUSES.includes(e.status)) p(`bad status "${e.status}"`);

  const rolesOk = Array.isArray(e.roles) && e.roles.length > 0
    && e.roles.every((r) => r === '*' || ROLE_NAMES.includes(r));
  if (!rolesOk) p('roles must be a non-empty list of valid roles or "*"');

  for (const f of ['q', 'a']) {
    const max = f === 'q' ? LIMITS.q : LIMITS.a;
    for (const lang of ['en', 'fil']) {
      const v = e[f] && e[f][lang];
      if (!isStr(v)) p(`${f}.${lang} is empty`);
      else textProblems(id, `${f}.${lang}`, v, max, out);
    }
  }

  for (const lang of ['en', 'fil']) {
    const list = e.keywords && e.keywords[lang];
    if (!Array.isArray(list) || list.filter(isStr).length < LIMITS.minKeywords) {
      p(`keywords.${lang} needs at least ${LIMITS.minKeywords} phrases`);
    } else {
      list.forEach((k) => textProblems(id, `keywords.${lang}`, k, 0, out));
    }
  }

  if (e.steps !== undefined) {
    const en = e.steps && e.steps.en;
    const fil = e.steps && e.steps.fil;
    if (!Array.isArray(en) || !Array.isArray(fil) || en.length !== fil.length) {
      p('steps.en and steps.fil must be arrays of equal length');
    } else {
      for (const lang of ['en', 'fil']) {
        e.steps[lang].forEach((s, i) => {
          if (!isStr(s)) p(`steps.${lang}[${i}] is empty`);
          else textProblems(id, `steps.${lang}[${i}]`, s, LIMITS.step, out);
        });
      }
    }
  }

  // Routes: ids must exist, and every role that can see the entry must reach them.
  const roles = rolesOk ? expand(e.roles) : [];
  const checkRoute = (rid, label) => {
    if (!ctx.routeIds.has(rid)) { p(`${label} "${rid}" is not a known route id`); return; }
    for (const r of roles) {
      if (!reachable(rid, r)) p(`${label} "${rid}": role "${r}" cannot reach it`);
    }
  };
  if (e.target !== undefined && e.target !== null) checkRoute(e.target, 'target');
  if (e.targets !== undefined) {
    if (!Array.isArray(e.targets) || e.targets.length > LIMITS.maxTargets) {
      p(`targets must be an array of at most ${LIMITS.maxTargets} route ids`);
    } else {
      e.targets.forEach((t) => checkRoute(t, 'targets'));
    }
  }

  if (e.followUps !== undefined) {
    if (!Array.isArray(e.followUps) || e.followUps.length > LIMITS.maxFollowUps) {
      p(`followUps must be an array of at most ${LIMITS.maxFollowUps} entry ids`);
    } else {
      for (const fid of e.followUps) {
        const f = ctx.byId.get(fid);
        if (!f) { p(`followUps "${fid}" does not exist`); continue; }
        if (f.status !== 'approved') p(`followUps "${fid}" is not approved`);
        const fRoles = new Set(expand(Array.isArray(f.roles) ? f.roles : []));
        const missing = roles.filter((r) => !fRoles.has(r));
        if (missing.length) p(`followUps "${fid}" is not visible to role(s) ${missing.join(', ')}`);
      }
    }
  }

  if (e.contact !== undefined && typeof e.contact !== 'boolean') p('contact must be a boolean');
  if (e.priority !== undefined && typeof e.priority !== 'number') p('priority must be a number');

  // Approval metadata.
  if (e.policy !== null && e.policy !== undefined && !POLICY_ID.test(e.policy)) p(`policy "${e.policy}" must look like POL-01`);
  if (e.status === 'approved') {
    if (e.policy !== null && e.policy !== undefined) p('approved entries must have policy null');
    if (!isStr(e.reviewedBy)) p('approved entries need reviewedBy');
    if (!isStr(e.reviewedAt)) p('approved entries need reviewedAt');
  } else if (e.status === 'draft') {
    if (!e.policy) p('draft entries need a policy id (POL-NN) naming the open decision');
  }
  if (isStr(e.reviewedBy) && (/@/.test(e.reviewedBy))) p('reviewedBy must not be an email address');
  if (e.reviewedAt !== undefined) {
    const t = ISO_DATE.test(e.reviewedAt || '') ? Date.parse(`${e.reviewedAt}T00:00:00Z`) : NaN;
    if (Number.isNaN(t)) {
      p(`reviewedAt "${e.reviewedAt}" must be an ISO date (YYYY-MM-DD)`);
    } else {
      const age = (ctx.now.getTime() - t) / DAY;
      if (t > ctx.now.getTime() + TZ_SLACK) p(`reviewedAt ${e.reviewedAt} is in the future`);
      else if (age > LIMITS.maxAgeDays) p(`reviewedAt ${e.reviewedAt} is stale (older than ${LIMITS.maxAgeDays} days)`);
    }
  }
}

/**
 * @param {object[]} entries
 * @param {{routeIds?: Iterable<string>, now?: Date}} [opts]
 * @returns {string[]} problems; empty when valid
 */
export function validateEntries(entries, opts = {}) {
  const out = [];
  const routeIds = new Set(opts.routeIds || ROUTES.map((r) => r.id));
  const now = opts.now || new Date();
  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map();
  for (const e of list) {
    if (e && isStr(e.id)) {
      if (byId.has(e.id)) out.push(`${e.id}: duplicate id`);
      else byId.set(e.id, e);
    }
  }
  const ctx = { routeIds, now, byId };
  for (const e of list) checkEntry(e, ctx, out);
  return out;
}

/** Entries older than LIMITS.staleDiagnosticDays (reported, not failed). */
export function staleDiagnostics(entries, now = new Date()) {
  return entries
    .filter((e) => e.status === 'approved' && ISO_DATE.test(e.reviewedAt || ''))
    .filter((e) => (now.getTime() - Date.parse(`${e.reviewedAt}T00:00:00Z`)) / DAY > LIMITS.staleDiagnosticDays)
    .map((e) => `${e.id}: reviewed ${e.reviewedAt}, over ${LIMITS.staleDiagnosticDays} days ago`);
}
