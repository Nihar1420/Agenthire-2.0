import { NextResponse } from 'next/server';
import { addContact } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await request.json();
  if (!body.name && !body.email) {
    return NextResponse.json({ ok: false, error: 'name or email required' }, { status: 400 });
  }
  return NextResponse.json(addContact(body));
}
