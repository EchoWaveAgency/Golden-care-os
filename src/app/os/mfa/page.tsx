import Image from "next/image";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { signOut } from "@/app/actions/auth";
import { Challenge, Enroll } from "./MfaForms";

export const metadata = { title: "Two-factor sign-in" };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const ctx = await getContext();
  if (!ctx.needsMfa) redirect("/os");
  const ar = ctx.locale === "ar";
  const { data } = await ctx.supabase.auth.mfa.listFactors();
  const enrolled = (data?.totp ?? []).some((f) => f.status === "verified");
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-6 py-12">
      <div className="card w-full max-w-sm p-8">
        <Image src="/brand/emblem.png" alt="" width={110} height={69} className="mx-auto" />
        <h1 className="mt-6 text-xl font-semibold text-navy-700">{enrolled ? (ar ? "التحقق الثنائي" : "Two-factor sign-in") : (ar ? "فعّل التحقق الثنائي" : "Set up two-factor sign-in")}</h1>
        <p className="mb-6 mt-1 text-sm text-ink-500">{enrolled
          ? (ar ? "اكتب الرمز الحالي من تطبيق المصادقة على هاتفك." : "Enter the current code from the authenticator app on your phone.")
          : (ar ? "حسابك يملك صلاحيات حساسة، لذلك يتطلب رمزًا من هاتفك بالإضافة لكلمة المرور. لن تظهر أي بيانات قبل التفعيل." : "Your account has sensitive permissions, so it needs a code from your phone as well as your password. No data is shown until this is set up.")}</p>
        {enrolled ? <Challenge ar={ar} /> : <Enroll ar={ar} />}
        <form action={signOut} className="mt-6 text-center"><button className="text-xs text-ink-500 hover:underline">{ar ? "تسجيل الخروج" : "Sign out"}</button></form>
        {enrolled && <p className="mt-4 text-center text-xs text-ink-300">{ar ? "فقدت هاتفك؟ اطلب من مدير النظام إعادة ضبط التحقق الثنائي." : "Lost your phone? Ask the system administrator to reset two-factor sign-in."}</p>}
      </div>
    </main>
  );
}
