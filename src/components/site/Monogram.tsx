export function Monogram({ name, size = "h-20 w-20 text-2xl" }: { name: string; size?: string }) {
  const letters = name.replace(/^(د\.|dr\.?)\s*/i, "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  return (
    <div className={`${size} grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-ivory-50 to-ivory-200 font-semibold text-gold-700 ring-2 ring-gold-300 ring-offset-2 ring-offset-white`}>
      {letters}
    </div>
  );
}
