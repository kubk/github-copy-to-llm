import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import { enhancePage } from '../src/copy-extension'

const fixturesDir = resolve(__dirname, 'fixtures')
const overrideHtml = !!process.env.OVERRIDE_HTML

async function loadDocument(fileName: string, url: string): Promise<Document> {
  const filePath = resolve(fixturesDir, fileName)
  let html: string

  if (overrideHtml || !existsSync(filePath)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    html = await res.text()
    mkdirSync(fixturesDir, { recursive: true })
    writeFileSync(filePath, html, 'utf8')
  } else {
    html = readFileSync(filePath, 'utf8')
  }

  return new JSDOM(html, { url }).window.document
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('enhancePage', () => {
  it('injects a copy button into gist headers and copies the raw content', async () => {
    const doc = await loadDocument(
      'gist-page.html',
      'https://gist.github.com/rxliuli/be31cbded41ef7eac6ae0da9070c8ef8',
    )
    const fetchText = vi.fn().mockResolvedValue('# copied from gist')
    const copyText = vi.fn().mockResolvedValue(undefined)
    const setTimer = vi.fn((callback: () => void) => {
      callback()
      return 1
    })

    const count = enhancePage(doc, { fetchText, copyText, setTimer })
    expect(count).toBe(1)

    const button = doc.querySelector<HTMLButtonElement>('[data-gh-copy-icon-target="gist"]')
    expect(button).not.toBeNull()
    expect(button?.closest('.file-actions')).not.toBeNull()

    button?.click()
    await flushMicrotasks()

    expect(fetchText).toHaveBeenCalledWith(
      'https://gist.github.com/rxliuli/be31cbded41ef7eac6ae0da9070c8ef8/raw/0020d3260882621585e696d3fa3cd07d3a8ddcd4/journey-to-optimize-cloudflare-d1-database-queries.md',
    )
    expect(copyText).toHaveBeenCalledWith('# copied from gist')
    expect(setTimer).toHaveBeenCalledOnce()
    expect(button?.getAttribute('aria-label')).toBe('Copy raw markdown')
  })

  it('injects a copy button into repository readme headers and derives the raw readme url', async () => {
    const doc = await loadDocument('github-userscripts-page.html', 'https://github.com/rxliuli/userscripts')
    const fetchText = vi.fn().mockResolvedValue('# copied from readme')
    const copyText = vi.fn().mockResolvedValue(undefined)
    const setTimer = vi.fn((callback: () => void) => {
      callback()
      return 1
    })

    const count = enhancePage(doc, { fetchText, copyText, setTimer })
    expect(count).toBe(1)

    const button = doc.querySelector<HTMLButtonElement>('[data-gh-copy-icon-target="readme"]')
    expect(button).not.toBeNull()
    expect(button?.parentElement?.querySelector('button[aria-label="Outline"]')).not.toBeNull()

    button?.click()
    await flushMicrotasks()

    expect(fetchText).toHaveBeenCalledWith('https://github.com/rxliuli/userscripts/raw/master/README.md')
    expect(copyText).toHaveBeenCalledWith('# copied from readme')
  })

  it('does not inject duplicate buttons when the scanner runs more than once', async () => {
    const doc = await loadDocument('gist-page.html', 'https://gist.github.com/rxliuli/be31cbded41ef7eac6ae0da9070c8ef8')
    const deps = {
      fetchText: vi.fn().mockResolvedValue('copy'),
      copyText: vi.fn().mockResolvedValue(undefined),
      setTimer: vi.fn(() => 1),
    }

    expect(enhancePage(doc, deps)).toBe(1)
    expect(enhancePage(doc, deps)).toBe(0)
    expect(doc.querySelectorAll('[data-gh-copy-icon-target="gist"]')).toHaveLength(1)
  })
})
