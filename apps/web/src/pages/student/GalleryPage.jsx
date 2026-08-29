import { useCallback, useEffect, useState } from 'react';
import { CERT_STATE } from '@securecred/shared';
import { listMyCredentials, ApiError } from '../../api/client.js';
import { useAuth } from '../../auth/useAuth.js';
import { CredentialCard } from '../../components/CredentialCard.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';
import { EmptyState } from '../../components/EmptyState.jsx';

// A holder never sees a credential before it is confirmed, so pre-ACTIVE
// states are simply never shown here.
const VISIBLE_STATES = new Set([CERT_STATE.ACTIVE, CERT_STATE.REVOKING, CERT_STATE.REVOKED]);

/**
 * "Your credentials" — the entire student shell. No tabs, no side nav, no
 * sort control: most-recent-first is the only order offered.
 */
export function GalleryPage() {
  const auth = useAuth();
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyCredentials();
      const raw = Array.isArray(data) ? data : (data?.items ?? []);
      const items = raw
        .filter((item) => VISIBLE_STATES.has(item.status))
        .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
      setCredentials(items);
    } catch (err) {
      setCredentials(null);
      setError(err instanceof ApiError ? err : new ApiError('Could not load your credentials.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-24 px-12 py-32 sm:px-16 md:px-24">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Your credentials</h1>
        <p className="mt-8 text-[16px] leading-[24px] text-muted">
          Issued to {auth.email}. New credentials appear here automatically.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-12">
          <Skeleton className="h-[120px] w-full" />
          <Skeleton className="h-[120px] w-full" />
        </div>
      ) : error ? (
        <EmptyState
          title="Your credentials could not be loaded. Check your connection and try again."
          action={
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : credentials.length === 0 ? (
        <EmptyState title="No credentials have been issued to you yet." />
      ) : (
        <ul className="flex flex-col gap-16">
          {credentials.map((credential) => (
            <CredentialCard key={credential.certificateId} credential={credential} />
          ))}
        </ul>
      )}
    </main>
  );
}
