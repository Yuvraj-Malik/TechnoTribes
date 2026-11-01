// Log in, sign up and "forgot password" on one screen.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, redirectTo } from '../../lib/supabaseClient';
import { validateAuth } from '../../utils/validation';
import AuthLayout from '../../components/auth/AuthLayout';
import AuthTabs from '../../components/auth/AuthTabs';
import GoogleButton, { OrDivider } from '../../components/auth/GoogleButton';
import Field from '../../components/common/Field';
import Alert from '../../components/common/Alert';
import Collapse from '../../components/common/Collapse';
import { primaryButton, linkButton, heading, subheading } from '../../components/common/styles';

const COPY = {
  login: {
    title: 'Welcome back',
    sub: 'Log in to pick up where your team left off.',
    submit: 'Log in',
    busy: 'Logging in…',
  },
  signup: {
    title: 'Create your account',
    sub: 'Set up your space in about a minute.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  forgot: {
    title: 'Reset your password',
    sub: 'Enter your email and we will send you a link to choose a new password.',
    submit: 'Send reset link',
    busy: 'Sending…',
  },
};

// Turn Supabase's messages into plain language.
function friendly(message = '') {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match. Try again or reset your password.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first. Check your inbox for the link we sent.';
  if (/already registered/i.test(message)) return 'An account with this email already exists. Log in instead.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  return message || 'Something went wrong. Please try again.';
}

export default function AuthPage({ initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState(() => {
    try {
      if (sessionStorage.getItem('buildify:sessionEnded')) {
        sessionStorage.removeItem('buildify:sessionEnded');
        return 'Your session ended (for example, your password was changed). Please log in again.';
      }
    } catch { /* storage blocked */ }
    return '';
  });
  const [busy, setBusy] = useState(false);
  const refs = { name: useRef(null), email: useRef(null), password: useRef(null) };
  const navigate = useNavigate();
  const copy = COPY[mode];

  // Clear messages when switching between log in / sign up / forgot (not on first load,
  // so a "session ended" notice stays visible).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setErrors({});
    setFormError('');
    setNotice('');
  }, [mode]);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setFormError('');
    setNotice('');
    const found = validateAuth({ mode, ...form });
    setErrors(found);
    const first = ['name', 'email', 'password'].find((k) => found[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }

    setBusy(true);
    try {
      const email = form.email.trim();
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: form.password });
        if (error) throw error;
        navigate('/', { replace: true });
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: form.password,
          options: {
            data: { display_name: form.name.trim() },
            emailRedirectTo: redirectTo('/auth/callback'),
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate('/dashboard', { replace: true });
        } else {
          setNotice(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo('/reset-password'),
        });
        if (error) throw error;
        // Same message whether or not the account exists, so emails can't be probed.
        setNotice(`If an account exists for ${email}, a reset link is on its way. It expires in one hour.`);
      }
    } catch (err) {
      setFormError(friendly(err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout top={mode === 'forgot' ? null : <AuthTabs mode={mode} onChange={setMode} />}>
      <h1 className={heading}>{copy.title}</h1>
      <p className={subheading}>{copy.sub}</p>

      <Alert tone="error">{formError}</Alert>
      <Alert tone="success">{notice}</Alert>

      {mode !== 'forgot' && (
        <>
          <GoogleButton onError={(m) => setFormError(friendly(m))} />
          <OrDivider />
        </>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Collapse open={mode === 'signup'}>
          <Field
            ref={refs.name}
            label="Full name"
            autoComplete="name"
            placeholder="Priya Sharma"
            value={form.name}
            onChange={update('name')}
            error={errors.name}
          />
        </Collapse>
        <Field
          ref={refs.email}
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
        />
        {mode !== 'forgot' && (
          <Field
            ref={refs.password}
            label="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
            value={form.password}
            onChange={update('password')}
            error={errors.password}
          />
        )}

        <Collapse open={mode === 'login'}>
          <div className="-mt-2 mb-2 flex justify-end">
            <button type="button" className={linkButton} onClick={() => setMode('forgot')}>
              Forgot password?
            </button>
          </div>
        </Collapse>

        <button type="submit" className={`${primaryButton} mt-1.5`} disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </button>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-sm text-dim">
          {mode === 'login' && (
            <>
              <span>New to Buildify?</span>
              <button type="button" className={linkButton} onClick={() => setMode('signup')}>Create an account</button>
            </>
          )}
          {mode === 'signup' && (
            <>
              <span>Already have an account?</span>
              <button type="button" className={linkButton} onClick={() => setMode('login')}>Log in</button>
            </>
          )}
          {mode === 'forgot' && (
            <>
              <span>Remembered it?</span>
              <button type="button" className={linkButton} onClick={() => setMode('login')}>Back to log in</button>
            </>
          )}
        </div>
      </form>

      <p className="mt-[22px] border-t border-line pt-3 text-[12.5px] text-dim">
        Sign-in is handled by Supabase Auth. Buildify never sees your Google password.
      </p>
    </AuthLayout>
  );
}
