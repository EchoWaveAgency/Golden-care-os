import { requireAny } from "@/lib/session";
import { SettlementStatement } from "@/components/SettlementStatement";

export const dynamic = "force-dynamic";
// A doctor's own statement (the database shows only their approved/paid statements).
export default async function MySettlementPage({ params }: { params: { id: string } }) {
  const ctx = await requireAny("clinical.write.own");
  return <SettlementStatement ctx={ctx} id={params.id} manage={false} />;
}
