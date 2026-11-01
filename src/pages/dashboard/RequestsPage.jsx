import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { api } from '../../services/apiClient';
import Alert from '../../components/common/Alert';
import { focusRing } from '../../components/common/styles';
import { PageHeader, EmptyState, buttonSecondary } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/format';

const STATUS = {
  pending: { label: 'Waiting for review', tone: 'border-mark/60 text-ink' },
  accepted: { label: 'Accepted', tone: 'border-ok/50 text-ok' },
  rejected: { label: 'Declined', tone: 'border-err/50 text-err' },
};

export default function RequestsPage() {
  const requests = useApi('projects/my-requests');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const list = requests.data?.requests || [];

  async function cancel(id) {
    setBusyId(id);
    setError('');
    try {
      await api('projects/join-request/cancel', { method: 'POST', body: { requestId: id } });
      requests.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="My requests" description="Requests you sent to join other projects, and where they stand." />
      <Alert tone="error">{requests.error || error}</Alert>

      {requests.loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" aria-hidden="true" />
      ) : list.length === 0 ? (
        <EmptyState icon="inbox" title="No requests yet" text="Find a project you'd like to help with and ask to join.">
          <Link to="/dashboard/explore" className={buttonSecondary}>Explore projects</Link>
        </EmptyState>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-line bg-surface p-0">
          {list.map((r) => {
            const s = STATUS[r.status] || STATUS.pending;
            return (
              <li key={r.id} className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-semibold">{r.projectName || 'Project'}</p>
                  {r.message && <p className="m-0 mt-0.5 line-clamp-2 text-sm text-dim">"{r.message}"</p>}
                  <p className="m-0 mt-1 text-xs text-dim">Sent {timeAgo(r.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.tone}`}>{s.label}</span>
                  {r.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => cancel(r.id)}
                      disabled={busyId === r.id}
                      className={`min-h-11 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-dim underline hover:text-err disabled:opacity-60 ${focusRing}`}
                    >
                      {busyId === r.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
