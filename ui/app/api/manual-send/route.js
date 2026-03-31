import { NextResponse } from 'next/server';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

// Preview or send a one-off email using the agent's writers + Resend sender.
// template 'job' → writeProposal, 'business' → writeColdEmail.
export async function POST(request) {
  try {
    const { to, company, context, template, action } = await request.json();
    if (!process.env.DB_PATH) process.env.DB_PATH = join(process.cwd(), '..', 'data', 'agent.db');

    const { writeProposal, writeColdEmail } = await import('../../../../src/intelligence/writer.js');
    const copy =
      template === 'business'
        ? await writeColdEmail({ company, name: null, notes: context })
        : await writeProposal({ title: context || `role at ${company || 'your company'}`, company, description: context });

    if (action !== 'send') {
      return NextResponse.json({ subject: copy.subject, body: copy.body });
    }

    if (!to) return NextResponse.json({ success: false, error: 'missing recipient' }, { status: 400 });
    const { sendEmail } = await import('../../../../src/email/sender.js');
    const result = await sendEmail({ to, subject: copy.subject, text: copy.body });
    return NextResponse.json({ ...result, subject: copy.subject, body: copy.body });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
