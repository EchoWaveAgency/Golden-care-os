"use client";
import { useState } from "react";
import { useFormState } from "react-dom";
import { createUser, type CreateUserState } from "@/app/actions/users";
import { SubmitButton } from "@/components/SubmitButton";

type Opt = { value: string; label: string };
export function CreateUser({ ar, roles, branches, specialties, kinds }: { ar: boolean; roles: Opt[]; branches: Opt[]; specialties: Opt[]; kinds: Opt[] }) {
  const [state, action] = useFormState<CreateUserState, FormData>(createUser, undefined);
  const [kind, setKind] = useState("");
  if (state?.tempPassword) {
    return (
      <div className="rounded-xl border border-gold-300 bg-gold-50 p-5 text-sm">
        <p className="font-medium text-navy-700">{ar ? "تم إنشاء الحساب" : "Account created"}: <span dir="ltr">{state.email}</span></p>
        {state.error && <p role="alert" className="mt-2 rounded-lg bg-warn-50 px-3 py-2 text-warn">{state.error}</p>}
        <p className="mt-2 text-ink-500">{ar ? "كلمة المرور المؤقتة (تظهر مرة واحدة فقط — سلّمها للموظف شخصيًا، وسيُطلب منه تغييرها عند أول دخول):" : "Temporary password (shown once only — hand it over in person; they must change it at first sign-in):"}</p>
        <p className="num mt-2 select-all rounded-lg bg-white px-3 py-2 text-lg tracking-wider" dir="ltr" data-temp-password>{state.tempPassword}</p>
        <button type="button" onClick={() => window.location.reload()} className="btn-ghost mt-3">{ar ? "تم — إخفاء" : "Done — hide"}</button>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <div><label className="label" htmlFor="nu-email">{ar ? "البريد الإلكتروني للعمل" : "Work email"}</label><input id="nu-email" name="email" type="email" required dir="ltr" className="input" /></div>
      <div><label className="label" htmlFor="nu-ar">{ar ? "الاسم بالعربية" : "Name (Arabic)"}</label><input id="nu-ar" name="name_ar" required className="input" /></div>
      <div><label className="label" htmlFor="nu-en">{ar ? "الاسم بالإنجليزية" : "Name (English)"}</label><input id="nu-en" name="name_en" dir="ltr" className="input" /></div>
      <div><label className="label" htmlFor="nu-role">{ar ? "الدور" : "Role"}</label>
        <select id="nu-role" name="role" required className="input">{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
      <div><label className="label" htmlFor="nu-branch">{ar ? "الفرع" : "Branch"}</label>
        <select id="nu-branch" name="branch_id" className="input"><option value="">{ar ? "كل الفروع" : "All branches"}</option>{branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></div>
      <div><label className="label" htmlFor="nu-kind">{ar ? "نوع الموظف" : "Staff type"}</label>
        <select id="nu-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
          <option value="">{ar ? "بدون ملف موظف" : "No staff record"}</option>{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
      {kind === "doctor" && (
        <div><label className="label" htmlFor="nu-spec">{ar ? "التخصص" : "Specialty"}</label>
          <select id="nu-spec" name="specialty_id" required className="input">{specialties.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
      )}
      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger sm:col-span-3">{state.error}</p>}
      <div className="sm:col-span-3"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إنشاء الحساب" : "Create account"}</SubmitButton></div>
    </form>
  );
}
