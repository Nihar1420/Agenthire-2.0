import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { getWriteDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Controlled send for one reviewed hirer-queue contact. An optional pasted email is written
// to the contact first, then the agent's controlled-send helper generates + sends immediately.
export async function POST(request) {
  try {
    const { id, email } = await request.json();
    if (!id) return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 });

    if (email) {
      const db = getWriteDb();
      if (db) {
        db.prepare(`UPDATE contacts SET email = ?, email_status = 'verified' WHERE id = ?`).run(email, id);
      }
    }

    if (!process.env.DB_PATH) process.env.DB_PATH = join(process.cwd(), '..', 'data', 'agent.db');
    const { sendHirerQueueContact } = await import('../../../../../src/email/hirer-send.js');
    const result = await sendHirerQueueContact(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
