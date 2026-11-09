// Security alerts are created by the server with English title and message text
// and a `metadata.alertKey`. This swaps in the user's language when the key is
// one we know; any other notification is returned untouched.

export const ALERT_KEYS = [
  "emailAdded",
  "passwordChanged",
  "newSignIn",
  "failedAttempts",
  "accountLocked",
  "passwordResetByStaff",
  "recoveryRequested",
];

export const localizedAlert = (item, t) => {
  const key = item?.metadata?.alertKey;
  if (!key || !ALERT_KEYS.includes(key) || typeof t !== "function") {
    return { title: item?.title, message: item?.message };
  }
  return {
    title: t(`alerts.${key}Title`, { defaultValue: item.title }),
    message: t(`alerts.${key}Body`, { defaultValue: item.message }),
  };
};
