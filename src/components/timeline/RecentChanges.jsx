// The latest approved versions.
import Badge from '../common/Badge';
import { card } from '../common/styles';

export const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function RecentChanges({ entries }) {
  if (!entries.length) {
    return <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>Approved changes will show up here.</p>;
  }
  return (
    <ol className={`${card} m-0 list-none divide-y divide-line p-0`}>
      {entries.map((entry) => (
        <li key={entry.version} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>v{entry.version}</Badge>
            <span className="text-xs text-dim">{when(entry.created_at)}</span>
          </div>
          <p className="m-0 mt-1.5 text-sm">{entry.summary}</p>
          {entry.approvedByName && <p className="m-0 text-xs text-dim">Approved by {entry.approvedByName}</p>}
        </li>
      ))}
    </ol>
  );
}
