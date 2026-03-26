import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/applications', label: 'Applications' },
  { href: '/leads', label: 'Leads' },
  { href: '/linkedin', label: 'LinkedIn' },
  { href: '/replies', label: 'Replies' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/hirer-queue', label: 'Hirer Queue' },
  { href: '/send', label: 'Send' },
  { href: '/settings', label: 'Settings' },
];

export default function Nav() {
  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
        <span className="mr-4 font-semibold text-accent">AgentHire</span>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded px-3 py-1.5 text-sm text-muted hover:bg-border hover:text-text"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
