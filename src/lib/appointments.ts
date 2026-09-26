// UI mirror of app.appointment_transition_allowed(). The database is authoritative;
// this only decides which buttons to show.
export const APPOINTMENT_STATUSES = [
  "requested", "booked", "pending_confirmation", "confirmed", "arrived", "waiting",
  "in_consultation", "procedure_in_progress", "awaiting_payment", "completed", "canceled", "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const NEXT_STATUS: Record<AppointmentStatus, AppointmentStatus[]> = {
  requested: ["booked", "pending_confirmation", "confirmed", "canceled"],
  booked: ["pending_confirmation", "confirmed", "arrived", "canceled", "no_show"],
  pending_confirmation: ["confirmed", "arrived", "canceled", "no_show"],
  confirmed: ["arrived", "canceled", "no_show"],
  arrived: ["waiting", "in_consultation", "canceled"],
  waiting: ["in_consultation", "canceled"],
  in_consultation: ["procedure_in_progress", "awaiting_payment", "completed"],
  procedure_in_progress: ["awaiting_payment", "completed"],
  awaiting_payment: ["completed"],
  completed: [],
  canceled: [],
  no_show: [],
};

/** Reception's primary next step for a row (one prominent button). */
export function primaryAction(s: AppointmentStatus): AppointmentStatus | null {
  const order: AppointmentStatus[] = ["arrived", "confirmed", "in_consultation", "awaiting_payment", "completed"];
  return order.find((x) => NEXT_STATUS[s].includes(x)) ?? null;
}

export function isActive(s: AppointmentStatus) {
  return s !== "canceled" && s !== "no_show";
}
