const TONES: Record<string, string> = {
  requested: "bg-ivory-200 text-ink-500",
  booked: "bg-info-50 text-info",
  pending_confirmation: "bg-warn-50 text-warn",
  confirmed: "bg-info-50 text-info",
  arrived: "bg-teal-50 text-teal-700",
  waiting: "bg-teal-50 text-teal-700",
  in_consultation: "bg-teal-100 text-teal-900",
  procedure_in_progress: "bg-teal-100 text-teal-900",
  awaiting_payment: "bg-warn-50 text-warn",
  completed: "bg-ok-50 text-ok",
  canceled: "bg-ivory-200 text-ink-300 line-through",
  no_show: "bg-danger-50 text-danger",
  draft: "bg-ivory-200 text-ink-500",
  issued: "bg-info-50 text-info",
  partially_paid: "bg-warn-50 text-warn",
  paid: "bg-ok-50 text-ok",
  void: "bg-ivory-200 text-ink-300 line-through",
  signed: "bg-ok-50 text-ok",
  posted: "bg-ok-50 text-ok",
  reversed: "bg-ivory-200 text-ink-500",
  open: "bg-teal-50 text-teal-700",
  closed: "bg-ivory-200 text-ink-500",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[status] ?? "bg-ivory-200 text-ink-500"}`}>
      {label}
    </span>
  );
}
