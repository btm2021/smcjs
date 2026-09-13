// Zero-dependency static file server for trying out demo/index.html locally,
// with optional /api/klines proxy fallback for Binance Futures API.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${port}`);
  const reqPath = decodeURIComponent(parsedUrl.pathname);

  // Optional Binance API proxy fallback
  if (reqPath === "/api/klines" || reqPath === "/api/exchangeInfo") {
    try {
      const endpoint = reqPath === "/api/klines" ? "klines" : "exchangeInfo";
      const targetUrl = new URL(`https://fapi.binance.com/fapi/v1/${endpoint}`);
      for (const [key, val] of parsedUrl.searchParams.entries()) {
        targetUrl.searchParams.set(key, val);
      }
      const upstream = await fetch(targetUrl);
      const data = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": reqPath === "/api/exchangeInfo" ? "public, max-age=3600" : "public, max-age=60",
      });
      res.end(data);
      return;
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  let localPath = reqPath === "/" ? "/demo/index.html" : reqPath;
  const filePath = path.join(root, localPath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`\n🚀 SMC.js Demo Server running at http://localhost:${port}/demo/index.html`);
  console.log(`📡 Serving ${root} (Proxy available at /api/klines)\n`);
});

