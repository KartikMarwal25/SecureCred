import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLE } from '@securecred/shared';
import { AuthContext } from './AuthContext.js';
import { buildDevToken, warnDevModeOnce } from './devAuth.js';

/**
 * Fixed demo ids matching `db/seeds/seed.js` exactly — dev-mode sign-in
 * must map to REAL rows in a freshly seeded database, not random ids, or
 * every write (issuance, revocation) would fail its foreign-key checks.
 * Keep in sync with db/seeds/seed.js if those constants ever change.
 */
const SEED_INSTITUTION_ID = '00000000-0000-0000-0000-000000000001';
const SEED_INSTITUTION_STAFF_USER_ID = '00000000-0000-0000-0000-000000000002';
const SEED_STUDENT_USER_ID = '00000000-0000-0000-0000-000000000003';
const SEED_STUDENT_PROFILE_ID = '00000000-0000-0000-0000-000000000004';

/**
 * Local stand-in for Clerk when no publishable key is configured. Session
 * state lives only in React state (never localStorage/sessionStorage) so it
 * resets on every page reload — intentional for a throwaway dev session.
 */
export function DevAuthProvider({ children }) {
  const [session, setSession] = useState(null); // { role, email, userId, institutionId, studentProfileId } | null

  useEffect(() => {
    warnDevModeOnce();
  }, []);

  const devLogin = useCallback((role) => {
    if (role === ROLE.INSTITUTION) {
      setSession({
        role,
        email: 'institution.demo@skit.ac.in',
        userId: SEED_INSTITUTION_STAFF_USER_ID,
        institutionId: SEED_INSTITUTION_ID,
        studentProfileId: '',
      });
    } else {
      setSession({
        role,
        email: 'student.demo@skit.ac.in',
        userId: SEED_STUDENT_USER_ID,
        institutionId: '',
        studentProfileId: SEED_STUDENT_PROFILE_ID,
      });
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
  }, []);

  const getToken = useCallback(async () => {
    if (!session) return null;
    return buildDevToken(session);
  }, [session]);

  const value = useMemo(
    () => ({
      mode: 'dev',
      isLoaded: true,
      isSignedIn: Boolean(session),
      role: session?.role ?? null,
      email: session?.email ?? null,
      subjectId: session?.userId ?? null,
      institutionId: session?.institutionId ?? null,
      getToken,
      signOut,
      devLogin,
    }),
    [session, getToken, signOut, devLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
