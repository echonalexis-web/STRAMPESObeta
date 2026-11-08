// Plain-text file a user can keep offline after generating backup codes.
//
// Rules the format must keep:
//  - Each code is written bare, one per line, exactly as the server issued it
//    (XXXX-XXXX). The recovery form keeps the dash, so a user who copies a
//    line out of this file must be able to paste it straight in: no numbering,
//    bullets or trailing text on a code line.
//  - No account details (email, username, id): a stray file on a shared
//    computer should not say whose codes they are.
//  - CRLF line endings so Windows Notepad shows separate lines.
//
// Pure and string-in/string-out so it is unit-testable; the caller passes the
// already-translated header text.

const EOL = "\r\n";

const pad = (n) => String(n).padStart(2, "0");

// Local calendar date as YYYY-MM-DD (not UTC, so it matches what the user saw).
export function localDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function backupCodesFilename(date = new Date()) {
  return `strampeso-backup-codes-${localDateStamp(date)}.txt`;
}

export function buildBackupCodesText(codes, { title, generatedLabel, notes = [] } = {}) {
  const list = Array.isArray(codes) ? codes.map((c) => String(c).trim()).filter(Boolean) : [];
  if (list.length === 0) throw new Error("No backup codes to write");

  const lines = [];
  if (title) lines.push(title);
  if (generatedLabel) lines.push(generatedLabel);
  if (lines.length > 0) lines.push("");
  if (notes.length > 0) {
    lines.push(...notes, "");
  }
  lines.push(...list);
  return lines.join(EOL) + EOL;
}

// Saves `text` as a .txt download. Kept here rather than reusing
// exportUtils.downloadBlob because that module statically imports jsPDF and
// html2canvas, which Settings should not pull in. The Blob is in memory only;
// nothing is written to storage and the object URL is revoked right away.
export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
