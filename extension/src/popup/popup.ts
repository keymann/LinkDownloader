// Popup UI (vanilla, DOM 빌더) — docs/research/10 §9.
// 판정별 그룹 + 진행 중 다운로드 실시간 진행바/취소. innerHTML 미사용(안전).
import { api } from '../env'
import type { DownloadJob, EligibilityResult, MediaCandidate } from '../core/types'

interface Row {
  candidate: MediaCandidate
  eligibility: EligibilityResult
}

const KIND_BADGE: Record<MediaCandidate['kind'], string> = { file: 'FILE', hls: 'HLS', dash: 'DASH' }
const PHASE_LABEL: Record<DownloadJob['phase'], string> = {
  assembling: '재조합 중',
  downloading: '저장 중',
  done: '완료',
  error: '실패',
  canceled: '취소됨',
}

let tabId = -1
let rows: Row[] = []
const jobs = new Map<string, DownloadJob>()

// --- 안전한 DOM 빌더(textContent 기반) ---
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (opts.class) e.className = opts.class
  if (opts.text != null) e.textContent = opts.text
  for (const c of children) if (c) e.append(c)
  return e
}

function fmtBytes(n: number): string {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}
function jobPercent(j: DownloadJob): number | null {
  if (j.phase === 'done') return 100
  if (j.phase === 'assembling' && j.total > 0) return Math.round((j.done / j.total) * 100)
  return null
}

function barNode(j: DownloadJob): HTMLElement {
  const pct = jobPercent(j)
  const fill = el('div', { class: 'fill' + (pct == null && j.phase !== 'done' ? ' indet' : '') })
  fill.style.width = `${pct ?? 100}%`
  return el('div', { class: 'bar' }, [fill])
}

function jobNode(j: DownloadJob): HTMLElement {
  const active = j.phase === 'assembling' || j.phase === 'downloading'
  const sub =
    j.phase === 'assembling'
      ? `${j.done}/${j.total} 세그먼트${j.bytes ? ` · ${fmtBytes(j.bytes)}` : ''}`
      : j.phase === 'error'
        ? j.error || '오류'
        : PHASE_LABEL[j.phase]
  const title = el('div', { class: 'title' }, [
    document.createTextNode(`${j.title} `),
    el('small', { text: `[${PHASE_LABEL[j.phase]}]` }),
  ])
  const meta = el('div', { class: 'meta' }, [title, barNode(j), el('div', { class: 'sub', text: sub })])
  meta.style.flex = '1'
  meta.style.minWidth = '0'
  const item = el('div', { class: 'item' }, [meta])
  if (active) {
    const btn = el('button', { class: 'ghost', text: '취소' })
    btn.onclick = () => void api.runtime.sendMessage({ rpc: 'cancel', tabId, jobId: j.id })
    item.append(btn)
  }
  return item
}

function candidateNode(r: Row, showBtn: boolean): HTMLElement {
  const c = r.candidate
  const title = el('div', { class: 'title' }, [
    document.createTextNode(`${c.url ?? c.pageUrl ?? '미디어'} `),
    el('small', { text: `[${KIND_BADGE[c.kind]}]` }),
  ])
  const subParts: string[] = [c.origin]
  if (c.signals.mse) subParts.push('MSE')
  if (c.note) subParts.push(c.note)
  const sub = el('div', { class: 'sub', text: subParts.join(' · ') })
  if (r.eligibility.verdict !== 'ELIGIBLE') {
    sub.append(document.createTextNode(' · '), el('span', { class: 'reason', text: r.eligibility.reason }))
  }
  const item = el('div', { class: 'item' }, [el('div', { class: 'meta' }, [title, sub])])
  if (showBtn) {
    const btn = el('button', { text: '저장' })
    btn.onclick = () => void api.runtime.sendMessage({ rpc: 'download', tabId, candidateId: c.id })
    item.append(btn)
  }
  return item
}

function groupNode(title: string, nodes: HTMLElement[]): HTMLElement | null {
  if (!nodes.length) return null
  return el('div', { class: 'group' }, [el('h4', { text: title }), ...nodes])
}

function render(): void {
  const root = document.getElementById('root')!
  root.replaceChildren()

  const jobGroup = groupNode('다운로드', [...jobs.values()].map(jobNode))
  if (jobGroup) root.append(jobGroup)

  if (!rows.length) {
    root.append(el('div', { class: 'empty', text: '이 페이지에서 발견된 미디어가 없습니다.' }))
    return
  }
  const g: Record<string, Row[]> = { ELIGIBLE: [], CONDITIONAL: [], INELIGIBLE: [], SKIP: [] }
  for (const r of rows) g[r.eligibility.verdict].push(r)
  const sections: (HTMLElement | null)[] = [
    groupNode('✅ 다운로드 가능', g.ELIGIBLE.map((r) => candidateNode(r, true))),
    groupNode('⚠️ 조건부', g.CONDITIONAL.map((r) => candidateNode(r, false))),
    groupNode('❌ 불가', g.INELIGIBLE.map((r) => candidateNode(r, false))),
    groupNode('⏭️ 정책 제외', g.SKIP.map((r) => candidateNode(r, false))),
  ]
  for (const s of sections) if (s) root.append(s)
}

async function main(): Promise<void> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id!
  const [rowsRes, jobsRes] = await Promise.all([
    api.runtime.sendMessage({ rpc: 'list', tabId }) as Promise<Row[]>,
    api.runtime.sendMessage({ rpc: 'jobs', tabId }) as Promise<DownloadJob[]>,
  ])
  rows = rowsRes ?? []
  for (const j of jobsRes ?? []) jobs.set(j.id, j)
  render()

  api.runtime.onMessage.addListener((msg: { type?: string; job?: DownloadJob }) => {
    if (msg?.type === 'job-update' && msg.job && msg.job.tabId === tabId) {
      jobs.set(msg.job.id, msg.job)
      render()
    }
  })
}

void main()
