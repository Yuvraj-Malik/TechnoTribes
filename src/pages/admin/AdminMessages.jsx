// What the owner has sent this admin, newest first. It only needs the project, so it
// can move into the team workspace when that lands. Each message also notifies the
// admin, and that notification is what brings new ones in live.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useProjectRealtime } from '../../hooks/useProjectRealtime';
import { api } from '../../services/apiClient';
import Alert from '../../components/common/Alert';
import Avatar from '../../components/common/Avatar';
import PageHeader from '../../components/common/PageHeader';
import PageShell from '../../components/layout/PageShell';
import { when } from '../../components/timeline/RecentChanges';
import { card, linkButton } from '../../components/common/styles';

export default function AdminMessages({ projectId, projectName }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const latest = useRef(0);

  const load = useCallback(async () => {
    const run = ++latest.current; // ignore slower, older responses
    try {
      const result = await api('messages/list', { query: { projectId } });
      if (run !== latest.current) return;
      setMessages(result.messages);
      setError('');
    } catch (err) {
      if (run === latest.current) setError(err.message);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useProjectRealtime(projectId, user.id, load);

  useEffect(() => {
    document.title = `${projectName} · Buildify`;
  }, [projectName]);

  return (
    <PageShell>
      <PageHeader title="Messages">What the owner of {projectName} has sent you.</PageHeader>
      <div className="max-w-3xl">
        {error && (
          <div className="mb-4">
            <Alert tone="error">{messages ? `This may be out of date. ${error}` : error}</Alert>
            <button type="button" className={linkButton} onClick={load}>Try again</button>
          </div>
        )}
        {messages === null && !error && <p className="text-dim" role="status">Loading…</p>}
        {messages?.length === 0 && <p className={`${card} m-0 px-4 py-6 text-center text-sm text-dim`}>Messages from the owner will show up here.</p>}
        {messages?.length > 0 && (
          <ol className="m-0 list-none space-y-2 p-0">
            {messages.map((message) => (
              <li key={message.id} className={`${card} px-4 py-3`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Avatar name={message.senderName} className="size-7" />
                  <span className="min-w-0 text-sm font-semibold break-words">{message.senderName || 'The owner'}</span>
                  <span className="text-xs text-dim">{message.to_all ? 'To all admins' : 'To you'}</span>
                  <span className="ml-auto text-xs text-dim">{when(message.created_at)}</span>
                </div>
                <p className="m-0 mt-1.5 text-sm break-words whitespace-pre-wrap">{message.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </PageShell>
  );
}
