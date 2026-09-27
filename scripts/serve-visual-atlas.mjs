import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.env.SEED_ATLAS_ROOT ?? ".local/worker-pool-atlas"),
  port = Number(process.env.SEED_ATLAS_PORT ?? 4312);
http
  .createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        ).replace(/^\/+/, ""),
        file = path.resolve(root, relative || "index.html");
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const ext = path.extname(file);
      if (![".html", ".png", ".json"].includes(ext)) {
        response.writeHead(404).end();
        return;
      }
      const data = await readFile(file);
      response.setHeader(
        "Content-Type",
        ext === ".png"
          ? "image/png"
          : ext === ".json"
            ? "application/json"
            : "text/html; charset=utf-8",
      );
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  })
  .listen(port, process.env.SEED_ATLAS_HOST ?? "0.0.0.0", () =>
    console.log(`Visual atlas listening on port ${port}`),
  );
