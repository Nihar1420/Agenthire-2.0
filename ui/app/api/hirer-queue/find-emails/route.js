import { NextResponse } from 'next/server';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

// Trigger the Apify contact-lookup pool for hirer-queue jobs. Delegates to the agent's
// backend module. Point the agent DB path at the repo root's data/ before importing.
export async function POST() {
  try {
    if (!process.env.DB_PATH) process.env.DB_PATH = join(process.cwd(), '..', 'data', 'agent.db');
    const { lookupHirerQueueContacts } = await import('../../../../../src/business/hirer-lookup.js');
    const result = await lookupHirerQueueContacts(10);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
