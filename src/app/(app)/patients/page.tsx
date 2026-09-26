import Link from "next/link";
import { requireAny } from "@/lib/session";
import { classifySearch } from "@/lib/normalize";
import { patientName, type PatientRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";

export const metadata = { title: "Patients" };
export const dynamic = "force-dynamic";

export default async function PatientsPage({ searchParams }: { searchParams: { q?: string } }) {
  const ctx = await requireAny("patient.read");
  const { t, locale } = ctx;
  const s = classifySearch(searchParams.q);

  let query = ctx.supabase
    .from("patients")
    .select("id, mrn, first_name_ar, last_name_ar, first_name_en, last_name_en, phone, date_of_birth, created_at")
    .is("merged_into", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (s.kind === "mrn") query = query.eq("mrn", s.value);
  if (s.kind === "phone") query = s.value.startsWith("+") ? query.eq("phone", s.value) : query.ilike("phone", `%${s.value}%`);
  if (s.kind === "name") query = query.ilike("name_search", `%${s.value}%`);
  const { data } = await query.returns<PatientRow[]>();
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title={t("nav.patients")}
        actions={ctx.can("patient.write") ? <Link href="/patients/new" className="btn-primary">{t("patient.new")}</Link> : null}
      />
      <form className="mb-5 flex gap-2">
        <input name="q" defaultValue={searchParams.q} placeholder={t("patient.searchHint")} className="input" autoFocus aria-label={t("common.search")} />
        <button className="btn-primary">{t("common.search")}</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{t("patient.mrn")}</th>
                <th className="th">{t("patient.name")}</th>
                <th className="th">{t("patient.phone")}</th>
                <th className="th">{t("patient.dob")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-ivory-50">
                  <td className="td num text-ink-500">{p.mrn}</td>
                  <td className="td"><Link href={`/patients/${p.id}`} className="font-medium text-navy-700 hover:underline">{patientName(p, locale)}</Link></td>
                  <td className="td num">{p.phone}</td>
                  <td className="td num text-ink-500">{p.date_of_birth ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
