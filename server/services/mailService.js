/**
 * mailService — outbound email.
 *
 * Transport is Gmail SMTP via nodemailer. It is *optional*: until the SMTP
 * env vars are set, every send is a no-op that logs the message (and the
 * important links) to the server console so the "email" flows stay testable
 * end to end.
 *
 * Enable it by setting, in server/.env:
 *   SMTP_HOST=smtp.gmail.com      (or SMTP_SERVICE=gmail)
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=<16-char Google App Password>   (NOT your normal password)
 *   MAIL_FROM=STRAM PESO <you@gmail.com>
 *
 * Swapping to a different provider later means changing only buildTransporter().
 */

const nodemailer = require("nodemailer");

const FROM = process.env.MAIL_FROM || "STRAM PESO <no-reply@strampeso.local>";
const BRAND = "STRAM PESO";
const GREEN = "#16a34a";

const isEmailConfigured = () =>
  Boolean((process.env.SMTP_HOST || process.env.SMTP_SERVICE) && process.env.SMTP_USER && process.env.SMTP_PASS);

let _transporter = null;
const buildTransporter = () => {
  if (_transporter) return _transporter;
  if (!isEmailConfigured()) return null;

  const common = {
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  };

  if (process.env.SMTP_SERVICE) {
    _transporter = nodemailer.createTransport({ service: process.env.SMTP_SERVICE, ...common });
  } else {
    const port = Number(process.env.SMTP_PORT) || 465;
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      ...common,
    });
  }
  return _transporter;
};

const logToConsole = ({ to, subject, text, reason = "no mail provider configured" }) => {
  const line = "─".repeat(64);
  console.log(
    `\n${line}\n📧  EMAIL NOT SENT (${reason})\n` +
      `    From:    ${FROM}\n` +
      `    To:      ${to}\n` +
      `    Subject: ${subject}\n${line}\n${text}\n${line}\n`
  );
};

// Minimal, inline-styled HTML shell — email clients ignore <style> blocks and
// external CSS, so everything is on the element.
const renderEmail = ({ heading, paragraphs = [], button, footnote }) => {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.6;">${p}</p>`)
    .join("");
  const cta = button
    ? `<p style="margin:24px 0;">
         <a href="${button.url}" style="background:${GREEN};color:#ffffff;text-decoration:none;
            padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block;">
           ${button.label}
         </a>
       </p>
       <p style="margin:0 0 14px;color:#64748b;font-size:13px;line-height:1.6;word-break:break-all;">
         If the button doesn't work, paste this link into your browser:<br>${button.url}
       </p>`
    : "";
  const foot = footnote
    ? `<p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">${footnote}</p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f0fdf4;padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
    <tr><td style="padding:8px 4px 16px;font-weight:800;font-size:18px;color:${GREEN};letter-spacing:.02em;">${BRAND}</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #dcfce7;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 16px;font-size:19px;color:#0f172a;">${heading}</h1>
      ${body}${cta}${foot}
    </td></tr>
    <tr><td style="padding:16px 4px;color:#94a3b8;font-size:12px;">
      Public Employment Service Office — Lalawigan ng Marinduque
    </td></tr>
  </table>
</body></html>`;
};

/**
 * Send one email. Falls back to a console log when no transport is configured
 * or when the transport throws, so callers never need a try/catch of their own.
 * @returns {Promise<{delivered:boolean, channel:string}>}
 */
const sendMail = async ({ to, subject, text, html }) => {
  const transporter = buildTransporter();
  if (!transporter) {
    logToConsole({ to, subject, text });
    return { delivered: false, channel: "console" };
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    return { delivered: true, channel: "smtp" };
  } catch (err) {
    logToConsole({ to, subject, text, reason: `SMTP send failed: ${err.message}` });
    return { delivered: false, channel: "error" };
  }
};

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

const sendPasswordResetEmail = async ({ to, name, resetUrl, expiresMinutes = 30 }) => {
  const subject = "Reset your STRAM PESO password";
  const text =
    `Hi ${name || "there"},\n\n` +
    `We received a request to reset the password for this account.\n` +
    `Open the link below to choose a new password. It expires in ${expiresMinutes} minutes.\n\n` +
    `${resetUrl}\n\n` +
    `If you didn't request this, you can ignore this email — your password stays the same.`;
  const html = renderEmail({
    heading: "Reset your password",
    paragraphs: [
      `Hi ${name || "there"},`,
      `We received a request to reset the password for this account. Choose a new password using the button below — the link expires in <strong>${expiresMinutes} minutes</strong>.`,
    ],
    button: { url: resetUrl, label: "Choose a new password" },
    footnote: "If you didn't request this, you can ignore this email — your password stays the same.",
  });
  return sendMail({ to, subject, text, html });
};

/**
 * Security notice sent to the account's own address after the password changes
 * (via reset or an in-account change).
 */
const sendPasswordChangedEmail = async ({ to, name }) => {
  const subject = "Your STRAM PESO password was changed";
  const text =
    `Hi ${name || "there"},\n\n` +
    `The password for your STRAM PESO account was just changed.\n\n` +
    `If this was you, no action is needed. If it wasn't, reset your password immediately ` +
    `and contact the PESO office.`;
  const html = renderEmail({
    heading: "Your password was changed",
    paragraphs: [
      `Hi ${name || "there"},`,
      `The password for your ${BRAND} account was just changed.`,
      `If this was you, no action is needed. <strong>If it wasn't</strong>, reset your password immediately and contact the PESO office.`,
    ],
  });
  return sendMail({ to, subject, text, html });
};

/* ------------------------------------------------------------------ */
/* Email verification (registration)                                  */
/* ------------------------------------------------------------------ */

const sendEmailVerification = async ({ to, name, verifyUrl, expiresHours = 24 }) => {
  const subject = "Verify your STRAM PESO email address";
  const text =
    `Hi ${name || "there"},\n\n` +
    `Thanks for registering with STRAM PESO. Open the link below to verify this email address. ` +
    `It expires in ${expiresHours} hours.\n\n` +
    `${verifyUrl}\n\n` +
    `If you didn't create this account, you can ignore this email.`;
  const html = renderEmail({
    heading: "Verify your email address",
    paragraphs: [
      `Hi ${name || "there"},`,
      `Thanks for registering with ${BRAND}. Confirm this is your email address using the button below — the link expires in <strong>${expiresHours} hours</strong>.`,
    ],
    button: { url: verifyUrl, label: "Verify my email" },
    footnote: "If you didn't create this account, you can ignore this email.",
  });
  return sendMail({ to, subject, text, html });
};

/* ------------------------------------------------------------------ */
/* Email change                                                        */
/* ------------------------------------------------------------------ */

/** Verification link — sent to the NEW address. */
const sendEmailChangeVerification = async ({ to, name, verifyUrl, expiresMinutes = 30 }) => {
  const subject = "Confirm your new STRAM PESO email address";
  const text =
    `Hi ${name || "there"},\n\n` +
    `You asked to change the email address on your STRAM PESO account to this one.\n` +
    `Open the link below to confirm. It expires in ${expiresMinutes} minutes.\n\n` +
    `${verifyUrl}\n\n` +
    `If you didn't request this, you can ignore this email.`;
  const html = renderEmail({
    heading: "Confirm your new email address",
    paragraphs: [
      `Hi ${name || "there"},`,
      `You asked to change the email address on your ${BRAND} account to this one. Confirm using the button below — the link expires in <strong>${expiresMinutes} minutes</strong>.`,
    ],
    button: { url: verifyUrl, label: "Confirm this email address" },
    footnote: "If you didn't request this, you can ignore this email.",
  });
  return sendMail({ to, subject, text, html });
};

/**
 * Security notice — sent to the OLD (current) address when an email change is
 * requested, and again when it completes.
 */
const sendEmailChangeAlert = async ({ to, name, newEmail, completed = false }) => {
  const subject = completed
    ? "Your STRAM PESO email address was changed"
    : "An email change was requested on your STRAM PESO account";
  const text = completed
    ? `Hi ${name || "there"},\n\n` +
      `The email address on your STRAM PESO account was changed to ${newEmail}. ` +
      `You'll sign in with the new address from now on.\n\n` +
      `If this wasn't you, contact the PESO office immediately.`
    : `Hi ${name || "there"},\n\n` +
      `Someone requested changing the email address on your STRAM PESO account to ${newEmail}. ` +
      `The change only takes effect after that new address is confirmed.\n\n` +
      `If this wasn't you, change your password now and contact the PESO office.`;
  const html = renderEmail({
    heading: completed ? "Your email address was changed" : "An email change was requested",
    paragraphs: completed
      ? [
          `Hi ${name || "there"},`,
          `The email address on your ${BRAND} account was changed to <strong>${newEmail}</strong>. You'll sign in with the new address from now on.`,
          `If this wasn't you, contact the PESO office immediately.`,
        ]
      : [
          `Hi ${name || "there"},`,
          `Someone requested changing the email address on your ${BRAND} account to <strong>${newEmail}</strong>. The change only takes effect after that new address is confirmed.`,
          `If this wasn't you, change your password now and contact the PESO office.`,
        ],
  });
  return sendMail({ to, subject, text, html });
};

module.exports = {
  isEmailConfigured,
  sendMail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailVerification,
  sendEmailChangeVerification,
  sendEmailChangeAlert,
};
