import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import type { FounderMetrics } from "@/src/services/founder-metrics.service";

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <article className="rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm">
      <p className="text-sm font-semibold text-[var(--nia-text-muted)]">{label}</p>
      <p className="mt-3 font-serif text-4xl tracking-tight text-[var(--nia-primary)]">{value}</p>
      {detail ? <p className="mt-2 text-sm text-[var(--nia-text-muted)]">{detail}</p> : null}
    </article>
  );
}

function RegistrationGrowthChart({
  metrics,
  locale,
  copy,
}: {
  metrics: FounderMetrics;
  locale: Locale;
  copy: Dictionary["admin"];
}) {
  const points = metrics.registrationGrowth;
  const maximum = Math.max(1, ...points.map((point) => point.registrations));
  const width = 600;
  const height = 192;
  const padding = 16;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const line = points.map((point, index) => {
    const x = points.length <= 1 ? width / 2 : padding + (index / (points.length - 1)) * usableWidth;
    const y = height - padding - (point.registrations / maximum) * usableHeight;
    return `${x},${y}`;
  }).join(" ");
  const formatter = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const total = points.reduce((sum, point) => sum + point.registrations, 0);

  if (total === 0) {
    return <p className="rounded-3xl border border-dashed border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-6 text-sm text-[var(--nia-text-muted)]">{copy.noRegistrationsYet}</p>;
  }

  return (
    <figure aria-labelledby="registration-growth-title" className="rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.registrationGrowthDescription} className="h-48 w-full overflow-visible" preserveAspectRatio="none">
        <title>{copy.registrationGrowth}</title>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="var(--nia-border)" strokeWidth="1" />
        <polyline points={line} fill="none" stroke="var(--nia-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = points.length <= 1 ? width / 2 : padding + (index / (points.length - 1)) * usableWidth;
          const y = height - padding - (point.registrations / maximum) * usableHeight;
          return <circle key={point.date} cx={x} cy={y} r="3" fill="var(--nia-surface)" stroke="var(--nia-primary)" strokeWidth="2" />;
        })}
      </svg>
      <figcaption className="mt-4 flex items-center justify-between gap-4 text-xs text-[var(--nia-text-muted)]">
        <span>{formatter.format(new Date(`${points[0]!.date}T00:00:00.000Z`))}</span>
        <span>{formatter.format(new Date(`${points.at(-1)!.date}T00:00:00.000Z`))}</span>
      </figcaption>
      <ul className="sr-only">
        {points.map((point) => <li key={point.date}>{`${formatter.format(new Date(`${point.date}T00:00:00.000Z`))}: ${point.registrations}`}</li>)}
      </ul>
    </figure>
  );
}

export function FounderMetricsDashboard({ metrics, dictionary, locale }: { metrics: FounderMetrics; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.admin;
  const percentage = (value: number) => `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }).format(value)}%`;

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="user-growth-title">
        <h2 id="user-growth-title" className="font-serif text-2xl tracking-tight">{copy.userGrowth}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label={copy.registeredUsers} value={metrics.totalRegisteredUsers} />
          <MetricCard label={`${copy.newRegistrations} · ${copy.last24Hours}`} value={metrics.registrations.last24Hours} />
          <MetricCard label={`${copy.newRegistrations} · ${copy.last7Days}`} value={metrics.registrations.last7Days} />
          <MetricCard label={`${copy.newRegistrations} · ${copy.last30Days}`} value={metrics.registrations.last30Days} />
        </div>
      </section>

      <section aria-labelledby="product-adoption-title">
        <h2 id="product-adoption-title" className="font-serif text-2xl tracking-tight">{copy.productAdoption}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <MetricCard label={copy.personalSavingsUsers} value={metrics.personalSavings.users} detail={`${percentage(metrics.personalSavings.adoptionPercent)} ${copy.percentOfRegisteredUsers}`} />
          <MetricCard label={copy.susuCircleOwners} value={metrics.susu.owners} detail={`${percentage(metrics.susu.adoptionPercent)} ${copy.percentOfRegisteredUsers}`} />
        </div>
        <div className="mt-5 rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-serif text-xl tracking-tight">{copy.adoptionBreakdown}</h3>
            <p className="text-sm text-[var(--nia-text-muted)]">{`${copy.registeredUsers}: ${metrics.totalRegisteredUsers}`}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricCard label={copy.personalSavingsOnly} value={metrics.productBreakdown.personalOnly} />
            <MetricCard label={copy.susuOnly} value={metrics.productBreakdown.susuOnly} />
            <MetricCard label={copy.bothProducts} value={metrics.productBreakdown.both} />
            <MetricCard label={copy.neitherProduct} value={metrics.productBreakdown.neither} />
          </div>
        </div>
      </section>

      <section aria-labelledby="activity-title">
        <h2 id="activity-title" className="font-serif text-2xl tracking-tight">{copy.activity}</h2>
        <div className="mt-4">
          <MetricCard label={`${copy.activeProductUsers} · ${copy.last30Days}`} value={metrics.activeProductUsersLast30Days} detail={copy.productActionsDescription} />
        </div>
      </section>

      <section aria-labelledby="registration-growth-title">
        <h2 id="registration-growth-title" className="font-serif text-2xl tracking-tight">{copy.registrationGrowth}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">{copy.registrationGrowthDescription}</p>
        <div className="mt-4"><RegistrationGrowthChart metrics={metrics} locale={locale} copy={copy} /></div>
      </section>
    </div>
  );
}
