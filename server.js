// Tiny local server: static files (ES modules don't load from file://) plus saving maps.
//   node server.js  ->  http://localhost:5173
//   GET  /api/maps          list of saved map names
//   PUT  /api/maps/<file>   write maps/<file> (a .json map or its backdrop image)
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mapsDir = join(root, 'maps');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};
const port = process.env.PORT || 5173;
const MAP_FILE = /^[\w-]+\.(json|png|jpe?g|webp|gif)$/i;
const MAX_UPLOAD = 60 * 1024 * 1024;

const send = (res, code, body, type = 'text/plain') =>
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (pathname === '/api/maps' && req.method === 'GET') {
      const files = await readdir(mapsDir).catch(() => []);
      const names = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
      return send(res, 200, JSON.stringify(names), 'application/json');
    }
    if (pathname.startsWith('/api/maps/') && req.method === 'PUT') {
      const file = pathname.slice('/api/maps/'.length);
      if (!MAP_FILE.test(file)) return send(res, 400, 'bad file name');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_UPLOAD) return send(res, 413, 'too large');
        chunks.push(chunk);
      }
      await mkdir(mapsDir, { recursive: true });
      await writeFile(join(mapsDir, file), Buffer.concat(chunks));
      return send(res, 200, 'saved');
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    const path = normalize(pathname).replace(/^([/\\]|\.\.)+/, '') || 'index.html';
    send(res, 200, await readFile(join(root, path)), types[extname(path).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Hex Tactics at http://localhost:${port}`));
