// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for local demo seeding and E2E tests only.
import { createHmac } from "node:crypto";

function base32(s) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function totp(secret, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Brings a supabase-js client to aal2 with a temporary TOTP factor; returns a cleanup that removes it. */
export async function elevate(client, label = "seed") {
  const { data: sec } = await client.rpc("my_security");
  if (!sec?.mfa_required) return async () => {};
  const en = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `${label}-${Date.now()}` });
  if (en.error) throw new Error(`mfa enroll: ${en.error.message}`);
  const ch = await client.auth.mfa.challenge({ factorId: en.data.id });
  if (ch.error) throw new Error(`mfa challenge: ${ch.error.message}`);
  const v = await client.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: totp(en.data.totp.secret) });
  if (v.error) throw new Error(`mfa verify: ${v.error.message}`);
  return async () => { await client.auth.mfa.unenroll({ factorId: en.data.id }); };
}
