import Link from "next/link";

export function PageBackLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--nia-text-muted)] transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)] ${className}`}
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
