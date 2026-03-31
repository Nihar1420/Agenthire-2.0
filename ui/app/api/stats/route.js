import { NextResponse } from 'next/server';
import { getDashboardStats, getBySourceCounts } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ stats: getDashboardStats(), bySource: getBySourceCounts() });
}
