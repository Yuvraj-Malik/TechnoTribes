// Route guards: who may see which screen.
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/apiClient';

function Loading() {
  return <div className="grid min-h-screen place-items-center text-dim" role="status">Loading…</div>;
}

// Signed-in users only.
export function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// Signed-out users only (login, signup, forgot password).
export function PublicOnly({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return children;
}

// "/" decides where to go: login, onboarding (no projects yet) or projects.
export function HomeRedirect() {
  const { session, loading } = useAuth();
  const [target, setTarget] = useState(null);

  useEffect(() => {
    if (!session) return;
    api('auth/me')
      .then((me) => setTarget(me.projects.length ? '/projects' : '/onboarding'))
      .catch(() => setTarget('/projects'));
  }, [session]);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!target) return <Loading />;
  return <Navigate to={target} replace />;
}
