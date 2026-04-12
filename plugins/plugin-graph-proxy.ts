/**
 * Vite dev-server plugin: /api/graph/* → Microsoft Graph API proxy
 *
 * Python の get_token.py を呼び出してトークンを取得し、
 * Graph API へリクエストをプロキシする。
 * トークンは 50 分間キャッシュ（有効期間 60 分）。
 */
import { execSync } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function getGraphToken(): string {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  try {
    const token = execSync("python3 scripts/get_token.py", {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    cachedToken = token;
    tokenExpiresAt = now + TOKEN_TTL_MS;
    return token;
  } catch (err) {
    console.error("[graph-proxy] Failed to get token:", err);
    throw new Error("Graph token unavailable");
  }
}

export function graphProxy(): Plugin {
  return {
    name: "graph-proxy",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/graph/")) return next();

        const graphPath = req.url.slice("/api/graph".length); // e.g. /sites/...
        const targetUrl = `${GRAPH_BASE}${graphPath}`;

        let token: string;
        try {
          token = getGraphToken();
        } catch {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Token unavailable. Run: python3 scripts/get_token.py" }));
          return;
        }

        // Read request body for POST/PATCH/PUT
        const bodyChunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
        req.on("end", async () => {
          const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;

          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          };
          if (body && body.length > 0) {
            headers["Content-Type"] = req.headers["content-type"] || "application/json";
          }

          try {
            const resp = await fetch(targetUrl, {
              method: req.method || "GET",
              headers,
              body: body && body.length > 0 ? body : undefined,
            });

            // Forward status and CORS-safe headers
            const respHeaders: Record<string, string> = {
              "Content-Type": resp.headers.get("content-type") || "application/json",
              "Access-Control-Allow-Origin": "*",
            };
            const respBody = await resp.text();
            res.writeHead(resp.status, respHeaders);
            res.end(respBody);
          } catch (fetchErr) {
            console.error("[graph-proxy] fetch error:", fetchErr);
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Graph API request failed" }));
          }
        });
      });
    },
  };
}
