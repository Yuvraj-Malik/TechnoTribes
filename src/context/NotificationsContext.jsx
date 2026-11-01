// Notifications for the signed-in user, kept live with Supabase Realtime.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { api } from '../services/apiClient';
import { useAuth } from './AuthContext';

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { notifications } = await api('notifications/list');
      setItems(Array.isArray(notifications) ? notifications : []);
    } catch {
      // keep what we have; the bell just won't update
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    reload();
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}`,
      }, (payload) => setItems((prev) => [payload.new, ...prev]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, reload]);

  const markRead = useCallback(async (ids) => {
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    try {
      await api('notifications/read', { method: 'POST', body: ids ? { ids } : { all: true } });
    } catch {
      reload();
    }
  }, [reload]);

  const value = { items, loading, unread: items.filter((n) => !n.read).length, reload, markRead };
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
}
