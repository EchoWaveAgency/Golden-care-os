import { requireAny } from "@/lib/session";
import { SettlementStatement } from "@/components/SettlementStatement";

export const dynamic = "force-dynamic";
export default async function SettlementPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("settlement.prepare", "settlement.approve", "settlement.pay", "contract.manage");
  return <SettlementStatement ctx={ctx} id={params.id} error={searchParams.error} ok={searchParams.ok} manage />;
}
