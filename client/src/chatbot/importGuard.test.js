import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, stripComments, isScanned } from './guard/scan.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Manual recursive walk (no fs.glob: Node 22 compatible). Returns posix-style
// paths relative to chatbot/.
function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), r));
    else if (/\.jsx?$/.test(entry.name)) out.push(r);
  }
  return out.sort();
}

const files = walk(ROOT).filter(isScanned);

test('guard: scans a non-trivial set of real files', () => {
  assert.ok(files.length > 10, `only ${files.length} files found`);
  assert.ok(files.includes('engine/index.js'));
  assert.ok(!files.includes('importGuard.test.js'), 'guard must not scan itself');
});

test('guard: real chatbot tree has no violations', () => {
  const violations = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    violations.push(...scanSource(f, src));
  }
  assert.deepEqual(violations, []);
});

// ---- Prove the guard bites: in-memory bad snippets only. ----
const rules = (p, src) => scanSource(p, src).map((v) => v.rule);

test('scanner: flags localStorage use', () => {
  assert.ok(rules('engine/x.js', "localStorage.getItem('k');").includes('localStorage'));
});
test('scanner: flags sessionStorage, document.cookie, window.location, XMLHttpRequest', () => {
  assert.ok(rules('kb/x.js', 'sessionStorage.x').includes('sessionStorage'));
  assert.ok(rules('kb/x.js', 'const c = document.cookie;').includes('document.cookie'));
  assert.ok(rules('kb/x.js', 'window.location.href = "/";').includes('window.location'));
  assert.ok(rules('kb/x.js', 'new XMLHttpRequest()').includes('XMLHttpRequest'));
});
test('scanner: flags fetch(', () => {
  assert.ok(rules('engine/x.js', "await fetch('/api');").includes('fetch('));
});
test('scanner: flags axios / services/api / socket imports, incl. dynamic import()', () => {
  assert.ok(rules('engine/x.js', "import axios from 'axios';").includes('import:axios'));
  assert.ok(rules('ui/x.jsx', "import api from '../../services/api';").includes('import:services/api'));
  assert.ok(rules('ui/x.jsx', "import { io } from 'socket.io-client';").includes('import:socket'));
  assert.ok(rules('ui/x.jsx', "import { S } from '../../context/SocketContext';").includes('import:socket'));
  assert.ok(rules('ui/x.jsx', "const m = await import('axios');").includes('import:axios'));
  assert.ok(rules('ui/x.jsx', "const m = require('axios');").includes('import:axios'));
});
test('scanner: flags dangerouslySetInnerHTML, innerHTML, eval(, new Function(', () => {
  assert.ok(rules('ui/x.jsx', '<div dangerouslySetInnerHTML={{__html: h}} />').includes('dangerouslySetInnerHTML'));
  assert.ok(rules('ui/x.jsx', 'el.innerHTML = h;').includes('innerHTML'));
  assert.ok(rules('ui/x.jsx', 'eval("1")').includes('eval('));
  assert.ok(rules('ui/x.jsx', 'new Function("return 1")').includes('new Function('));
});
test('scanner: AuthContext only in ui/useChatContext.js', () => {
  const src = "import { AuthContext } from '../../context/AuthContext';";
  assert.ok(rules('ui/ChatPanel.jsx', src).includes('AuthContext'));
  assert.ok(rules('engine/x.js', src).includes('AuthContext'));
  assert.deepEqual(rules('ui/useChatContext.js', src), []);
});
test('scanner: navigate( / useNavigate only in ui/ChatPanel.jsx', () => {
  assert.ok(rules('ui/Other.jsx', 'navigate("/x")').includes('navigate('));
  assert.ok(rules('engine/x.js', 'navigate("/x")').includes('navigate('));
  assert.ok(rules('ui/Other.jsx', 'const n = useNavigate();').includes('useNavigate'));
  assert.deepEqual(rules('ui/ChatPanel.jsx', 'const n = useNavigate(); n("/x"); navigate("/y");'), []);
});
test('scanner: purity, engine/kb/routes never import react, react-router or ui/', () => {
  for (const dir of ['engine', 'kb', 'routes']) {
    assert.ok(rules(`${dir}/x.js`, "import React from 'react';").includes('import:react'));
    assert.ok(rules(`${dir}/x.js`, "import { Link } from 'react-router-dom';").includes('import:react'));
    assert.ok(rules(`${dir}/x.js`, "import { y } from '../ui/y.js';").includes('import:ui'));
  }
  assert.deepEqual(rules('ui/ChatPanel.jsx', "import { useState } from 'react';"), []);
});
test('scanner: forbidden words in comments are ignored', () => {
  const src = "// localStorage fetch( axios\n/* window.location\n eval( */\nconst a = 1; // navigate(\n";
  assert.deepEqual(rules('engine/x.js', src), []);
});
test('scanner: comment markers inside strings do not hide code', () => {
  const src = "const u = 'http://x'; localStorage.x;";
  assert.ok(rules('engine/x.js', src).includes('localStorage'));
});
test('scanner: test files get only the narrow import rule', () => {
  const ok = "import fs from 'node:fs'; import t from 'node:test'; import p from 'node:path'; import { fileURLToPath } from 'node:url'; localStorage.x; fetch(1);";
  assert.deepEqual(rules('engine/x.test.js', ok), []);
  assert.ok(rules('engine/x.test.js', "import a from 'axios';").includes('import:axios'));
  assert.ok(rules('engine/x.test.js', "import a from '../../services/api';").includes('import:services/api'));
  assert.ok(rules('engine/x.test.js', "import s from 'socket.io-client';").includes('import:socket'));
  assert.ok(rules('engine/x.test.js', "import { AuthContext } from '../../context/AuthContext';").includes('import:AuthContext'));
});
test('stripComments: preserves length of line structure', () => {
  const out = stripComments('a // b\n/* c\nd */ e');
  assert.equal(out.split('\n').length, 3);
  assert.ok(!out.includes('b') && !out.includes('c') && out.includes('e'));
});
