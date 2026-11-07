// Pure helpers for picking entry text. Filipino falls back to English, tagged.
export function pickText(field, locale) {
  const wanted = field && typeof field[locale] === 'string' ? field[locale].trim() : '';
  if (wanted) return { text: wanted, english: false };
  const en = field && typeof field.en === 'string' ? field.en.trim() : '';
  return { text: en, english: locale !== 'en' && en !== '' };
}

export function pickSteps(steps, locale) {
  const wanted = steps && Array.isArray(steps[locale]) ? steps[locale] : [];
  if (wanted.length) return { items: wanted, english: false };
  const en = steps && Array.isArray(steps.en) ? steps.en : [];
  return { items: en, english: locale !== 'en' && en.length > 0 };
}

export const paragraphs = (text) =>
  String(text || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

export const isVisibleTo = (entry, role) =>
  Boolean(entry) && (entry.roles.includes('*') || entry.roles.includes(role));
