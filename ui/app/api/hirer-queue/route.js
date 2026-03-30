import { NextResponse } from 'next/server';
import { getHirerQueue } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ jobs: getHirerQueue(100) });
}
