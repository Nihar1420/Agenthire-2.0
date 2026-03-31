import { NextResponse } from 'next/server';
import { getRecentApplications } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || null;
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  return NextResponse.json({ applications: getRecentApplications(limit, offset, status) });
}
