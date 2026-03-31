import { NextResponse } from 'next/server';
import { getLeads } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || null;
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  return NextResponse.json({ leads: getLeads(limit, source) });
}
