// Writes docs/chatbot/kb-review.md for the PESO content owner.
// Usage: npm run chatbot:export [-- YYYY-MM-DD]   (date only goes in the header)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSheet } from './lib/renderKbSheet.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(resolve(root, 'src/chatbot', p)).href;
const { ALL_ENTRIES } = await import(src('kb/index.js'));
const { ROUTES } = await import(src('routes/registry.js'));
const { CATEGORIES } = await import(src('kb/categories.js'));
const { CONTACT } = await import(src('contact.js'));

const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8'));
const label = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), en) ?? key;

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const out = resolve(root, '../docs/chatbot/kb-review.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderSheet(ALL_ENTRIES, ROUTES, { date, contact: CONTACT, categories: CATEGORIES, label }) + '\n');
console.log(`Wrote ${out} (${ALL_ENTRIES.length} entries)`);
