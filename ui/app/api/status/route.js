import { NextResponse } from 'next/server';
import { promisify } from 'node:util';
import { exec as execCb } from 'node:child_process';

const exec = promisify(execCb);
export const dynamic = 'force-dynamic';

// The agent is considered "running" iff the always-on processes (imap-watcher + digest)
// are online in PM2. The orchestrator is a cron process that is stopped between cycles,
// so its state is deliberately NOT used to decide running/paused.
export async function GET() {
  try {
    const { stdout } = await exec('pm2 jlist');
    const list = JSON.parse(stdout);
    const online = (name) =>
      list.some((p) => p.name === name && p.pm2_env?.status === 'online');
    const running = online('imap-watcher') && online('digest');
    return NextResponse.json({
      running,
      processes: list.map((p) => ({ name: p.name, status: p.pm2_env?.status })),
    });
  } catch (err) {
    // PM2 not present (e.g. local dev) — report unknown rather than a false "paused".
    return NextResponse.json({ running: null, error: err.message, processes: [] });
  }
}
