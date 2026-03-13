const BUTTON_ATTRIBUTE = 'data-gh-copy-icon-target'
const STYLE_ID = 'gh-copy-icon-style'
const SUCCESS_DURATION_MS = 2000

type CopyTargetKind = 'gist' | 'readme'

type CopyTarget = {
  kind: CopyTargetKind
  container: HTMLElement
  rawUrl: string
  insertBefore?: HTMLElement | null
  fallbackText: string
}

type CopyDeps = {
  fetchText: (url: string) => Promise<string>
  copyText: (text: string) => Promise<void>
  setTimer: (handler: () => void, timeout: number) => number
}

const rawCache = new Map<string, Promise<string>>()

const copyIconMarkup = `
  <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
    <path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Zm5-5C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
  </svg>
`

const successIconMarkup = `
  <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
    <path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"></path>
  </svg>
`

const defaultDeps: CopyDeps = {
  fetchText: async (url) => {
    let pending = rawCache.get(url)
    if (!pending) {
      pending = fetch(url, {
        credentials: 'omit',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch markdown from ${url}`)
        }

        return response.text()
      })
      rawCache.set(url, pending)
    }

    return pending
  },
  copyText: (text) => navigator.clipboard.writeText(text),
  setTimer: (handler, timeout) => window.setTimeout(handler, timeout),
}

export function enhancePage(doc: Document, deps: CopyDeps = defaultDeps): number {
  ensureStyles(doc)

  const targets = [findGistTarget(doc), findReadmeTarget(doc)].filter(
    (target): target is CopyTarget => target !== null,
  )

  let injected = 0
  for (const target of targets) {
    if (target.container.querySelector<HTMLElement>(`[${BUTTON_ATTRIBUTE}="${target.kind}"]`)) {
      continue
    }

    const button = createCopyButton(doc, target, deps)
    if (target.insertBefore) {
      target.container.insertBefore(button, target.insertBefore)
    } else {
      target.container.append(button)
    }
    injected += 1
  }

  return injected
}

export function initContentScript(doc: Document = document): void {
  const schedule = createScheduler(() => {
    enhancePage(doc)
  })

  schedule()
  doc.addEventListener('turbo:load', schedule)
  doc.addEventListener('pjax:end', schedule)

  const root = doc.documentElement
  if (!root) {
    return
  }

  const observer = new MutationObserver(() => {
    schedule()
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
  })
}

function createCopyButton(doc: Document, target: CopyTarget, deps: CopyDeps): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'Button--invisible Button--small Button gh-copy-icon-button'
  button.setAttribute(BUTTON_ATTRIBUTE, target.kind)
  button.setAttribute('aria-label', 'Copy raw markdown')
  button.setAttribute('title', 'Copy raw markdown')
  button.innerHTML = copyIconMarkup

  let busy = false
  button.addEventListener('click', async () => {
    if (busy) {
      return
    }

    busy = true

    try {
      let text: string
      try {
        text = await deps.fetchText(target.rawUrl)
      } catch {
        text = target.fallbackText
      }

      await deps.copyText(text)
      button.setAttribute('aria-label', 'Copied')
      button.setAttribute('title', 'Copied')
      button.innerHTML = successIconMarkup

      deps.setTimer(() => {
        button.setAttribute('aria-label', 'Copy raw markdown')
        button.setAttribute('title', 'Copy raw markdown')
        button.innerHTML = copyIconMarkup
      }, SUCCESS_DURATION_MS)
    } finally {
      busy = false
    }
  })

  return button
}

function findGistTarget(doc: Document): CopyTarget | null {
  const rawLink = doc.querySelector<HTMLAnchorElement>('.gist-content .file-actions a[href*="/raw/"]')
  const container = rawLink?.closest<HTMLElement>('.file-actions')
  const article = doc.querySelector<HTMLElement>('.gist-content article.markdown-body')

  if (!rawLink || !container || !article) {
    return null
  }

  return {
    kind: 'gist',
    container,
    rawUrl: rawLink.href,
    fallbackText: article.textContent?.trim() ?? '',
  }
}

function findReadmeTarget(doc: Document): CopyTarget | null {
  const repoPath = getRepositoryPath(doc)
  const readmeInfo = getReadmeInfo(doc)
  const nav = doc.querySelector<HTMLElement>('nav[aria-label="Repository files"]')
  const header = nav?.closest<HTMLElement>('[itemtype="https://schema.org/abstract"]')
  const article = doc.querySelector<HTMLElement>('article.markdown-body.entry-content.container-lg')
  const outlineButton = header?.querySelector<HTMLElement>('button[aria-label="Outline"]')

  if (!repoPath || !readmeInfo || !header || !article) {
    return null
  }

  return {
    kind: 'readme',
    container: header,
    insertBefore: outlineButton ?? null,
    rawUrl: buildRawUrl(doc, repoPath, readmeInfo.refName, readmeInfo.path),
    fallbackText: article.textContent?.trim() ?? '',
  }
}

function getRepositoryPath(doc: Document): string | null {
  const segments = new URL(doc.location.href).pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  return `${segments[0]}/${segments[1]}`
}

function getReadmeInfo(doc: Document): { path: string; refName: string } | null {
  const dataScript = doc.querySelector<HTMLScriptElement>('script[data-target="react-app.embeddedData"]')
  if (!dataScript?.textContent) {
    return null
  }

  try {
    const parsed = JSON.parse(dataScript.textContent) as {
      payload?: {
        codeViewRepoRoute?: {
          refInfo?: { name?: string }
          overview?: {
            overviewFiles?: Array<{
              path?: string
              preferredFileType?: string
              tabName?: string
            }>
          }
        }
      }
    }

    const refName = parsed.payload?.codeViewRepoRoute?.refInfo?.name
    const readmePath = parsed.payload?.codeViewRepoRoute?.overview?.overviewFiles?.find((file) => {
      return file.preferredFileType === 'readme' || file.tabName === 'README'
    })?.path

    if (!refName || !readmePath) {
      return null
    }

    return {
      path: readmePath,
      refName,
    }
  } catch {
    return null
  }
}

function buildRawUrl(doc: Document, repoPath: string, refName: string, filePath: string): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return new URL(`/${repoPath}/raw/${encodeURIComponent(refName)}/${encodedPath}`, doc.location.origin).toString()
}

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) {
    return
  }

  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .gh-copy-icon-button {
      padding: 7px !important;
      color: var(--fgColor-muted, var(--color-fg-muted)) !important;
    }

    .gh-copy-icon-button svg {
      display: block;
    }

  `

  doc.head.append(style)
}

function createScheduler(task: () => void): () => void {
  let queued = false

  return () => {
    if (queued) {
      return
    }

    queued = true
    queueMicrotask(() => {
      queued = false
      task()
    })
  }
}
