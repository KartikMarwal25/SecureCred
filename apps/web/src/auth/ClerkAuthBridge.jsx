import { useCallback, useMemo } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { AuthContext } from './AuthContext.js';

/**
 * Adapts Clerk's hooks to the app's unified AuthContext shape. Role and
 * institutionId are modelled as Clerk public metadata (set by an
 * institution admin / backend when an account is created):
 *
 *   user.publicMetadata = { role: 'institution' | 'student', institutionId?: string }
 *
 * publicMetadata (not unsafeMetadata) is used deliberately — it is
 * read-only from the client, so a signed-in user cannot grant themselves
 * the institution role by editing their own profile.
 */
export function ClerkAuthBridge({ children }) {
  const { isLoaded: authLoaded, isSignedIn, getToken: clerkGetToken, signOut } = useClerkAuth();
  const { isLoaded: userLoaded, user } = useUser();

  const getToken = useCallback(async () => {
    if (!isSignedIn) return null;
    return clerkGetToken();
  }, [isSignedIn, clerkGetToken]);

  const value = useMemo(() => {
    const metadata = user?.publicMetadata ?? {};
    return {
      mode: 'clerk',
      isLoaded: authLoaded && userLoaded,
      isSignedIn: Boolean(isSignedIn),
      role: metadata.role ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      subjectId: user?.id ?? null,
      institutionId: metadata.institutionId ?? null,
      getToken,
      signOut,
    };
  }, [authLoaded, userLoaded, isSignedIn, user, getToken, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
