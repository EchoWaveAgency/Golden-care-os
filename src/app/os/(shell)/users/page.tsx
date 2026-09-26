import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { grantRole, endRole, setActive, setMfa } from "@/app/actions/users";
import { ResetMfa } from "./ResetMfa";
import { CreateUser } from "./CreateUser";

export const metadata = { title: "Users & roles" };
export const dynamic = "force-dynamic";

type U = { user_id: string; email: string; name_ar: string; name_en: string | null; is_active: boolean; must_change_password: boolean; mfa_required: boolean;
  staff: { kind: string; branch_id: string } | null;
  roles: { id: string; role: string; branch_id: string | null; valid_from: string; valid_to: string | null; reason: string | null }[] };

const KINDS: [string, string, string][] = [["doctor", "طبيب", "Doctor"], ["nurse", "تمريض", "Nurse"], ["medical_assistant", "مساعد طبي", "Medical assistant"],
  ["reception", "استقبال", "Reception"], ["patient_relations", "علاقات المرضى", "Patient relations"], ["finance", "مالية", "Finance"],
  ["management", "إدارة", "Management"], ["admin", "إداري", "Administration"], ["other", "أخرى", "Other"]];

export default async function UsersPage({ searchParams }: { searchParams: { error?: string; ok?: string; q?: string } }) {
  const ctx = await requireAny("users.manage");
  const ar = ctx.locale === "ar";
  const [{ data }, { data: roles }, { data: branches }, { data: specs }, { data: adminCount }] = await Promise.all([
    ctx.supabase.rpc("admin_users"),
    ctx.supabase.from("roles").select("code, name_ar, name_en, is_privileged").order("name_ar"),
    ctx.supabase.from("branches").select("id, name_ar, name_en").eq("is_active", true).order("code"),
    ctx.supabase.from("specialties").select("id, name_ar, name_en").order("sort_order"),
    ctx.supabase.rpc("admin_count"),
  ]);
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const users = ((data ?? []) as U[]).filter((u) => !q || `${u.email} ${u.name_ar} ${u.name_en ?? ""}`.toLowerCase().includes(q));
  const roleName = new Map((roles ?? []).map((r) => [r.code, ar ? r.name_ar : r.name_en]));
  const privileged = new Set((roles ?? []).filter((r) => r.is_privileged).map((r) => r.code));
  const branchName = new Map((branches ?? []).map((b) => [b.id, ar ? b.name_ar : b.name_en]));
  const ok = searchParams.ok ? (ar ? "تم الحفظ وتسجيله في سجل التدقيق." : "Saved and recorded in the audit trail.") : undefined;
  const self = ctx.user.id;

  return (
    <>
      <PageHeader title={ctx.t("nav.users")} subtitle={ar ? "لا يُحذف أي مستخدم أو صلاحية: الصلاحية تنتهي والحساب يُوقف، وكل تغيير مسجل مع السبب." : "Nothing is deleted: grants end and accounts are deactivated, each change recorded with its reason."} />
      <Banner error={searchParams.error} success={ok} />
      {Number(adminCount ?? 0) < 2 && (
        <p className="mb-5 rounded-lg bg-warn-50 px-4 py-3 text-sm text-warn">{ar ? "يوجد مدير نظام واحد فقط لكل الفروع. أضف مديرًا ثانيًا حتى لا يُغلق النظام إذا فقد هاتفه (البديل الوحيد هو إجراء الطوارئ الموثق في دليل التشغيل)." : "Only one all-branch administrator exists. Add a second so the system is not locked if they lose their phone (the only alternative is the documented break-glass procedure)."}</p>
      )}

      <section className="card mb-6 p-5">
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "مستخدم جديد" : "New user"}</h2>
        <CreateUser ar={ar}
          roles={(roles ?? []).map((r) => ({ value: r.code, label: `${ar ? r.name_ar : r.name_en}${r.is_privileged ? " ★" : ""}` }))}
          branches={(branches ?? []).map((b) => ({ value: b.id, label: ar ? b.name_ar : b.name_en }))}
          specialties={(specs ?? []).map((s) => ({ value: s.id, label: ar ? s.name_ar : s.name_en }))}
          kinds={KINDS.map(([v, a, e]) => ({ value: v, label: ar ? a : e }))} />
      </section>

      <form className="mb-4 flex gap-2"><input name="q" defaultValue={searchParams.q} placeholder={ar ? "بحث بالاسم أو البريد" : "Search by name or email"} className="input max-w-sm" /><button className="btn-ghost">{ctx.t("common.search")}</button></form>

      <div className="space-y-3">
        {users.map((u) => (
          <details key={u.user_id} className={`card p-5 ${u.is_active ? "" : "opacity-70"}`}>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium text-navy-700">{ar ? u.name_ar : u.name_en ?? u.name_ar}</span>
                <span className="mx-2 text-xs text-ink-300" dir="ltr">{u.email}</span>
                {!u.is_active && <span className="ms-2 rounded-full bg-danger-50 px-2 py-0.5 text-xs text-danger">{ar ? "موقوف" : "Deactivated"}</span>}
                {u.mfa_required && <span className="ms-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">{ar ? "تحقق ثنائي" : "2FA"}</span>}
                {u.must_change_password && <span className="ms-2 rounded-full bg-warn-50 px-2 py-0.5 text-xs text-warn">{ar ? "لم يغيّر كلمة المرور المؤقتة" : "Temporary password"}</span>}
              </span>
              <span className="flex flex-wrap gap-1">
                {u.roles.map((r) => <span key={r.id} className={`rounded-full px-2 py-0.5 text-xs ${privileged.has(r.role) ? "bg-gold-100 text-gold-800" : "bg-ivory-200 text-ink-500"}`}>{roleName.get(r.role) ?? r.role}</span>)}
              </span>
            </summary>
            <div className="mt-4 space-y-4 border-t border-ivory-200 pt-4">
              <ul className="space-y-2 text-sm">
                {u.roles.length === 0 && <li className="text-ink-300">{ar ? "لا توجد صلاحيات فعالة." : "No active roles."}</li>}
                {u.roles.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ivory-50 px-3 py-2">
                    <span><span className="font-medium">{roleName.get(r.role) ?? r.role}</span> · {r.branch_id ? branchName.get(r.branch_id) : (ar ? "كل الفروع" : "All branches")}
                      <span className="block text-xs text-ink-500">{ar ? "من" : "from"} {dateTime(r.valid_from, ctx.locale, { timeStyle: undefined })}{r.valid_to ? ` ${ar ? "حتى" : "until"} ${dateTime(r.valid_to, ctx.locale, { timeStyle: undefined })}` : ""}{r.reason ? ` · ${r.reason}` : ""}</span></span>
                    {u.user_id !== self && (
                      <form action={endRole} className="flex items-center gap-2">
                        <input type="hidden" name="grant_id" value={r.id} />
                        <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input w-40 py-1" />
                        <SubmitButton pendingLabel="…" className="btn-danger text-xs">{ar ? "إنهاء" : "End"}</SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              {u.user_id !== self && (
                <>
                  <form key={`grant-${u.user_id}-${u.roles.length}`} action={grantRole} className="grid gap-2 sm:grid-cols-5">
                    <input type="hidden" name="user_id" value={u.user_id} />
                    <select name="role" className="input" aria-label={ar ? "الدور" : "Role"}>{(roles ?? []).map((r) => <option key={r.code} value={r.code}>{ar ? r.name_ar : r.name_en}</option>)}</select>
                    <select name="branch_id" className="input" aria-label={ar ? "الفرع" : "Branch"}><option value="">{ar ? "كل الفروع" : "All branches"}</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{ar ? b.name_ar : b.name_en}</option>)}</select>
                    <input name="valid_to" type="date" className="input" aria-label={ar ? "حتى (اختياري — للتفويض المؤقت)" : "Until (optional — temporary delegation)"} title={ar ? "حتى (اختياري — للتفويض المؤقت)" : "Until (optional — temporary delegation)"} />
                    <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input" />
                    <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "منح الدور" : "Grant role"}</SubmitButton>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <form key={`mfa-${u.user_id}-${u.mfa_required}`} action={setMfa} className="flex items-center gap-2">
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <input type="hidden" name="required" value={u.mfa_required ? "false" : "true"} />
                      <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input w-40 py-1" />
                      <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{u.mfa_required ? (ar ? "إلغاء إلزام التحقق الثنائي" : "Stop requiring 2FA") : (ar ? "إلزام التحقق الثنائي" : "Require 2FA")}</SubmitButton>
                    </form>
                    {u.mfa_required && <ResetMfa userId={u.user_id} ar={ar} />}
                  </div>
                  <form key={`act-${u.user_id}-${u.is_active}`} action={setActive} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="user_id" value={u.user_id} />
                    <input type="hidden" name="active" value={u.is_active ? "false" : "true"} />
                    <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input max-w-xs" />
                    <SubmitButton pendingLabel="…" className={u.is_active ? "btn-danger" : "btn-primary"}>{u.is_active ? (ar ? "إيقاف الحساب" : "Deactivate") : (ar ? "إعادة التفعيل" : "Reactivate")}</SubmitButton>
                  </form>
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
