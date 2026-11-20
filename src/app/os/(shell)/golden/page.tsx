import { redirect } from "next/navigation";

// Old address (Golden Friday period) → the permanent campaigns & call-center control page.
export default function OldGolden() { redirect("/os/campaigns"); }
