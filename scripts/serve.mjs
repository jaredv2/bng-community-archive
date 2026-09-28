import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import net from "node:net";

const root = path.resolve("dist");
const START_PORT = Number(process.env.PORT) || 4173;
const HOST = "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error("outside root");
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

// Walks forward from the preferred port so a stale server never blocks you.
function findPort(port, attempts = 20) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE" && attempts > 0)
        return resolve(findPort(port + 1, attempts - 1));
      reject(
        new Error(
          `No free port between ${port} and ${port + 20}. Close whatever is using them, or set PORT.`,
        ),
      );
    });
    probe.once("listening", () => probe.close(() => resolve(port)));
    probe.listen(port, HOST);
  });
}

const port = await findPort(START_PORT);
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n  Port ${port} was taken while starting. Stop that process and try again.\n`);
  } else {
    console.error(`\n  The dev server could not start: ${error.message}\n`);
  }
  process.exit(1);
});
server.listen(port, HOST, () => {
  const moved = port !== START_PORT ? ` (${START_PORT} was busy)` : "";
  console.log("");
  console.log(`  Archive running at  http://${HOST}:${port}${moved}`);
  console.log("");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
