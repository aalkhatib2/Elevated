#!/usr/bin/env node
// Local-only dev server. `vercel dev` is the real workflow for local
// development (see README) but needs an interactive browser login — this is
// a stand-in for environments where that isn't possible. It serves the repo
// statically and routes /api/<name> to api/<name>.js's default export,
// adapting Node's plain (req, res) to the small subset of the Vercel Node
// helper API our handlers actually use (res.status().json(), res.setHeader,
// req.body). Never deployed — scripts/ is excluded in .vercelignore.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Self-load local secrets rather than relying on an inherited shell
// environment — however this gets launched (a plain `node` invocation, or a
// tool that spawns it fresh), it still finds DATABASE_URL etc. Never
// committed: .env.local matches .gitignore's `.env*.local`.
const envLocal = path.join(ROOT, '.env.local');
if (existsSync(envLocal)) {
  process.loadEnvFile(envLocal);
} else {
  console.warn(`[dev-server] no .env.local at ${envLocal} — relying on inherited env vars, if any.`);
}

// The harness assigns a port via $PORT when autoPort is used (see
// .claude/launch.json) — never hardcode one here.
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try { return JSON.parse(data); } catch { return {}; }
}

async function handleApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const filePath = path.join(ROOT, 'api', `${name}.js`);
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  req.body = await readBody(req);
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (obj) {
    if (!this.getHeader('Content-Type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(obj));
  };

  try {
    // Cache-bust the import so edits to api/*.js take effect without restarting.
    const mod = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
    await mod.default(req, res);
  } catch (err) {
    console.error(`[api] ${pathname} threw:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store', // dev server — never serve a stale cached copy
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Elevated dev server: http://localhost:${PORT}`);
  console.log(`Portal: http://localhost:${PORT}/prototypes/portal/login.html`);
});
