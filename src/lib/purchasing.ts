export const PO_STATUS: Record<string, [string, string, string]> = {
  draft: ["مسودة", "Draft", "draft"], submitted: ["بانتظار الاعتماد", "Awaiting approval", "pending_confirmation"],
  approved: ["معتمد — بانتظار الاستلام", "Approved — to receive", "confirmed"], partially_received: ["استلام جزئي", "Partly received", "partially_paid"],
  received: ["تم الاستلام", "Received", "completed"], cancelled: ["ملغي", "Cancelled", "canceled"],
};
