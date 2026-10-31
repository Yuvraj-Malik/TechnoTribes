// Calls onChange when anything the dashboard shows changes in Supabase.
// Several changes close together trigger one refresh.
import { useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const PROJECT_TABLES = ['agents', 'intents', 'merge_requests', 'review_buckets', 'moderator_log', 'observer_requests', 'tasks', 'proposals', 'project_state'];

export function useProjectRealtime(projectId, userId, onChange) {
  useEffect(() => {
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    };

    const channel = supabase.channel(`project:${projectId}`);
    for (const table of PROJECT_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `project_id=eq.${projectId}` }, bump);
    }
    // New admins and join requests are not realtime tables, but they notify the owner.
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, bump);
    channel.subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [projectId, userId, onChange]);
}
