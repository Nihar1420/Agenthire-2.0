'use client';

import { useState } from 'react';

export default function HirerQueueClient() {
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);

  async function findEmails() {
    setState('working');
    try {
      const res = await fetch('/api/hirer-queue/find-emails', { method: 'POST' });
      setResult(await res.json());
      setState('done');
    } catch (e) {
      setResult({ error: e.message });
      setState('error');
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={findEmails}
        disabled={state === 'working'}
        className="rounded bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:opacity-50"
      >
        {state === 'working' ? 'Looking up contacts…' : 'Find contacts (Apify)'}
      </button>
      {result ? (
        <span className="text-sm text-muted">
          {result.error ? `Error: ${result.error}` : `Found ${result.found ?? 0}, missed ${result.notFound ?? 0}`}
        </span>
      ) : null}
    </div>
  );
}
