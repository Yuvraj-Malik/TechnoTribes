import { useNotifications } from '../../context/NotificationsContext';
import { focusRing } from '../../components/common/styles';
import { PageHeader, EmptyState, buttonSecondary } from '../../components/dashboard/ui';
import { timeAgo } from '../../utils/format';

export default function NotificationsPage() {
  const { items, unread, loading, markRead } = useNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals, join requests and project updates. New ones appear here as they happen."
        actions={unread > 0 && (
          <button type="button" onClick={() => markRead()} className={buttonSecondary}>Mark all as read</button>
        )}
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" aria-hidden="true" />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="You're all caught up" text="When something needs your attention, it shows up here." />
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-line bg-surface p-0">
          {items.map((n) => (
            <li key={n.id} className={`flex gap-3.5 border-b border-line px-4 py-4 last:border-0 sm:px-5 ${n.read ? '' : 'bg-accent/[0.04]'}`}>
              <span className={`mt-2 size-2.5 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-accent'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="m-0 font-semibold">{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</p>
                {n.body && <p className="m-0 mt-0.5 text-[15px] text-dim">{n.body}</p>}
                <p className="m-0 mt-1 text-xs text-dim">{timeAgo(n.created_at)}</p>
              </div>
              {!n.read && (
                <button type="button" onClick={() => markRead([n.id])} className={`min-h-11 shrink-0 cursor-pointer self-center rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-accent ${focusRing}`}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
