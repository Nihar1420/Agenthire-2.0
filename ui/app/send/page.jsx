'use client';

import { useState } from 'react';

export default function SendPage() {
  const [template, setTemplate] = useState('job'); // 'job' | 'business'
  const [form, setForm] = useState({ to: '', company: '', context: '' });
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState('idle');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function call(action) {
    setState(action === 'send' ? 'sending' : 'previewing');
    try {
      const res = await fetch('/api/manual-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, template, action }),
      });
      const data = await res.json();
      setPreview(data);
      setState(action === 'send' ? (data.success ? 'sent' : 'error') : 'idle');
    } catch (e) {
      setPreview({ error: e.message });
      setState('error');
    }
  }

  const input = 'w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Manual Send</h1>

      <div className="flex gap-2">
        {['job', 'business'].map((t) => (
          <button
            key={t}
            onClick={() => setTemplate(t)}
            className={`rounded-full px-3 py-1 text-sm ${template === t ? 'bg-accent/20 text-accent' : 'bg-surface text-muted'}`}
          >
            {t === 'job' ? 'Job proposal' : 'Business cold email'}
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <input className={input} placeholder="To email" value={form.to} onChange={set('to')} />
        <input className={input} placeholder="Company" value={form.company} onChange={set('company')} />
        <textarea className={input} rows={4} placeholder="Context / role / notes" value={form.context} onChange={set('context')} />
        <div className="flex gap-2">
          <button onClick={() => call('preview')} className="rounded bg-border px-4 py-1.5 text-sm hover:bg-border/70">
            Preview
          </button>
          <button
            onClick={() => call('send')}
            disabled={state === 'sending' || !form.to}
            className="rounded bg-good/20 px-4 py-1.5 text-sm text-good hover:bg-good/30 disabled:opacity-50"
          >
            {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent ✓' : 'Send'}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          {preview.error ? (
            <div className="text-bad">{preview.error}</div>
          ) : (
            <>
              <div className="mb-2 font-semibold">{preview.subject}</div>
              <pre className="whitespace-pre-wrap text-xs text-muted">{preview.body}</pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
