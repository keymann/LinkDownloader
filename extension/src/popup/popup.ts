// Popup UI (vanilla) — docs/research/10 §9. 판정별 그룹 + 진행 중 다운로드 실시간 표시.
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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
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
  return null // downloading/indeterminate
}

function renderJobs(): string {
  const list = [...jobs.values()]
  if (!list.length) return ''
  return `<div class="group"><h4>다운로드</h4>${list
    .map((j) => {
      const pct = jobPercent(j)
      const sub =
        j.phase === 'assembling'
          ? `${j.done}/${j.total} 세그먼트${j.bytes ? ` · ${fmtBytes(j.bytes)}` : ''}`
          : j.phase === 'error'
            ? esc(j.error || '오류')
            : PHASE_LABEL[j.phase]
      const active = j.phase === 'assembling' || j.phase === 'downloading'
      return `<div class="item">
        <div class="meta" style="flex:1;min-width:0">
          <div class="title">${esc(j.title)} <small>[${PHASE_LABEL[j.phase]}]</small></div>
          <div class="bar"><div class="fill${pct == null && j.phase !== 'done' ? ' indet' : ''}" style="width:${pct ?? 100}%"></div></div>
          <div class="sub">${sub}</div>
        </div>
        ${active ? `<button class="ghost" data-cancel="${esc(j.id)}">취소</button>` : ''}
      </div>`
    })
    .join('')}</div>`
}

function renderCandidates(): string {
  if (!rows.length) return '<div class="empty">이 페이지에서 발견된 미디어가 없습니다.</div>'
  const groups: Record<string, Row[]> = { ELIGIBLE: [], CONDITIONAL: [], INELIGIBLE: [], SKIP: [] }
  for (const r of rows) groups[r.eligibility.verdict].push(r)
  const section = (title: string, list: Row[], showBtn: boolean) =>
    list.length
      ? `<div class="group"><h4>${title}</h4>${list
          .map(
            (r) => `<div class="item">
              <div class="meta">
                <div class="title">${esc(r.candidate.url ?? r.candidate.pageUrl ?? '미디어')} <small>[${KIND_BADGE[r.candidate.kind]}]</small></div>
                <div class="sub">${esc(r.candidate.origin)}${r.candidate.signals.mse ? ' · MSE' : ''}${r.candidate.note ? ` · ${esc(r.candidate.note)}` : ''}${r.eligibility.verdict !== 'ELIGIBLE' ? ` · <span class="reason">${esc(r.eligibility.reason)}</span>` : ''}</div>
              </div>
              ${showBtn ? `<button data-id="${esc(r.candidate.id)}">저장</button>` : ''}
            </div>`,
          )
          .join('')}</div>`
      : ''
  return (
    section('✅ 다운로드 가능', groups.ELIGIBLE, true) +
    section('⚠️ 조건부', groups.CONDITIONAL, false) +
    section('❌ 불가', groups.INELIGIBLE, false) +
    section('⏭️ 정책 제외', groups.SKIP, false)
  )
}

function render(): void {
  const root = document.getElementById('root')!
  root.innerHTML = renderJobs() + renderCandidates()
  root.querySelectorAll('button[data-id]').forEach((b) =>
    b.addEventListener('click', () =>
      chrome.runtime.sendMessage({ rpc: 'download', tabId, candidateId: (b as HTMLElement).dataset.id }),
    ),
  )
  root.querySelectorAll('button[data-cancel]').forEach((b) =>
    b.addEventListener('click', () =>
      chrome.runtime.sendMessage({ rpc: 'cancel', tabId, jobId: (b as HTMLElement).dataset.cancel }),
    ),
  )
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id!
  const [rowsRes, jobsRes] = await Promise.all([
    chrome.runtime.sendMessage({ rpc: 'list', tabId }) as Promise<Row[]>,
    chrome.runtime.sendMessage({ rpc: 'jobs', tabId }) as Promise<DownloadJob[]>,
  ])
  rows = rowsRes ?? []
  for (const j of jobsRes ?? []) jobs.set(j.id, j)
  render()

  // 진행률 실시간 반영
  chrome.runtime.onMessage.addListener((msg: { type?: string; job?: DownloadJob }) => {
    if (msg?.type === 'job-update' && msg.job && msg.job.tabId === tabId) {
      jobs.set(msg.job.id, msg.job)
      render()
    }
  })
}

void main()
