/**
 * Dev-mode fake auth.
 *
 * When VITE_CLERK_PUBLISHABLE_KEY is unset, the app never mounts <ClerkProvider>
 * and instead uses DevAuthProvider (see DevAuthProvider.jsx) with a tiny
 * /dev-login screen. That screen calls buildDevToken() below to produce a
 * fake bearer token, which api/client.js attaches as `Authorization: Bearer <token>`
 * on every request exactly as it would a real Clerk session JWT.
 *
 * Token shape (matches apps/api/src/adapters/clerk.adapter.js's dev-bypass):
 *
 *   dev:<role>:<institutionId-or-empty>:<userAccountId>:<email>:<studentProfileId-or-empty>
 *
 * `userAccountId` must be a real `user_account.user_id` and, for the student
 * role, `studentProfileId` must be the matching (and DIFFERENT) `student.
 * student_id` — see db/seeds/seed.js and DevAuthProvider.jsx for the fixed
 * demo ids these values come from. If the API's dev-bypass format ever
 * changes, this is the only file that needs to change.
 */
export function buildDevToken({ role, institutionId = '', userId, email, studentProfileId = '' }) {
  return `dev:${role}:${institutionId}:${userId}:${email}:${studentProfileId}`;
}

let hasWarned = false;

/** Logs a single, obvious warning the first time dev auth mode is used. */
export function warnDevModeOnce() {
  if (hasWarned) return;
  hasWarned = true;
  // eslint-disable-next-line no-console -- the one sanctioned console call, dev-mode only.
  console.warn(
    '[SecureCred] VITE_CLERK_PUBLISHABLE_KEY is not set — running with local dev-mode ' +
      'auth. Sign-in is simulated at /dev-login using fake bearer tokens ' +
      '("dev:<role>:<institutionId>:<subjectId>:<email>"). Do not use this build in production.',
  );
}
