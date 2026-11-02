import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(root, '..', 'web');
const { version } = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/healthz', (req, res) => res.json({ ok: true, version, commit: process.env.COMMIT || null }));

// No build step and no hashed file names, so every file is revalidated (ETag) on each load:
// an update reaches the phone on the next open instead of hiding behind a cache.
app.use(express.static(webDir, {
  etag: true,
  lastModified: true,
  setHeaders(res, file) {
    if (/\.(png|woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

const server = app.listen(PORT, HOST, () => console.log(`Chords ${version} on http://${HOST}:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
