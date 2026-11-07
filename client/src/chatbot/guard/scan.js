// Pure scanner behind importGuard.test.js. No fs, no deps.
// Paths are posix-style, relative to client/src/chatbot/ (e.g. 'ui/ChatPanel.jsx').
//
// This file names the forbidden tokens, so it is excluded from its own scan
// (see isScanned), as is importGuard.test.js.

const TEST_FILE = /\.test\.js$/;
const ALLOW_AUTH = new Set(['ui/useChatContext.js']);
const ALLOW_NAVIGATE = new Set(['ui/ChatPanel.jsx']);

// Token rules for non-test source, matched on comment-stripped code.
const TOKEN_RULES = [
  ['localStorage', /localStorage/],
  ['sessionStorage', /sessionStorage/],
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['document.cookie', /document\s*\.\s*cookie/],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML', /innerHTML/],
  ['window.location', /window\s*\.\s*location/],
  ['eval(', /\beval\s*\(/],
  ['new Function(', /\bnew\s+Function\s*\(/],
];

// Module-specifier rules (static import, bare import, import(), require()).
const SPEC_RULES = [
  ['import:services/api', /services\/api/],
  ['import:axios', /axios/],
  ['import:socket', /socket/i],
];

export function isScanned(relPath) {
  return relPath !== 'importGuard.test.js' && !relPath.startsWith('guard/');
}

// Replaces comments with spaces (newlines kept so line numbers stay true).
// Single linear pass tracking '...', "...", `...` so '//' inside a string is
// not a comment. Limits: regex literals are not recognised (a regex containing
// an unbalanced quote, or '//' , can confuse it); `${}` inside template
// literals is treated as plain string text, so a comment inside an
// interpolation is not stripped and a quote inside one can desync the state.
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < n) { out += '  '; i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += src[i++]; if (i < n) out += src[i++]; continue; }
        if (src[i] === '\n' && c !== '`') break; // unterminated, resync at EOL
        out += src[i++];
      }
      if (i < n && src[i] === c) { out += c; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

const SPEC_RE = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function specifiers(code) {
  const out = [];
  for (const re of SPEC_RE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) out.push({ spec: m[1], index: m.index });
  }
  return out;
}

const lineOf = (code, index) => code.slice(0, index).split('\n').length;

// Returns [{ file, line, rule, message }]. Empty array = clean.
export function scanSource(relPath, source) {
  const code = stripComments(source);
  const found = [];
  const add = (rule, index, message) =>
    found.push({ file: relPath, line: lineOf(code, index), rule, message: `${relPath}:${lineOf(code, index)} ${message}` });
  const isTest = TEST_FILE.test(relPath);
  const inUi = relPath.startsWith('ui/');

  for (const { spec, index } of specifiers(code)) {
    for (const [rule, re] of SPEC_RULES) {
      if (re.test(spec)) add(rule, index, `forbidden import '${spec}'`);
    }
    if (isTest) {
      if (/AuthContext/.test(spec)) add('import:AuthContext', index, `test imports '${spec}'`);
      continue;
    }
    if (!inUi) {
      if (/^react($|\/|-)/.test(spec)) add('import:react', index, `non-ui file imports '${spec}'`);
      if (spec.startsWith('.') && /(^|\/)ui(\/|$)/.test(spec)) add('import:ui', index, `non-ui file imports ui '${spec}'`);
    }
  }
  if (isTest) return dedupe(found);

  for (const [rule, re] of TOKEN_RULES) {
    const m = re.exec(code);
    if (m) add(rule, m.index, `forbidden token ${rule}`);
  }
  let m;
  if (!ALLOW_AUTH.has(relPath) && (m = /AuthContext/.exec(code))) {
    add('AuthContext', m.index, 'AuthContext allowed only in ui/useChatContext.js');
  }
  if (!ALLOW_NAVIGATE.has(relPath)) {
    if ((m = /\bnavigate\s*\(/.exec(code))) add('navigate(', m.index, 'navigate( allowed only in ui/ChatPanel.jsx');
    if ((m = /\buseNavigate\b/.exec(code))) add('useNavigate', m.index, 'useNavigate allowed only in ui/ChatPanel.jsx');
  }
  return dedupe(found);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((v) => {
    const k = `${v.rule}@${v.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
