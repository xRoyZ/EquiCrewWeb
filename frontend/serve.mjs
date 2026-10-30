/* Static server of the EquiCrew website (plain node, no dependencies).
   - serves the files of this directory: "/" -> index.html, "/ueber-uns/" -> ueber-uns/index.html,
     "/ueber-uns" redirects to "/ueber-uns/" like a static host does;
   - an unknown path answers 404.html with status 404;
   - /js/config.js is generated from the API_BASE environment variable (empty = same origin);
   - only website file types are served (never this script, package.json or the tests).
   Start: node serve.mjs  (PORT, default 8080; API_BASE optional) */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL(".", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

/**
 * The body of /js/config.js for an API base URL (trailing slashes removed).
 * @param {string | undefined} apiBase
 * @returns {string}
 */
export function configScript(apiBase) {
  const value = String(apiBase ?? "")
    .trim()
    .replace(/\/+$/, "");
  return `window.EQUICREW_CONFIG = ${JSON.stringify({ apiBase: value })};\n`;
}

async function fileAt(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

function send(res, method, status, headers, body) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(method === "HEAD" ? undefined : body);
}

async function sendFile(res, method, status, path, size) {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": TYPES[extname(path).toLowerCase()],
    "Content-Length": size,
    "Cache-Control": "no-cache",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function notFound(res, method, root) {
  const page = join(root, "404.html");
  const info = await fileAt(page);
  if (info) {
    await sendFile(res, method, 404, page, info.size);
  } else {
    send(res, method, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Seite nicht gefunden\n");
  }
}

/**
 * Build the request handler.
 * @param {{root?: string, apiBase?: string}} [options]
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>}
 */
export function createHandler(options = {}) {
  const root = resolve(options.root ?? ROOT);
  const config = configScript(options.apiBase);

  return async function handle(req, res) {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      send(res, method, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method Not Allowed\n");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      await notFound(res, method, root);
      return;
    }

    if (pathname === "/js/config.js") {
      send(res, method, 200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" }, config);
      return;
    }

    const segments = pathname.split("/");
    if (pathname.includes("\0") || segments.some((s) => s.startsWith("."))) {
      await notFound(res, method, root);
      return;
    }

    const target = normalize(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) {
      await notFound(res, method, root);
      return;
    }

    if (pathname.endsWith("/")) {
      const index = join(target, "index.html");
      const info = await fileAt(index);
      if (info) {
        await sendFile(res, method, 200, index, info.size);
      } else {
        await notFound(res, method, root);
      }
      return;
    }

    const ext = extname(target).toLowerCase();
    if (ext && TYPES[ext]) {
      const info = await fileAt(target);
      if (info) {
        await sendFile(res, method, 200, target, info.size);
        return;
      }
    } else if (!ext && (await fileAt(join(target, "index.html")))) {
      const query = new URL(req.url ?? "/", "http://localhost").search;
      send(res, method, 301, { Location: `${pathname}/${query}` }, "");
      return;
    }
    await notFound(res, method, root);
  };
}

/**
 * Start the server.
 * @param {{port?: number, root?: string, apiBase?: string}} [options]
 * @returns {import("node:http").Server}
 */
export function startServer(options = {}) {
  const handler = createHandler(options);
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error("serve.mjs: request failed", error);
      if (!res.headersSent) {
        send(res, req.method ?? "GET", 500, { "Content-Type": "text/plain; charset=utf-8" }, "Internal Server Error\n");
      } else {
        res.destroy();
      }
    });
  });
  server.listen(options.port ?? 8080);
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const raw = process.env.PORT ?? "8080";
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`serve.mjs: PORT must be a port number, got "${raw}"`);
    process.exit(1);
  }
  const server = startServer({ port, apiBase: process.env.API_BASE });
  server.on("listening", () => {
    const where = process.env.API_BASE ? `API at ${process.env.API_BASE}` : "API on the same origin";
    console.log(`EquiCrew website on http://localhost:${port} (${where})`);
  });
  server.on("error", (error) => {
    console.error(`serve.mjs: cannot listen on port ${port}: ${error.message}`);
    process.exit(1);
  });
}
