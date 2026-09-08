const benefits = [
  { number: "01", title: "Save", description: "Build your savings one step at a time.", color: "bg-[#f7eee4]" },
  { number: "02", title: "Stay accountable", description: "Choose someone you trust to help you stay consistent.", color: "bg-[#e5efe5]" },
  { number: "03", title: "Build your tomorrow", description: "Watch your progress grow toward something meaningful.", color: "bg-[#f3cdbb]" },
];

export function LandingBenefits() {
  return (
    <section aria-labelledby="benefits-heading" className="border-y border-[#dfd2c1] py-8 sm:py-10">
      <h2 id="benefits-heading" className="sr-only">How NIA helps</h2>
      <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
        {benefits.map((benefit) => (
          <article key={benefit.number} className="flex gap-4">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${benefit.color} text-xs font-semibold text-[#173b32]`} aria-hidden="true">
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
