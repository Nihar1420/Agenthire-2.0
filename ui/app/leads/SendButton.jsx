'use client';

import { useState } from 'react';

export default function SendButton({ contactId }) {
  const [state, setState] = useState('idle'); // idle | sending | done | error

  async function send() {
    setState('sending');
    try {
      const res = await fetch('/api/contacts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contactId }),
      });
      const data = await res.json();
      setState(data.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  const label = { idle: 'Queue send', sending: 'Queuing…', done: 'Queued ✓', error: 'Failed' }[state];

  return (
    <button
      onClick={send}
      disabled={state === 'sending' || state === 'done'}
      className="rounded bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30 disabled:opacity-60"
    >
      {label}
    </button>
  );
}
