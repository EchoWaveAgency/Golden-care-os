import Link from "next/link";

// Rendered inside the site layout (header/footer), for unknown pages and records the visitor may not see.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-5xl font-semibold text-gold-500">404</p>
      <h1 className="mt-4 text-xl font-semibold text-navy-700">الصفحة غير موجودة</h1>
      <p className="mt-1 text-sm text-ink-500" lang="en" dir="ltr">This page could not be found.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/ar" className="btn-primary">الرئيسية</Link>
        <Link href="/en" className="btn-ghost">Home</Link>
      </div>
    </div>
  );
}
