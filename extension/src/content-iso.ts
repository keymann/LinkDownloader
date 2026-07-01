// ISOLATED world content script — docs/research/10 §5.
// (1) MAIN world 후킹 메시지를 background로 릴레이 (2) DOM 스캔/관찰.
import type { HookMessage, MediaCandidate } from './core/types'

const KEY = '__mei'

// --- (1) MAIN → background 릴레이 (메시지 위장 방지: source·매직키 검증) ---
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return
  const msg = e.data as HookMessage | undefined
  if (!msg || msg.__mei !== true) return
  chrome.runtime.sendMessage(msg)
})

// --- (2) DOM 스캔 (docs/research/01 §1.3) ---
function normalize(el: Element): MediaCandidate | null {
  const src =
    (el as HTMLMediaElement).currentSrc ||
    el.getAttribute('src') ||
    el.getAttribute('data') ||
    ''
  if (!src) return null
  const kind = /\.m3u8(\?|$)/i.test(src) ? 'hls' : /\.mpd(\?|$)/i.test(src) ? 'dash' : 'file'
  return {
    id: `dom:${src}`,
    origin: 'dom',
    kind,
    url: src.startsWith('blob:') ? undefined : src,
    pageUrl: location.href,
    poster: (el as HTMLVideoElement).poster || null,
    signals: {},
  }
}

function scan(root: ParentNode = document): MediaCandidate[] {
  const found: MediaCandidate[] = []
  root.querySelectorAll('video, audio, source, embed, object').forEach((el) => {
    const c = normalize(el)
    if (c) found.push(c)
  })
  // open shadow root 재귀
  root.querySelectorAll('*').forEach((el) => {
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
    if (sr) found.push(...scan(sr))
  })
  // same-origin iframe 재귀
  root.querySelectorAll('iframe').forEach((f) => {
    try {
      const doc = (f as HTMLIFrameElement).contentDocument
      if (doc) found.push(...scan(doc))
    } catch {
      /* cross-origin → Network 계층에 위임 */
    }
  })
  return found
}

let timer: number | undefined
function scheduleScan(): void {
  clearTimeout(timer)
  timer = self.setTimeout(() => {
    const candidates = scan()
    if (candidates.length) chrome.runtime.sendMessage({ [KEY]: true, type: 'dom-candidates', data: candidates })
  }, 80)
}

scheduleScan()
new MutationObserver(scheduleScan).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['src'],
})
