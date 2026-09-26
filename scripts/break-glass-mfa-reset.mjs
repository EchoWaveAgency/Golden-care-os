// BREAK-GLASS: recover an administrator who lost their authenticator when no other administrator can.
// Run only from a trusted terminal by the system owner, with two people present. Every run is audited.
// Usage: OPERATOR="Name" REASON="detailed reason (≥10 chars)" EMAIL=admin@clinic node --env-file=.env.production scripts/break-glass-mfa-reset.mjs
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, OPERATOR, REASON, EMAIL } = process.env;
if (!url || !key || !OPERATOR || !REASON || !EMAIL) throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPERATOR, REASON and EMAIL are required");
const db = createClient(url, key, { auth: { persistSession: false } });
const { data: list, error } = await db.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const user = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) throw new Error("no such user");
const audit = await db.rpc("svc_break_glass_mfa_reset", { p_user: user.id, p_operator: OPERATOR, p_reason: REASON });
if (audit.error) throw new Error(audit.error.message);
const { data: f } = await db.auth.admin.mfa.listFactors({ userId: user.id });
for (const x of f?.factors ?? []) { const d = await db.auth.admin.mfa.deleteFactor({ id: x.id, userId: user.id }); if (d.error) throw d.error; }
const temp = randomBytes(12).toString("base64url");
const u = await db.auth.admin.updateUserById(user.id, { password: temp });
if (u.error) throw u.error;
console.log(`Factors removed and sessions ended for ${EMAIL}. One-time password (hand over in person): ${temp}`);
console.log("The user must set a new password and enroll a new authenticator at next sign-in.");
