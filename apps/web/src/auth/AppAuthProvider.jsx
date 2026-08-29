import { ClerkProvider } from '@clerk/clerk-react';
import { DevAuthProvider } from './DevAuthProvider.jsx';
import { ClerkAuthBridge } from './ClerkAuthBridge.jsx';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Chooses real Clerk auth or the local dev-mode fallback, once, at the app root. */
export function AppAuthProvider({ children }) {
  if (CLERK_PUBLISHABLE_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        <ClerkAuthBridge>{children}</ClerkAuthBridge>
      </ClerkProvider>
    );
  }
  return <DevAuthProvider>{children}</DevAuthProvider>;
}

export const isDevAuthMode = !CLERK_PUBLISHABLE_KEY;
