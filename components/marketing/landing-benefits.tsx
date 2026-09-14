import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function LandingBenefits({ dictionary }: { dictionary: Dictionary }) {
  const colors = ["bg-[#f7eee4]", "bg-[#e5efe5]", "bg-[#f3cdbb]"];
  return (
    <section aria-labelledby="benefits-heading" className="border-y border-[#dfd2c1] py-8 sm:py-10">
      <h2 id="benefits-heading" className="sr-only">{dictionary.landing.benefitsHeading}</h2>
      <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
        {dictionary.landing.benefits.map((benefit, index) => (
          <article key={benefit.number} className="flex gap-4">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${colors[index]} text-xs font-semibold text-[#173b32]`} aria-hidden="true">
              {benefit.number}
            </span>
            <div>
              <h3 className="font-semibold capitalize text-[#173b32]">{benefit.title}</h3>
              <p className="mt-1 text-sm leading-6 text-[#587066]">{benefit.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
