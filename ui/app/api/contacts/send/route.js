import { NextResponse } from 'next/server';
import { requestContactSend } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 });
  return NextResponse.json(requestContactSend(id));
}
