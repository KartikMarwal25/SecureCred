import { createContext } from 'react';

/**
 * Unified auth shape consumed by the whole app, regardless of whether Clerk
 * or the local dev-mode provider is mounted underneath. Shape:
 *
 * {
 *   mode: 'clerk' | 'dev',
 *   isLoaded: boolean,
 *   isSignedIn: boolean,
 *   role: 'institution' | 'student' | null,
 *   email: string | null,
 *   subjectId: string | null,
 *   institutionId: string | null,
 *   getToken: () => Promise<string | null>,
 *   signOut: () => Promise<void> | void,
 *   devLogin?: (role: 'institution' | 'student') => void,  // dev mode only
 * }
 */
export const AuthContext = createContext(null);
