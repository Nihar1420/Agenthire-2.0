export default function Card({ title, children, className = '' }) {
  return (
    <div className={`rounded-lg border border-border bg-surface p-4 ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold text-muted">{title}</h2> : null}
      {children}
    </div>
  );
}
