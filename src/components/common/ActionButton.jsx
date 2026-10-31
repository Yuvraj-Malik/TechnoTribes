// A small button for async actions: it stays disabled until the action finishes.
import { useState } from 'react';
import { outlineButton, quietButton, solidButton } from './styles';

const VARIANTS = { outline: outlineButton, quiet: quietButton, solid: solidButton };

export default function ActionButton({ onAction, variant = 'outline', children }) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onAction();
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" disabled={busy} onClick={run} className={VARIANTS[variant]}>{children}</button>;
}
