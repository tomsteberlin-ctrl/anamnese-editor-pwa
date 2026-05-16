import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");
const publicDir = path.join(projectRoot, "public");
const port = Number(process.env.PORT || 4177);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

async function directoryExists(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

const root = (await directoryExists(distDir)) ? distDir : publicDir;

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("API routes run via Netlify Dev: npm run dev");
        return;
      }

      const requested = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.resolve(root, `.${requested}`);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const body = await readFile(filePath).catch(() => readFile(path.join(root, "index.html")));
      res.writeHead(200, { "Content-Type": contentTypes.get(path.extname(filePath)) || "application/octet-stream" });
      res.end(body);
    } catch (error) {
      console.error(error);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Static app running at http://127.0.0.1:${port}`);
  });
