// Minimal HS256 signer for local anon/service keys (local stack only).
const crypto = require("node:crypto");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
exports.sign = (role, secret) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iss: "supabase-local", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
