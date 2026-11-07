// Single source of PESO contact details for the chatbot. Links are built here,
// never inside KB strings (the validator rejects "http" and "<" in entries).
//
// POLICY/VERIFY: values copied from the site footers (Home.jsx, About.jsx,
// LegalCenter.jsx). They are pending confirmation by the user / PESO content
// owner (plan question POL-09 covers office hours and address).
export const CONTACT = Object.freeze({
  phone: '+63 956 784 4364',
  email: 'lmdpeso@yahoo.com',
  facebook: 'LMDPESOMarinduqueOfficial',
});

/** tel: link; keeps the leading + and digits only. */
export function telHref(phone = CONTACT.phone) {
  return `tel:${String(phone).replace(/[^+\d]/g, '')}`;
}

/** Plain mailto: link (respects the user's own mail app, unlike the footer's Yahoo compose URL). */
export function mailtoHref(email = CONTACT.email) {
  return `mailto:${email}`;
}

/** Facebook page URL from the page handle. */
export function facebookHref(handle = CONTACT.facebook) {
  return `https://www.facebook.com/${encodeURIComponent(handle)}`;
}
