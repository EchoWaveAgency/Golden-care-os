import type { Lang } from "@/lib/site/api";
import { LEGAL } from "@/lib/site/legal";
import { PageHero } from "./PageHero";

export function LegalPage({ lang, doc }: { lang: Lang; doc: keyof typeof LEGAL }) {
  const d = LEGAL[doc][lang];
  return (
    <>
      <PageHero title={d.title} />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
        {d.sections.map(([h, p]) => (
          <section key={h}>
            <h2 className="mb-2 text-lg font-semibold text-navy-700">{h}</h2>
            <p className="leading-8 text-ink-500">{p}</p>
          </section>
        ))}
      </div>
    </>
  );
}
