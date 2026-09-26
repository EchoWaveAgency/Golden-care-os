import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client. Used ONLY in trusted server paths (OTP sign-in, message dispatch, webhooks).
// Never imported by pages that render user data; never exposed to the browser.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
