import { Feathers } from "./Feathers";

export function PageHero({ title, subtitle, eyebrow }: { title: string; subtitle?: string | null; eyebrow?: string }) {
  return (
    <section className="border-b border-navy-700/10 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
        {eyebrow && <p className="mb-3 text-[15px] font-medium text-gold-700">{eyebrow}</p>}
        <h1 className="text-4xl font-bold leading-tight text-navy-700 sm:text-5xl">{title}</h1>
        <Feathers className="mt-4 w-24" />
        {subtitle && <p className="mt-5 max-w-3xl text-lg leading-8 text-ink-500">{subtitle}</p>}
      </div>
    </section>
  );
}
