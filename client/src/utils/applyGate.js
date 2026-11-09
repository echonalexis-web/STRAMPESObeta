// How the apply screen reacts to the server's answers for the phone rule and the
// daily application cap. Pure, so it is unit-testable.

// {kind: "phone", code} when the server wants a phone number first,
// {kind: "limit", retryAfter} for the daily cap (retryAfter in seconds, 0 when unknown),
// {kind: "other"} for everything else.
export const applyErrorKind = (err) => {
  const data = err?.response?.data;
  const code = data?.code;
  if (code === "PHONE_REQUIRED" || code === "PHONE_INVALID") return { kind: "phone", code };
  if (code === "APPLY_DAILY_LIMIT") {
    const retryAfter = Number(data?.retryAfter);
    return { kind: "limit", retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0 };
  }
  return { kind: "other" };
};

// "45 s", "12 min", "3 h 20 min". Units are language neutral.
export const formatWait = (totalSeconds) => {
  const n = Math.ceil(Number(totalSeconds));
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 60) return `${n} s`;
  const minutes = Math.ceil(n / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};
