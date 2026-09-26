import Link from "next/link";

export function Stat({ label, value, href, tone = "navy" }: { label: string; value: string | number; href?: string; tone?: "navy" | "teal" | "gold" | "danger" }) {
  const colors = { navy: "text-navy-700", teal: "text-teal-700", gold: "text-gold-700", danger: "text-danger" }[tone];
  const body = (
    <div className="card h-full p-4 transition hover:border-gold-300">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`num mt-2 text-2xl font-semibold ${colors}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
