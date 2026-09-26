// Single-origin gateway like Supabase's: /rest/v1 → PostgREST, /auth/v1 → Auth.
import http from "node:http";
const routes = [["/rest/v1", 3000], ["/auth/v1", 9999]];
http.createServer((req, res) => {
  const hit = routes.find(([p]) => req.url.startsWith(p));
  if (!hit) { res.writeHead(404).end(); return; }
  const [prefix, port] = hit;
  const up = http.request({ host: "127.0.0.1", port, path: req.url.slice(prefix.length) || "/", method: req.method, headers: req.headers },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  up.on("error", () => { res.writeHead(502).end(); });
  req.pipe(up);
}).listen(54321, () => console.log("gateway on :54321"));
