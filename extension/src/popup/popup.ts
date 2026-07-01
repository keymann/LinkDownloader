// Popup UI (vanilla) — docs/research/10 §9. 판정별 그룹 표시, 불가 사유 노출(투명성).
import type { EligibilityResult, MediaCandidate } from '../core/types'

interface Row {
  candidate: MediaCandidate
  eligibility: EligibilityResult
}

const KIND_BADGE: Record<MediaCandidate['kind'], string> = { file: 'FILE', hls: 'HLS', dash: 'DASH' }

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab.id!
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function render(rows: Row[], tabId: number): void {
  const root = document.getElementById('root')!
  if (!rows.length) {
    root.innerHTML = '<div class="empty">이 페이지에서 발견된 미디어가 없습니다.</div>'
    return
  }
  const groups: Record<string, Row[]> = { ELIGIBLE: [], CONDITIONAL: [], INELIGIBLE: [], SKIP: [] }
  for (const r of rows) groups[r.eligibility.verdict].push(r)

  const section = (title: string, list: Row[], showBtn: boolean) =>
    list.length
      ? `<div class="group"><h4>${title}</h4>${list
          .map(
            (r) => `<div class="item">
              <div class="meta">
                <div class="title">${esc(r.candidate.url ?? r.candidate.pageUrl ?? '미디어')} <small>[${KIND_BADGE[r.candidate.kind]}]</small></div>
                <div class="sub">${esc(r.candidate.origin)}${r.eligibility.verdict !== 'ELIGIBLE' ? ` · <span class="reason">${esc(r.eligibility.reason)}</span>` : ''}</div>
              </div>
              ${showBtn ? `<button data-id="${esc(r.candidate.id)}">저장</button>` : ''}
            </div>`,
          )
          .join('')}</div>`
      : ''

  root.innerHTML =
    section('✅ 다운로드 가능', groups.ELIGIBLE, true) +
    section('⚠️ 조건부', groups.CONDITIONAL, false) +
    section('❌ 불가', groups.INELIGIBLE, false) +
    section('⏭️ 정책 제외', groups.SKIP, false)

  root.querySelectorAll('button[data-id]').forEach((b) =>
    b.addEventListener('click', () =>
      chrome.runtime.sendMessage({ rpc: 'download', tabId, candidateId: (b as HTMLElement).dataset.id }),
    ),
  )
}

async function main(): Promise<void> {
  const tabId = await activeTabId()
  const rows = (await chrome.runtime.sendMessage({ rpc: 'list', tabId })) as Row[]
  render(rows ?? [], tabId)
}

void main()
