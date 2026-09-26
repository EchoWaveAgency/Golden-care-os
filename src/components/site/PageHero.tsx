import { Feathers } from "./Feathers";

export function PageHero({ title, subtitle, eyebrow }: { title: string; subtitle?: string | null; eyebrow?: string }) {
  return (
    <section className="border-b border-ivory-300/60 bg-gradient-to-b from-white to-ivory-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
        {eyebrow && <p className="mb-3 text-sm font-medium tracking-wide text-gold-700">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold text-navy-700 sm:text-4xl">{title}</h1>
        <Feathers className="mt-4 w-24" />
        {subtitle && <p className="mt-5 max-w-3xl text-base leading-8 text-ink-500">{subtitle}</p>}
      </div>
    </section>
  );
}
