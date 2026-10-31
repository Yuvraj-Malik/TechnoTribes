// Google sign-in and email confirmation links land here with ?code=...
// supabase-js exchanges the code for a session on its own; we wait for it, then move on.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/auth/AuthLayout';
import { heading, subheading, primaryButton } from '../../components/common/styles';

export default function AuthCallbackPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const providerError = params.get('error_description');

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  if (providerError || timedOut) {
    return (
      <AuthLayout>
        <h1 className={heading}>We could not sign you in</h1>
        <p className={subheading}>{providerError || 'The sign-in link may have expired. Please try again.'}</p>
        <Link to="/login" className={`${primaryButton} block text-center no-underline`}>Back to log in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <p className="text-dim" role="status">Signing you in…</p>
    </AuthLayout>
  );
}
