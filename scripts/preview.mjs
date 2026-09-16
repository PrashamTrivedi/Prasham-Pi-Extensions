// Local-only preview server. No dependencies, directory browsing, or writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../docs/', import.meta.url);
const allowed = new Map([
  ['/', ['preview.html', 'text/html; charset=utf-8']],
  ['/preview.html', ['preview.html', 'text/html; charset=utf-8']],
  ['/preview.svg', ['preview.svg', 'image/svg+xml']],
]);
const server = createServer(async (req, res) => {
  const item = allowed.get(new URL(req.url, 'http://localhost').pathname);
  if (!item || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(new URL(item[0], root));
    res.writeHead(200, { 'Content-Type': item[1], 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Preview not found'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}`));
