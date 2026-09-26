import Image from "next/image";
import { getContext } from "@/lib/session";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-6 py-12">
      <div className="card w-full max-w-sm p-8">
        <Image src="/brand/emblem.png" alt="" width={110} height={69} className="mx-auto" />
        <h1 className="mt-6 text-xl font-semibold text-navy-700">{ar ? "اختر كلمة مرور جديدة" : "Choose a new password"}</h1>
        <p className="mb-6 mt-1 text-sm text-ink-500">{ar ? "حسابك أُنشئ بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك (12 حرفًا على الأقل، حروف وأرقام) ولا تشاركها مع أحد." : "Your account was created with a temporary password. Choose your own (at least 12 characters, letters and numbers) and never share it."}</p>
        <PasswordForm ar={ar} />
      </div>
    </main>
  );
}
