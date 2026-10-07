import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { contentType, faqToText, STATUS_FLOW, STATUS_LABEL, type Faq, type Benefit } from "@/lib/content";
import { dateTime } from "@/lib/format";
import { saveContent, transitionContent } from "@/app/actions/content";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";

export const dynamic = "force-dynamic";

function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export default async function ContentEditor({ params, searchParams }: { params: { type: string; id: string }; searchParams: { error?: string; saved?: string } }) {
  const ctx = await requireAny("content.edit", "content.medical_approve", "content.marketing_approve", "content.publish");
  const ar = ctx.locale === "ar";
  const type = contentType(params.type);
  if (!type) notFound();
  const isNew = params.id === "new";

  const [{ data: row }, { data: specialties }, { data: doctors }, { data: services }, { data: offers }, { data: revisions }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : ctx.supabase.from(type.table).select("*").eq("id", params.id).maybeSingle(),
    ctx.supabase.from("specialties").select("id, name_ar, name_en").order("sort_order"),
    ctx.supabase.from("staff").select("id, full_name_ar, full_name_en").eq("kind", "doctor").eq("is_active", true),
    ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("is_active", true).order("code"),
    ctx.supabase.from("offers").select("id, title_ar, title_en"),
    isNew ? Promise.resolve({ data: [] }) : ctx.supabase.from("content_revisions").select("id, version, status, note, created_at").eq("table_name", type.table).eq("record_id", params.id).order("id", { ascending: false }).limit(20),
  ]);
  if (!isNew && !row) notFound();
  const r = (row ?? {}) as Record<string, unknown>;
  const status = String(r.status ?? "draft");
  const canEdit = ctx.can("content.edit") && status !== "archived";
  const options = (t: string) => {
    if (t === "specialty") return (specialties ?? []).map((s) => [s.id, ar ? s.name_ar : s.name_en]);
    if (t === "staff") return (doctors ?? []).map((s) => [s.id, ar ? s.full_name_ar : s.full_name_en ?? s.full_name_ar]);
    if (t === "service") return (services ?? []).map((s) => [s.id, `${s.code} — ${ar ? s.name_ar : s.name_en}`]);
    return (offers ?? []).map((s) => [s.id, ar ? s.title_ar : s.title_en]);
  };
  const actions = (STATUS_FLOW[status] ?? []).filter((a) => ctx.can(a.perm))
    .filter((a) => !(status === "draft" && a.to === "medical_review" && r.requires_medical === false))
    .filter((a) => !(status === "draft" && a.to === "marketing_review" && r.requires_medical !== false));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={isNew ? `${ar ? "إضافة" : "New"} — ${ar ? type.ar : type.en}` : String(r[type.titleField] ?? r.slug)}
        subtitle={isNew ? undefined : `${STATUS_LABEL[status]?.[ar ? "ar" : "en"]} · v${r.version}`}
        actions={<Link href={`/os/content?type=${type.key}`} className="btn-ghost">{ctx.t("common.back")}</Link>}
      />
      <Banner error={searchParams.error} success={searchParams.saved ? (ar ? "تم الحفظ. أي تعديل على محتوى معتمد يعيده للمراجعة، والنسخة المنشورة تظل ظاهرة حتى يُنشر الإصدار الجديد." : "Saved. Edits to reviewed content restart review; the published version stays live until the new one is published.") : undefined} />

      <div className="grid gap-6 lg:grid-cols-3">
        <form action={saveContent} className="card space-y-4 p-6 lg:col-span-2">
          <input type="hidden" name="type" value={type.key} />
          {!isNew && <input type="hidden" name="id" value={String(r.id)} />}
          <fieldset disabled={!canEdit} className="space-y-4">
            {type.fields.map((f) => {
              const label = <label className="label" htmlFor={f.name}>{ar ? f.ar : f.en}{f.required && <span className="text-danger"> *</span>}</label>;
              const val = r[f.name];
              switch (f.type) {
                case "textarea": return <div key={f.name}>{label}<textarea id={f.name} name={f.name} rows={4} defaultValue={String(val ?? "")} className="input" dir={f.name.endsWith("_en") ? "ltr" : undefined} /></div>;
                case "bool": return <label key={f.name} className="flex items-center gap-2 text-sm"><input type="checkbox" name={f.name} defaultChecked={val === undefined ? f.name === "accepts_online_booking" : Boolean(val)} /> {ar ? f.ar : f.en}</label>;
                case "number": return <div key={f.name}>{label}<input id={f.name} name={f.name} type="number" step="0.01" defaultValue={val == null ? "" : String(val)} className="input num" /></div>;
                case "datetime": return <div key={f.name}>{label}<input id={f.name} name={f.name} type="datetime-local" defaultValue={toLocalInput(val)} className="input" /></div>;
                case "date": return <div key={f.name}>{label}<input id={f.name} name={f.name} type="date" defaultValue={String(val ?? "")} className="input" /></div>;
                case "specialty": case "staff": case "service": case "offer":
                  return <div key={f.name}>{label}<select id={f.name} name={f.name} defaultValue={String(val ?? "")} className="input"><option value="">—</option>{options(f.type).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>;
                case "choice": return <div key={f.name}>{label}<select id={f.name} name={f.name} defaultValue={String(val ?? f.options?.[0]?.[0] ?? "")} className="input">{(f.options ?? []).map((o) => <option key={o[0]} value={o[0]}>{ar ? o[1] : o[2]}</option>)}</select></div>;
                case "services": return (
                  <div key={f.name}>{label}<div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-ivory-200 p-2 text-sm sm:grid-cols-2">
                    {(services ?? []).map((sv) => <label key={sv.id} className="flex items-center gap-2"><input type="checkbox" name={f.name} value={sv.id} defaultChecked={((val as string[]) ?? []).includes(sv.id)} />{sv.code} — {ar ? sv.name_ar : sv.name_en}</label>)}</div></div>);
                case "patient_mrn": return <div key={f.name}>{label}<input id={f.name} name={f.name} required={f.required && isNew} placeholder={isNew ? "P-000123" : (ar ? "محفوظ — اتركه فارغًا" : "Saved — leave empty")} className="input" dir="ltr" /></div>;
                case "variant": {
                  const b = ((val as { weight?: number; title_ar?: string; title_en?: string; hero_ar?: string; hero_en?: string }[]) ?? [])[0] ?? {};
                  return (
                    <fieldset key={f.name} className="space-y-2 rounded-lg border border-ivory-200 p-3" data-variant-b>
                      <legend className="px-1 text-sm font-medium text-navy-700">{ar ? f.ar : f.en}</legend>
                      <p className="text-xs text-ink-500">{ar ? f.help_ar : f.help_en}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input name={`${f.name}_title_ar`} defaultValue={b.title_ar ?? ""} placeholder={ar ? "عنوان النسخة B (عربي)" : "Version B title (Arabic)"} className="input" />
                        <input name={`${f.name}_title_en`} defaultValue={b.title_en ?? ""} placeholder={ar ? "عنوان النسخة B (إنجليزي)" : "Version B title (English)"} className="input" dir="ltr" />
                        <textarea name={`${f.name}_hero_ar`} defaultValue={b.hero_ar ?? ""} rows={2} placeholder={ar ? "الجملة الرئيسية B (عربي)" : "Version B hero (Arabic)"} className="input" />
                        <textarea name={`${f.name}_hero_en`} defaultValue={b.hero_en ?? ""} rows={2} placeholder={ar ? "الجملة الرئيسية B (إنجليزي)" : "Version B hero (English)"} className="input" dir="ltr" />
                        <label className="text-xs">{ar ? "نسبة الزوار للنسخة B %" : "Share of visitors for B %"} <input name={`${f.name}_weight`} type="number" min="1" max="99" defaultValue={b.weight ?? 50} className="input num w-24" /></label>
                      </div>
                    </fieldset>);
                }
                case "faq": return (
                  <div key={f.name} className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label">{ar ? "الأسئلة الشائعة (عربي)" : "FAQ (Arabic)"}</label><textarea name={`${f.name}_ar`} rows={6} defaultValue={faqToText(val as Faq[], "ar")} className="input" /></div>
                    <div><label className="label">{ar ? "الأسئلة الشائعة (إنجليزي)" : "FAQ (English)"}</label><textarea name={`${f.name}_en`} rows={6} dir="ltr" defaultValue={faqToText(val as Faq[], "en")} className="input" /></div>
                    <p className="text-xs text-ink-300 sm:col-span-2">{ar ? "كل سؤال في سطر، والإجابة في الأسطر التالية، وسطر فارغ بين كل سؤال والتالي." : "Question on one line, answer below, blank line between items."}</p>
                  </div>);
                case "lines": return (
                  <div key={f.name} className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label">{ar ? f.ar : f.en} (AR)</label><textarea name={`${f.name}_ar`} rows={4} defaultValue={((val as Benefit[]) ?? []).map((b) => b.ar).join("\n")} className="input" /></div>
                    <div><label className="label">{ar ? f.ar : f.en} (EN)</label><textarea name={`${f.name}_en`} rows={4} dir="ltr" defaultValue={((val as Benefit[]) ?? []).map((b) => b.en).join("\n")} className="input" /></div>
                  </div>);
                default: return <div key={f.name}>{label}<input id={f.name} name={f.name} defaultValue={String(val ?? "")} required={f.required} className="input" dir={f.type === "slug" || f.name.endsWith("_en") || f.name.endsWith("_url") ? "ltr" : undefined} /></div>;
              }
            })}
          </fieldset>
          {canEdit && <div className="flex justify-end"><SubmitButton pendingLabel={ctx.t("common.loading")}>{ctx.t("common.save")}</SubmitButton></div>}
        </form>

        {!isNew && (
          <aside className="space-y-5">
            <div className="card p-5">
              <h2 className="mb-3 font-medium text-navy-700">{ar ? "مسار الاعتماد" : "Approval workflow"}</h2>
              <ol className="mb-4 space-y-1 text-xs">
                {["draft", "medical_review", "marketing_review", "approved", "published"].map((s) => (
                  <li key={s} className={s === status ? "font-semibold text-teal-700" : "text-ink-300"}>• {STATUS_LABEL[s][ar ? "ar" : "en"]}</li>
                ))}
              </ol>
              {r.medical_approved_at ? <p className="mb-1 text-xs text-ok">{ar ? "اعتماد طبي" : "Medical approval"}: {dateTime(String(r.medical_approved_at), ctx.locale)}</p> : null}
              {r.marketing_approved_at ? <p className="mb-3 text-xs text-ok">{ar ? "اعتماد تسويقي" : "Marketing approval"}: {dateTime(String(r.marketing_approved_at), ctx.locale)}</p> : null}
              {r.review_note ? <p className="mb-3 rounded-lg bg-warn-50 p-2 text-xs text-warn">{String(r.review_note)}</p> : null}
              <div className="space-y-2">
                {actions.map((a) => (
                  <form key={a.to} action={transitionContent} className="space-y-2">
                    <input type="hidden" name="type" value={type.key} />
                    <input type="hidden" name="id" value={String(r.id)} />
                    <input type="hidden" name="to" value={a.to} />
                    {a.needsNote && <input name="note" required className="input" placeholder={ar ? "سبب الإعادة" : "Reason"} />}
                    <SubmitButton pendingLabel="…" className={a.to === "draft" || a.to === "archived" ? "btn-ghost w-full" : "btn-primary w-full"}>{ar ? a.ar : a.en}</SubmitButton>
                  </form>
                ))}
                {actions.length === 0 && <p className="text-xs text-ink-300">{ar ? "لا توجد خطوة متاحة لدورك في هذه المرحلة." : "No step available for your role at this stage."}</p>}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-3 font-medium text-navy-700">{ar ? "سجل الإصدارات" : "Version history"}</h2>
              <ul className="space-y-2 text-xs">
                {(revisions ?? []).map((v: { id: number; version: number; status: string; note: string | null; created_at: string }) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span>v{v.version} · {STATUS_LABEL[v.status]?.[ar ? "ar" : "en"]}{v.note ? ` — ${v.note}` : ""}</span>
                    <span className="whitespace-nowrap text-ink-300">{dateTime(v.created_at, ctx.locale, { dateStyle: "short" })}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
