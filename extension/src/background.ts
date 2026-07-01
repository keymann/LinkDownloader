// Background (Chrome: service worker / Firefox: event page) — 오케스트레이션·판정·다운로드.
// DOM 필요 작업(DASH 파싱·세그먼트 재조합)은 dom-tasks가 Chrome=offscreen / Firefox=로컬로 라우팅.
import { api } from './env'
import { assembleTask, cancelTask, parseDashTask, revokeTask } from './dom-tasks'
import { parseHls } from './core/hls'
import { evaluate, type PolicyLookup } from './core/eligibility'
import { IneligibleError, planFromManifest, resolveHlsManifest } from './core/plan'
import { createPolicyLookup, type HostPolicyTable } from './core/policy'
import { parseRobots, type RobotsRules } from './core/robots'
import { correlate, type MseContext } from './core/correlate'
import type { AssemblePlan } from './core/remux'
import type { DownloadJob, HookMessage, MediaCandidate, ManifestModel } from './core/types'

// 탭별 후보 저장(휘발). SW 종료 대비 storage.session 백업.
const byTab = new Map<number, Map<string, MediaCandidate>>()

// 탭별 MSE 상관 컨텍스트
const mseByTab = new Map<number, MseContext>()
function mseOf(tabId: number): MseContext {
  let ctx = mseByTab.get(tabId)
  if (!ctx) {
    ctx = { active: false, appendMimes: [], mediaFetchUrls: [] }
    mseByTab.set(tabId, ctx)
  }
  return ctx
}

// 탭 종료 시 탭 스코프 상태 정리
api.tabs?.onRemoved.addListener((tabId) => {
  byTab.delete(tabId)
  mseByTab.delete(tabId)
  for (const [id, j] of jobs) if (j.tabId === tabId) jobs.delete(id)
  void api.storage.session.remove([`tab:${tabId}`, `jobs:${tabId}`])
})

// --- 준법 정책 레이어 (ToS 테이블 + robots.txt 캐시) ---
let policyTable: HostPolicyTable = {}
const robotsCache = new Map<string, RobotsRules>()
const robotsInflight = new Map<string, Promise<void>>()
const policyOf: PolicyLookup = (host) => createPolicyLookup(policyTable, robotsCache)(host)

void api.storage.local.get('policyTable').then((r) => {
  if (r.policyTable) policyTable = r.policyTable as HostPolicyTable
})
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.policyTable) policyTable = (changes.policyTable.newValue ?? {}) as HostPolicyTable
})

function hostOf(u?: string): string {
  try {
    return u ? new URL(u).host : ''
  } catch {
    return ''
  }
}

// 호스트별 robots.txt 1회 fetch·파싱·캐시(404/실패=허용). 중복 요청 방지.
async function ensureRobots(host: string): Promise<void> {
  if (!host || robotsCache.has(host)) return
  if (robotsInflight.has(host)) return robotsInflight.get(host)
  const p = (async () => {
    try {
      const res = await fetch(`https://${host}/robots.txt`)
      robotsCache.set(host, res.ok ? parseRobots(await res.text()) : { groups: [] })
    } catch {
      robotsCache.set(host, { groups: [] })
    } finally {
      robotsInflight.delete(host)
    }
  })()
  robotsInflight.set(host, p)
  return p
}

function upsert(tabId: number, c: MediaCandidate): void {
  if (!byTab.has(tabId)) byTab.set(tabId, new Map())
  const map = byTab.get(tabId)!
  const prev = map.get(c.id)
  map.set(c.id, prev ? { ...prev, ...c, signals: { ...prev.signals, ...c.signals } } : c)
  void api.storage.session.set({ [`tab:${tabId}`]: [...map.values()] })
  void api.action?.setBadgeText({ tabId, text: String(map.size) })
  void ensureRobots(hostOf(c.url ?? c.pageUrl))
}

// --- 네트워크 관찰 (관찰 전용, 차단/변조 없음) ---
api.webRequest?.onHeadersReceived.addListener(
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
api.runtime.onMessage.addListener((msg: HookMessage & { data: unknown }, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? -1
  if (tabId < 0) return
  if (msg.type === 'dom-candidates') {
    for (const c of msg.data as MediaCandidate[]) upsert(tabId, c)
  } else if (msg.type === 'eme') {
    markSignal(tabId, { eme: true })
  } else if (msg.type === 'object-url') {
    const d = msg.data as { kind?: string }
    if (d.kind === 'mediasource') mseOf(tabId).active = true
  } else if (msg.type === 'mse-sourcebuffer') {
    const d = msg.data as { mime?: string }
    const ctx = mseOf(tabId)
    ctx.active = true
    if (d.mime) ctx.appendMimes.push(d.mime)
  } else if (msg.type === 'mse-append') {
    const d = msg.data as { mime?: string }
    if (d.mime) mseOf(tabId).appendMimes.push(d.mime)
  } else if (msg.type === 'media-fetch') {
    const d = msg.data as { url?: string }
    if (d.url) mseOf(tabId).mediaFetchUrls.push(d.url)
  }
  sendResponse?.({ ok: true })
  return true
})

// popup ↔ background RPC (처리하는 메시지에만 채널을 열어둔다)
api.runtime.onMessage.addListener((msg: { rpc?: string; tabId?: number; candidateId?: string; jobId?: string }, _s, reply) => {
  if (msg?.rpc === 'list') {
    const raw = [...(byTab.get(msg.tabId!)?.values() ?? [])]
    const correlated = correlate(raw, mseByTab.get(msg.tabId!))
    reply(correlated.map((c) => ({ candidate: c, eligibility: evaluate(c, policyOf) })))
    return true
  }
  if (msg?.rpc === 'download') {
    const c = byTab.get(msg.tabId!)?.get(msg.candidateId!)
    if (c) void startDownload(c, msg.tabId!)
    reply({ ok: !!c })
    return true
  }
  if (msg?.rpc === 'jobs') {
    reply([...jobs.values()].filter((j) => j.tabId === msg.tabId))
    return true
  }
  if (msg?.rpc === 'cancel' && msg.jobId) {
    void cancelJob(msg.jobId)
    reply({ ok: true })
    return true
  }
  return false
})

// 아이콘 애셋 없이 동작하도록 1x1 투명 PNG data URI 사용(아이콘은 범위 외).
const NOTIFY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
function notify(title: string, message: string): void {
  void api.notifications?.create({ type: 'basic', iconUrl: NOTIFY_ICON, title, message })
}

// --- 진행 중 다운로드 작업(진행률 UI) ---
const jobs = new Map<string, DownloadJob>()
function setJob(job: DownloadJob): void {
  jobs.set(job.id, job)
  void api.runtime.sendMessage({ type: 'job-update', job }).catch(() => {}) // popup 실시간 갱신
  void api.storage.session.set({ [`jobs:${job.tabId}`]: [...jobs.values()].filter((j) => j.tabId === job.tabId) })
}
function patchJob(id: string, patch: Partial<DownloadJob>): void {
  const j = jobs.get(id)
  if (j) setJob(Object.assign(j, patch))
}

// (Chrome offscreen 경로) 재조합 진행률 broadcast 수신 → 작업 갱신
api.runtime.onMessage.addListener((msg: { type?: string; jobId?: string; done?: number; total?: number; bytes?: number }) => {
  if (msg?.type === 'dl-progress' && msg.jobId) {
    patchJob(msg.jobId, { phase: 'assembling', done: msg.done ?? 0, total: msg.total ?? 0, bytes: msg.bytes ?? 0 })
  }
})

// 완료 시 blob URL 해제 + 작업 상태 종료
const pendingBlob = new Map<number, string>() // downloadId → blobUrl
const downloadJob = new Map<number, string>() // downloadId → jobId
const jobDownloadId = new Map<string, number>() // jobId → downloadId
const canceledJobs = new Set<string>()
api.downloads?.onChanged.addListener((delta) => {
  const s = delta.state?.current
  if (s !== 'complete' && s !== 'interrupted') return
  const url = pendingBlob.get(delta.id)
  if (url) {
    void revokeTask(url)
    pendingBlob.delete(delta.id)
  }
  const jid = downloadJob.get(delta.id)
  if (jid) {
    const phase = canceledJobs.has(jid) ? 'canceled' : s === 'complete' ? 'done' : 'error'
    patchJob(jid, { phase, error: phase === 'error' ? '중단됨' : undefined })
    downloadJob.delete(delta.id)
    jobDownloadId.delete(jid)
    canceledJobs.delete(jid)
  }
})

// 진행 중 취소: 재조합 중이면 dom-task abort, 저장 중이면 downloads.cancel
async function cancelJob(jobId: string): Promise<void> {
  const j = jobs.get(jobId)
  if (!j || j.phase === 'done' || j.phase === 'error' || j.phase === 'canceled') return
  canceledJobs.add(jobId)
  if (j.phase === 'downloading') {
    const dlId = jobDownloadId.get(jobId)
    if (dlId != null) await api.downloads.cancel(dlId).catch(() => {})
  } else if (j.phase === 'assembling') {
    cancelTask(jobId)
  }
  patchJob(jobId, { phase: 'canceled' })
}

// 후보 → AssemblePlan (HLS master→media 해석 / DASH 파싱은 dom-task)
async function buildPlan(c: MediaCandidate): Promise<AssemblePlan> {
  if (c.kind === 'hls') {
    if (!c.url) throw new IneligibleError('NO_RESOLVABLE_SOURCE')
    return planFromManifest(await resolveHlsManifest(c.url, fetch))
  }
  if (c.kind === 'dash') {
    let m = c.manifest
    if (!m && c.url) m = await parseDashTask(await (await fetch(c.url)).text(), c.url)
    if (!m) throw new IneligibleError('NO_RESOLVABLE_SOURCE')
    return planFromManifest(m)
  }
  throw new IneligibleError('NO_RESOLVABLE_SOURCE')
}

async function startDownload(c: MediaCandidate, tabId: number): Promise<void> {
  await ensureRobots(hostOf(c.url ?? c.pageUrl))
  const verdict = evaluate(c, policyOf)
  if (verdict.verdict !== 'ELIGIBLE') {
    notify('다운로드 불가', `${verdict.verdict}: ${verdict.reason}`)
    return
  }
  const jobId = crypto.randomUUID()
  const title = safeName(c)
  const isFile = c.kind === 'file' && !!c.url
  setJob({ id: jobId, tabId, candidateId: c.id, title, phase: isFile ? 'downloading' : 'assembling', done: 0, total: 0, bytes: 0 })

  if (isFile) {
    const id = await api.downloads.download({ url: c.url!, filename: title })
    downloadJob.set(id, jobId)
    jobDownloadId.set(jobId, id)
    return
  }
  try {
    const plan = await buildPlan(c)
    // 재조합: Chrome=offscreen(진행률 broadcast) / Firefox=로컬(onProgress로 갱신)
    const res = await assembleTask(plan, jobId, (done, total, bytes) =>
      patchJob(jobId, { phase: 'assembling', done, total, bytes }),
    )
    if (res.aborted || canceledJobs.has(jobId)) {
      patchJob(jobId, { phase: 'canceled' })
      canceledJobs.delete(jobId)
      return
    }
    patchJob(jobId, { phase: 'downloading' })
    const id = await api.downloads.download({ url: res.blobUrl, filename: title })
    pendingBlob.set(id, res.blobUrl)
    downloadJob.set(id, jobId)
    jobDownloadId.set(jobId, id)
  } catch (e) {
    if (canceledJobs.has(jobId)) {
      patchJob(jobId, { phase: 'canceled' })
      canceledJobs.delete(jobId)
      return
    }
    const reason = e instanceof IneligibleError ? `INELIGIBLE: ${e.reason}` : (e as Error).message
    patchJob(jobId, { phase: 'error', error: reason })
    notify(e instanceof IneligibleError ? '다운로드 불가' : '다운로드 오류', reason)
  }
}

// --- 매니페스트 수집/파싱 ---
async function ingestManifest(tabId: number, url: string, kind: 'hls' | 'dash'): Promise<void> {
  try {
    const text = await (await fetch(url)).text()
    const manifest = kind === 'hls' ? parseHls(text, url) : await parseDashTask(text, url)
    markManifest(tabId, url, manifest)
  } catch {
    /* 파싱 실패 → 후보 유지, eligibility가 CONDITIONAL 처리 */
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
