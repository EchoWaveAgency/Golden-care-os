// Decorative feather stripes echoing the falcon emblem's wings.
export function Feathers({ className = "" }: { className?: string }) {
  const colors = ["bg-gold-500", "bg-teal-700", "bg-ember", "bg-navy-700", "bg-gold-300", "bg-teal-500"];
  return (
    <div className={`flex h-1.5 overflow-hidden rounded-full ${className}`} aria-hidden="true">
      {colors.map((c, i) => <span key={i} className={`${c} flex-1`} />)}
    </div>
  );
}
