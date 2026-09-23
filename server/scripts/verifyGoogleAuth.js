/**
 * Live check for Step 5 of the Google OAuth audit (token claims + server
 * acceptance). Takes a real id_token captured via
 * server/scripts/tools/google-id-token.html and:
 *
 *   1. Calls Google's tokeninfo endpoint and checks `aud` matches
 *      GOOGLE_CLIENT_ID and `email_verified` is true.
 *   2. POSTs the same credential to this app's own POST /auth/google so you
 *      can confirm the running server accepts it end-to-end and issues a
 *      session JWT.
 *
 * There is no separate /v3/userinfo check here: this app only requests an
 * id_token (Google Identity Services "Sign in with Google" button), never an
 * access_token, so there is no access_token to call /v3/userinfo with. The
 * tokeninfo call above already covers the claims userinfo would return.
 *
 * The id_token and any session JWT returned by the app are never printed in
 * full — only a short prefix/suffix, enough to confirm two runs used
 * different tokens without exposing a usable credential in your terminal
 * scrollback or shell history.
 *
 * Usage (from the server/ directory):
 *   node scripts/verifyGoogleAuth.js <id_token> [apiBaseUrl]
 *
 * apiBaseUrl defaults to http://localhost:3000/api/v1 (matches
 * VITE_API_URL in .env.example). Point it at a real dev/staging deployment
 * to test that server instead. Never point this at production with a
 * throwaway test account unless that's actually what you intend — a
 * successful call creates or updates a real user record.
 */
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const idToken = process.argv[2];
const apiBaseUrl = (process.argv[3] || "http://localhost:3000/api/v1").replace(/\/+$/, "");
const expectedAudience = (process.env.GOOGLE_CLIENT_ID || "").trim();

const mask = (token) => {
  if (!token) return "(none)";
  if (token.length <= 16) return "***";
  return `${token.slice(0, 8)}...${token.slice(-6)} (${token.length} chars)`;
};

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

async function main() {
  if (!idToken) {
    console.error("Usage: node scripts/verifyGoogleAuth.js <id_token> [apiBaseUrl]");
    process.exitCode = 1;
    return;
  }
  if (!expectedAudience) {
    fail("GOOGLE_CLIENT_ID is not set in server/.env — can't verify the audience claim.");
    return;
  }

  console.log(`Captured id_token: ${mask(idToken)}`);
  console.log(`Expecting audience (GOOGLE_CLIENT_ID): ${expectedAudience}`);
  console.log("");

  // ---- 1. tokeninfo ----
  console.log("Step 1/2: querying Google tokeninfo...");
  let claims;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    claims = await res.json();
    if (!res.ok) {
      fail(`tokeninfo rejected the token: ${claims.error_description || claims.error || res.status}`);
      return;
    }
  } catch (err) {
    fail(`Could not reach tokeninfo endpoint: ${err.message}`);
    return;
  }

  const audOk = claims.aud === expectedAudience;
  const emailVerifiedOk = claims.email_verified === "true" || claims.email_verified === true;

  console.log(`  iss:            ${claims.iss}`);
  console.log(`  aud:            ${claims.aud}  ${audOk ? "(matches GOOGLE_CLIENT_ID)" : "*** MISMATCH ***"}`);
  console.log(`  email:          ${claims.email || "(none)"}`);
  console.log(`  email_verified: ${claims.email_verified}  ${emailVerifiedOk ? "" : "*** NOT VERIFIED ***"}`);
  console.log(`  exp:            ${claims.exp} (${new Date(Number(claims.exp) * 1000).toISOString()})`);
  console.log("");

  if (!audOk) fail("aud claim does not match this server's GOOGLE_CLIENT_ID — token was issued for a different client.");
  if (!emailVerifiedOk) fail("email_verified is not true — the app's own check in authController.js would reject this token too.");

  // ---- 2. App's own /auth/google endpoint ----
  console.log(`Step 2/2: POSTing to ${apiBaseUrl}/auth/google ...`);
  try {
    const res = await fetch(`${apiBaseUrl}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: idToken }),
    });
    const body = await res.json();
    if (!res.ok) {
      fail(`App rejected the credential (HTTP ${res.status}): ${body.message || JSON.stringify(body)}`);
      return;
    }
    console.log(`  App accepted the token and issued a session token: ${mask(body.token)}`);
    console.log(`  isNewUser: ${body.isNewUser}`);
    console.log(`  user.role: ${body.user && body.user.role}`);
    console.log(`  user.email: ${body.user && body.user.email}`);
    console.log("");
    console.log("PASS: token verified by Google and accepted by the app end-to-end.");
  } catch (err) {
    fail(`Could not reach ${apiBaseUrl}/auth/google: ${err.message}`);
  }
}

main();
