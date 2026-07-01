// Background service worker — docs/research/10 §4·6·7. 오케스트레이션·판정·다운로드.
// 주의: MV3 SW에는 DOMParser가 없다 → DASH 파싱은 offscreen document에 위임(§ parseDashViaOffscreen).
import { parseHls } from './core/hls'
import { evaluate, type PolicyLookup } from './core/eligibility'
import type { HookMessage, MediaCandidate, ManifestModel } from './core/types'

// 탭별 후보 저장(휘발). MV3 SW 종료 대비 storage.session 백업.
const byTab = new Map<number, Map<string, MediaCandidate>>()

// TODO(준법): ToS/robots 정책 테이블을 storage.local에서 로드. 기본은 정책 없음(안전 측 판단은 eligibility가 담당).
const policyOf: PolicyLookup = () => undefined

function upsert(tabId: number, c: MediaCandidate): void {
  if (!byTab.has(tabId)) byTab.set(tabId, new Map())
  const map = byTab.get(tabId)!
  const prev = map.get(c.id)
  map.set(c.id, prev ? { ...prev, ...c, signals: { ...prev.signals, ...c.signals } } : c)
  void chrome.storage.session.set({ [`tab:${tabId}`]: [...map.values()] })
  void chrome.action.setBadgeText({ tabId, text: String(map.size) })
}

// --- 네트워크 관찰 (관찰 전용, 차단/변조 없음) ---
chrome.webRequest?.onHeadersReceived.addListener(
  (d) => {
    const ct = header(d.responseHeaders, 'content-type')
    const kind = classify(d.url, ct)
    if (!kind || d.tabId < 0) return
    upsert(d.tabId, {
      id: `net:${d.url}`,
      origin: 'network',
      kind,
      url: kind === 'file' ? d.url : undefined,
      pageUrl: '',
      headers: ct ? { 'content-type': ct } : undefined,
      signals: { acceptRanges: header(d.responseHeaders, 'accept-ranges') === 'bytes' },
    })
    if (kind === 'hls' || kind === 'dash') void ingestManifest(d.tabId, d.url, kind)
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders'],
)

// --- content(MAIN/ISO) 메시지 ---
chrome.runtime.onMessage.addListener((msg: HookMessage & { data: unknown }, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? -1
  if (tabId < 0) return
  if (msg.type === 'dom-candidates') {
    for (const c of msg.data as MediaCandidate[]) upsert(tabId, c)
  } else if (msg.type === 'eme') {
    // EME 감지 → 해당 탭 후보에 DRM 신호(보수적 전파)
    markSignal(tabId, { eme: true })
  } else if (msg.type === 'object-url' || msg.type === 'mse-append' || msg.type === 'media-fetch') {
    // 세그먼트/blob 상관용 신호 저장(스캐폴드: 로깅 수준)
  }
  sendResponse?.({ ok: true })
  return true
})

// popup ↔ background RPC (처리하는 메시지에만 채널을 열어둔다)
chrome.runtime.onMessage.addListener((msg: { rpc?: string; tabId?: number; candidateId?: string }, _s, reply) => {
  if (msg?.rpc === 'list') {
    const list = [...(byTab.get(msg.tabId!)?.values() ?? [])].map((c) => ({
      candidate: c,
      eligibility: evaluate(c, policyOf),
    }))
    reply(list)
    return true
  }
  if (msg?.rpc === 'download') {
    const c = byTab.get(msg.tabId!)?.get(msg.candidateId!)
    if (c) void startDownload(c)
    reply({ ok: !!c })
    return true
  }
  return false
})

async function startDownload(c: MediaCandidate): Promise<void> {
  const verdict = evaluate(c, policyOf)
  if (verdict.verdict !== 'ELIGIBLE') {
    void chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: '다운로드 불가',
      message: `${verdict.verdict}: ${verdict.reason}`,
    })
    return
  }
  if (c.kind === 'file' && c.url) {
    await chrome.downloads.download({ url: c.url, filename: safeName(c) })
    return
  }
  // HLS/DASH(비암호화 확정): 세그먼트 재조합은 remux 코어 사용.
  // 대용량/스트리밍은 offscreen document에서 처리 권장(§ docs 11 §5).
  void chrome.runtime.sendMessage({ rpc: 'assemble-in-offscreen', candidate: c })
}

// --- 매니페스트 수집/파싱 ---
async function ingestManifest(tabId: number, url: string, kind: 'hls' | 'dash'): Promise<void> {
  try {
    const text = await (await fetch(url)).text()
    let manifest: ManifestModel
    if (kind === 'hls') manifest = parseHls(text, url)
    else manifest = await parseDashViaOffscreen(text, url) // SW엔 DOMParser 없음
    markManifest(tabId, url, manifest)
  } catch {
    /* 파싱 실패 → 후보는 유지, eligibility가 CONDITIONAL 처리 */
  }
}

function markManifest(tabId: number, url: string, manifest: ManifestModel): void {
  const c = byTab.get(tabId)?.get(`net:${url}`)
  if (c) upsert(tabId, { ...c, manifest, signals: { ...c.signals, encrypted: manifest.hasEncryption, isLive: manifest.isLive } })
}

function markSignal(tabId: number, signals: MediaCandidate['signals']): void {
  const map = byTab.get(tabId)
  if (!map) return
  for (const c of map.values()) upsert(tabId, { ...c, signals: { ...c.signals, ...signals } })
}

// --- DASH offscreen 파싱 (MV3 SW엔 DOMParser 없음 → offscreen document에 위임) ---
const OFFSCREEN_URL = 'offscreen.html'
let creatingOffscreen: Promise<void> | null = null

async function hasOffscreen(): Promise<boolean> {
  // Chrome 116+ : 존재하는 offscreen 컨텍스트 조회
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  })
  return contexts.length > 0
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return
  // 동시 생성 경쟁 방지(한 번에 하나의 offscreen 문서만 허용됨)
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
        justification: 'DASH MPD(XML) 파싱을 위해 DOMParser 사용 (미디어 적격성 판정)',
      })
      .finally(() => {
        creatingOffscreen = null
      })
  }
  await creatingOffscreen
}

async function parseDashViaOffscreen(xml: string, base: string): Promise<ManifestModel> {
  await ensureOffscreen()
  const res = (await chrome.runtime.sendMessage({
    target: 'offscreen',
    kind: 'parse-dash',
    xml,
    base,
  })) as { ok: boolean; model?: ManifestModel; error?: string } | undefined
  if (!res?.ok || !res.model) throw new Error(res?.error || 'offscreen DASH 파싱 실패')
  return res.model
}

// --- helpers ---
function header(list: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  return list?.find((h) => h.name.toLowerCase() === name)?.value
}
function classify(url: string, ct?: string): MediaCandidate['kind'] | null {
  if (/\.m3u8(\?|$)/i.test(url) || ct?.includes('mpegurl')) return 'hls'
  if (/\.mpd(\?|$)/i.test(url) || ct?.includes('dash+xml')) return 'dash'
  if (/\.(mp4|webm|mov|m4s|ts)(\?|$)/i.test(url) || /^video\//.test(ct ?? '')) return 'file'
  return null
}
function safeName(c: MediaCandidate): string {
  const base = (c.pageUrl || c.url || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
  const ext = c.kind === 'hls' ? 'ts' : c.kind === 'dash' ? 'mp4' : (c.url?.match(/\.(\w{2,4})(\?|$)/)?.[1] ?? 'mp4')
  return `${base}.${ext}`
}
