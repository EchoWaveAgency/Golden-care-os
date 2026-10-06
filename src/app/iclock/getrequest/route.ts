export const dynamic = "force-dynamic";
// Devices poll for commands; none are sent from here.
export async function GET() {
  return new Response("OK", { headers: { "Content-Type": "text/plain" } });
}
