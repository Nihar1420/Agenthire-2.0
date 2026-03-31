import { NextResponse } from 'next/server';
import { getReplies } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ replies: getReplies(100) });
}
