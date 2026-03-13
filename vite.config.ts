import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixturePreviewPlugin(): any {
  return {
    name: 'fixture-preview',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/fixture/')) {
          return next()
        }

        const name = req.url.slice('/fixture/'.length)
        const filePath = resolve(__dirname, 'tests/fixtures', name)
        let html: string
        try {
          html = readFileSync(filePath, 'utf-8')
        } catch {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        const script = '<script type="module" src="/src/index.ts"></script>'
        html = html.replace('</body>', `${script}</body>`)

        server
          .transformIndexHtml(req.url, html)
          .then((transformed: string) => {
            res.setHeader('Content-Type', 'text/html')
            res.end(transformed)
          })
          .catch(next)
      })
    },
  }
}

export default defineConfig({
  server: {
    port: 50668,
  },
  plugins: [fixturePreviewPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['iife'],
      name: 'GitHubCopyIconExtension',
      fileName: () => 'content.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'node',
  },
})
