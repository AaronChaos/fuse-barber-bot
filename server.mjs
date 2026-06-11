import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITERIA = join(__dirname, 'criteria.json');
const INDEX = join(__dirname, 'gui', 'index.html');
const PORT = Number(process.env.PORT) || 3737;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function gitDeploy() {
  const opts = { cwd: __dirname };
  await exec('git', ['add', 'criteria.json'], opts);
  const status = await exec('git', ['status', '--porcelain', 'criteria.json'], opts);
  if (!status.stdout.trim()) return { committed: false, reason: 'no changes' };
  await exec('git', ['commit', '-m', 'criteria: update target window/rules'], opts);
  const sha = (await exec('git', ['rev-parse', 'HEAD'], opts)).stdout.trim();
  await exec('git', ['push'], opts);
  return { committed: true, commit: sha };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(INDEX);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/criteria') {
      const json = existsSync(CRITERIA) ? await readFile(CRITERIA, 'utf8') : '{}';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/criteria') {
      const { criteria, deploy } = await readBody(req);
      if (!criteria || typeof criteria !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing criteria' }));
        return;
      }
      await writeFile(CRITERIA, JSON.stringify(criteria, null, 2) + '\n');
      let deployInfo = null;
      if (deploy) {
        try { deployInfo = await gitDeploy(); }
        catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'git deploy failed: ' + (e.stderr || e.message) }));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...(deployInfo || {}) }));
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Fuse Barber Bot — GUI listening at ${url}`);
  try { await exec('open', [url]); } catch {}
});
