// "Continue with Google": hands off to Google via Supabase, then returns to /auth/callback.
import { useState } from 'react';
import { supabase, redirectTo } from '../../lib/supabaseClient';
import { focusRing } from '../common/styles';

export default function GoogleButton({ onError }) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo('/auth/callback'),
        queryParams: { prompt: 'select_account' },
      },
    });
    // On success the browser leaves this page, so we only get here on failure.
    if (error) {
      setBusy(false);
      onError?.(error.message);
    }
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={busy}
      className={`flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-[10px] border-[1.5px] border-line bg-surface p-3 text-[15px] font-semibold text-ink hover:border-dim disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="my-[18px] flex items-center gap-3 text-[13px] text-dim" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
