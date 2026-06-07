// 미리보기용 초간단 정적 서버 (개발 전용)
// 사용: node preview-server.mjs <root> <port>
import http from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize } from "path";

const root = process.argv[2] || ".";
const port = Number(process.argv[3] || 5180);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

http
  .createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/admin-book-editor.html";
      const file = normalize(join(root, p));
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch (e) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + req.url);
    }
  })
  .listen(port, () => {
    console.log(`[preview] ${root} → http://localhost:${port}`);
  });
