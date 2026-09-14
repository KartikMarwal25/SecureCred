import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { AuthContext } from './AuthContext.js';
import { getMyScope } from '../api/client.js';

/**
 * Adapts Clerk's hooks to the app's unified AuthContext shape.
 *
 * Role/institutionId/studentId are NOT read from Clerk's own public
 * metadata — the API resolves those authoritatively from its own database
 * (see apps/api/src/middleware/auth.mw.js), specifically so a self-
 * registered student's access can change (e.g. once an institution issues
 * them a credential) without needing Clerk metadata kept in sync or a new
 * session token reissued. This bridge asks the API's `/auth/me` once
 * signed in and exposes whatever it says; `isLoaded` stays false until
 * that answer is in, so route guards never make a decision on a stale
 * "no role yet" state.
 */
export function ClerkAuthBridge({ children }) {
  const { isLoaded: authLoaded, isSignedIn, getToken: clerkGetToken, signOut } = useClerkAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const [scope, setScope] = useState(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);

  const getToken = useCallback(async () => {
    if (!isSignedIn) return null;
    return clerkGetToken();
  }, [isSignedIn, clerkGetToken]);

  useEffect(() => {
    if (!authLoaded || !userLoaded) return undefined;

    if (!isSignedIn) {
      setScope(null);
      setScopeLoaded(true);
      return undefined;
    }

    let cancelled = false;
    setScopeLoaded(false);
    getMyScope()
      .then((data) => {
        if (cancelled) return;
        setScope({
          role: data.role,
          institutionId: data.institutionId,
          studentId: data.studentId,
          pendingInstitutionRequest: data.pendingInstitutionRequest ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setScope(null);
      })
      .finally(() => {
        if (!cancelled) setScopeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoaded, userLoaded, isSignedIn, user?.id]);

  const value = useMemo(
    () => ({
      mode: 'clerk',
      isLoaded: authLoaded && userLoaded && scopeLoaded,
      isSignedIn: Boolean(isSignedIn),
      role: scope?.role ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      subjectId: user?.id ?? null,
      institutionId: scope?.institutionId ?? null,
      studentId: scope?.studentId ?? null,
      pendingInstitutionRequest: scope?.pendingInstitutionRequest ?? null,
      getToken,
      signOut,
    }),
    [authLoaded, userLoaded, scopeLoaded, isSignedIn, scope, user, getToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
