'use client';

import { useState } from 'react';

/** Paste an email for a hirer-queue contact and send it immediately (controlled send). */
export default function PasteEmail({ contactId }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');

  async function send() {
    setState('sending');
    try {
      const res = await fetch('/api/hirer-queue/send-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contactId, email: email || undefined }),
      });
      const data = await res.json();
      setState(data.success || data.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="paste email (optional)"
        className="rounded border border-border bg-bg px-2 py-1 text-xs text-text"
      />
      <button
        onClick={send}
        disabled={state === 'sending' || state === 'done'}
        className="rounded bg-good/20 px-3 py-1 text-xs text-good hover:bg-good/30 disabled:opacity-60"
      >
        {{ idle: 'Send', sending: 'Sending…', done: 'Sent ✓', error: 'Failed' }[state]}
      </button>
    </div>
  );
}
