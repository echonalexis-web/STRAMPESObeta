// Pure markdown renderer for the PESO content-owner review sheet.
// No I/O: scripts/chatbot-export.mjs supplies data and writes the file.

const cell = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();

const list = (arr) => (arr || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function renderSheet(entries, routes, opts = {}) {
  const { date = '', contact = {}, categories = [], label = (k) => k } = opts;
  const routeMap = new Map(routes.map((r) => [r.id, r]));
  const sorted = [...entries].sort(byId);

  const page = (e) => {
    const ids = [e.target, ...(e.targets || [])].filter(Boolean);
    return ids
      .map((id) => {
        const r = routeMap.get(id);
        return r ? `${label(r.labelKey)} (${r.path})` : `UNKNOWN ROUTE ${id}`;
      })
      .join('; ');
  };

  // Audience counts by roles list.
  const counts = new Map();
  for (const e of sorted) {
    const key = [...(e.roles || [])].sort().join(',');
    const c = counts.get(key) || { approved: 0, draft: 0 };
    c[e.status === 'draft' ? 'draft' : 'approved'] += 1;
    counts.set(key, c);
  }
  const total = (s) => sorted.filter((e) => e.status === s).length;

  const L = [];
  L.push('# Chatbot knowledge base review sheet', '');
  L.push(`Generated: ${date}`, '');
  L.push('Generated file. Do not edit by hand: run `npm run chatbot:export` in `client/`.', '');
  L.push('## Summary', '');
  L.push(`- Entries: ${sorted.length} (approved ${total('approved')}, draft ${total('draft')})`);
  L.push('', '| Audience (roles) | Approved | Draft |', '|---|---|---|');
  for (const k of [...counts.keys()].sort()) {
    L.push(`| ${cell(k)} | ${counts.get(k).approved} | ${counts.get(k).draft} |`);
  }
  L.push('', '## How to review', '');
  L.push('For each row, tick one: [ ] correct as written, [ ] correct with edits (write them), [ ] reject.');
  L.push('- Approved rows only describe where things are in the app. Check the English wording and the target page.');
  L.push('- DRAFT rows state or depend on PESO policy and stay switched off until PESO answers the policy id shown.');
  L.push('- Filipino text was machine-drafted and needs review by a native Filipino speaker before approval.', '');
  L.push('## Contact details used by the chatbot (please confirm)', '');
  for (const k of Object.keys(contact).sort()) L.push(`- ${k}: ${contact[k]} (please confirm)`);
  L.push('- office hours and address: not provided yet (POL-09)', '');

  const cats = [...categories];
  for (const e of sorted) if (!cats.includes(e.category)) cats.push(e.category);
  for (const c of cats) {
    const rows = sorted.filter((e) => e.category === c);
    if (!rows.length) continue;
    L.push(`## ${c}`, '');
    L.push('| id | roles | status | policy | reviewedAt | page | English Q | English A | Filipino Q | Filipino A | steps | keywords |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const e of rows) {
      const status = e.status === 'draft'
        ? `**DRAFT - needs PESO decision ${e.policy || '(no policy id)'}**`
        : 'approved';
      const steps = [
        e.steps?.en?.length ? `EN:\n${list(e.steps.en)}` : '',
        e.steps?.fil?.length ? `FIL:\n${list(e.steps.fil)}` : '',
      ].filter(Boolean).join('\n');
      const kw = `EN: ${(e.keywords?.en || []).join(', ')}\nFIL: ${(e.keywords?.fil || []).join(', ')}`;
      const cells = [
        `\`${e.id}\``, (e.roles || []).join(', '), status, e.policy || '', e.reviewedAt || '',
        page(e), e.q?.en, e.a?.en, e.q?.fil, e.a?.fil, steps, kw,
      ];
      L.push(`| ${cells.map((v, i) => (i === 0 ? v : cell(v))).join(' | ')} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
