// Run-once guard for single-use confirmation links.
//
// A confirmation token can be redeemed exactly once, so a duplicate request
// (React StrictMode re-running an effect, a re-render, the entry route mounting
// twice) would turn a success into a false "already used". Keeping the
// in-flight promise in a plain module-level Map survives the unmount/remount
// StrictMode performs, which component state and refs may not.
//
// Contract for `task`: it returns a promise that never rejects and resolves to
// an outcome object. An outcome with `retryable: true` (network / 5xx — the
// server did not consume the token) is forgotten so the same key can run
// again. Every other outcome (success, or a definitive 400) stays cached.
//
// The key holds the token, so this Map must stay in memory only: never write
// it to storage, history, location state, or logs.
export function createOneShot() {
  const entries = new Map();

  return {
    run(key, task) {
      const existing = entries.get(key);
      if (existing) return existing;
      const promise = Promise.resolve(task()).then((outcome) => {
        if (outcome && outcome.retryable && entries.get(key) === promise) {
          entries.delete(key);
        }
        return outcome;
      });
      entries.set(key, promise);
      return promise;
    },
    has(key) {
      return entries.has(key);
    },
  };
}
