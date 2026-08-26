/**
 * Serves `dist/` with the SPA rewrite that §11's `vercel.json` will do in
 * production — every unknown path falls back to `index.html`, which is what
 * makes a deep link survive a refresh. Used by `npm run e2e`.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = new URL('../dist/', import.meta.url).pathname
const PORT = Number(process.env.PORT ?? 4173)

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

export function serve(port = PORT) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(ROOT, path)
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(ROOT, 'index.html') // the SPA rewrite
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve()
  console.log(`serving dist/ on http://localhost:${PORT}`)
}
