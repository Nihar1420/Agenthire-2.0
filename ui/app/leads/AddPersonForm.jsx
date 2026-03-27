'use client';

import { useState } from 'react';

export default function AddPersonForm() {
  const [form, setForm] = useState({ name: '', company: '', email: '', linkedin_url: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setMsg(data.ok ? 'Added.' : data.error || 'Failed.');
      if (data.ok) setForm({ name: '', company: '', email: '', linkedin_url: '' });
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'rounded border border-border bg-bg px-3 py-1.5 text-sm text-text';

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <input className={input} placeholder="Name" value={form.name} onChange={set('name')} required />
      <input className={input} placeholder="Company" value={form.company} onChange={set('company')} />
      <input className={input} placeholder="Email" value={form.email} onChange={set('email')} />
      <input className={input} placeholder="LinkedIn URL" value={form.linkedin_url} onChange={set('linkedin_url')} />
      <button disabled={busy} className="rounded bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:opacity-50">
        {busy ? 'Adding…' : 'Add person'}
      </button>
      {msg ? <span className="text-sm text-muted">{msg}</span> : null}
    </form>
  );
}
