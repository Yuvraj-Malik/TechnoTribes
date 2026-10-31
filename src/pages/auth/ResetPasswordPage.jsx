// Opened from the reset link in the email. Supabase signs the user in with a
// short-lived recovery session, and they choose a new password here.
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { validateNewPassword } from '../../utils/validation';
import AuthLayout from '../../components/auth/AuthLayout';
import Field from '../../components/common/Field';
import Alert from '../../components/common/Alert';
import { primaryButton, heading, subheading, focusRing } from '../../components/common/styles';

export default function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    const found = validateNewPassword(password, confirm);
    setErrors(found);
    if (found.password) return passwordRef.current?.focus();
    if (found.confirm) return confirmRef.current?.focus();

    setBusy(true);
    setFormError('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setFormError(/same/i.test(error.message)
        ? 'Choose a password you have not used before.'
        : error.message);
      return;
    }
    setDone(true);
  }

  if (loading) {
    return <AuthLayout><p className="text-dim">Checking your reset link…</p></AuthLayout>;
  }

  if (!session) {
    return (
      <AuthLayout>
        <h1 className={heading}>This link has expired</h1>
        <p className={subheading}>Reset links work once and last one hour. Ask for a new one and try again.</p>
        <Link to="/forgot-password" className={`${primaryButton} block text-center no-underline`}>Send a new link</Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-ok text-[22px] text-white" aria-hidden="true">✓</div>
        <h1 className={heading}>Password updated</h1>
        <p className={subheading}>You are signed in with your new password.</p>
        <button type="button" className={primaryButton} onClick={() => navigate('/', { replace: true })}>
          Continue to Buildify
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className={heading}>Choose a new password</h1>
      <p className={subheading}>For {session.user.email}</p>
      <Alert tone="error">{formError}</Alert>
      <form onSubmit={onSubmit} noValidate>
        <Field
          ref={passwordRef}
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters, with a number"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Field
          ref={confirmRef}
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <button type="submit" className={`${primaryButton} mt-1.5`} disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
      <p className="mt-4 text-sm text-dim">
        Changed your mind? <Link to="/" className={`font-semibold text-accent ${focusRing}`}>Go back</Link>
      </p>
    </AuthLayout>
  );
}
