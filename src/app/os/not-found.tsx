import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-5xl font-semibold text-gold-500">404</p>
      <h1 className="mt-4 text-xl font-semibold text-navy-700">غير موجود أو ليست لديك صلاحية لعرضه</h1>
      <p className="mt-1 text-sm text-ink-500" lang="en" dir="ltr">Not found, or you do not have access to it.</p>
      <Link href="/os" className="btn-primary mt-8 inline-flex">الرجوع للنظام · Back</Link>
    </div>
  );
}
