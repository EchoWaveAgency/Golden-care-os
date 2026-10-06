import { adminClient } from "@/lib/server/admin";
import { deviceIpAllowed, parseAttlog } from "@/lib/hr-device";

export const dynamic = "force-dynamic";

// Biometric devices that speak the ZKTeco push protocol ("ADMS") send attendance here.
// Only devices registered in HR → Attendance (serial number) are accepted; optionally also limited by IP.
const plain = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

export async function GET(req: Request) {
  const sn = new URL(req.url).searchParams.get("SN") ?? "";
  if (!sn || !deviceIpAllowed(ipOf(req))) return plain("forbidden", 403);
  // Handshake: ask the device to send attendance logs only, in real time.
  return plain(`GET OPTION FROM: ${sn}\nATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\nErrorDelay=60\nDelay=30\nTransTimes=00:00;12:00\nTransInterval=1\nTransFlag=1000000000\nRealtime=1\nEncrypt=0\n`);
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  const sn = u.searchParams.get("SN") ?? "";
  if (!sn || !deviceIpAllowed(ipOf(req))) return plain("forbidden", 403);
  const body = await req.text();
  if ((u.searchParams.get("table") ?? "").toUpperCase() !== "ATTLOG") return plain("OK: 0");
  const rows = parseAttlog(body);
  if (!rows.length) return plain("OK: 0");
  const { data, error } = await adminClient().rpc("svc_device_punches", { p_serial: sn, p_rows: rows });
  if (error) return plain(error.message.includes("unknown attendance device") ? "forbidden" : "ERROR", error.message.includes("unknown attendance device") ? 403 : 500);
  return plain(`OK: ${(data as { inserted: number; duplicates: number }).inserted + (data as { duplicates: number }).duplicates}`);
}
