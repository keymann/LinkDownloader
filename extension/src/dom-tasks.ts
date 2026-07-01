// DOM 태스크 디스패치 — DASH 파싱과 세그먼트 재조합을 실행 위치에 맞게 라우팅.
// - Chrome(service worker, DOM 없음) → offscreen document에 위임
// - Firefox(event page, DOM 있음) → background에서 직접 실행
// docs/research/10 §6·10, 05.
import { api, HAS_DOM, HAS_OFFSCREEN } from './env'
import { assembleToBlobUrl, revokeBlobUrl } from './assemble-store'
import { parseDash } from './core/dash'
import type { AssemblePlan } from './core/remux'
import type { ManifestModel } from './core/types'

type Progress = (done: number, total: number, bytes: number) => void

// Firefox 로컬 경로에서 jobId별 중단 컨트롤러
const localAborts = new Map<string, AbortController>()

// ---- offscreen 관리(Chrome) ----
const OFFSCREEN_URL = 'offscreen.html'
let creating: Promise<void> | null = null
async function ensureOffscreen(): Promise<void> {
  const has = await api.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [api.runtime.getURL(OFFSCREEN_URL)],
  })
  if (has.length) return
  if (!creating) {
    creating = api.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER' as chrome.offscreen.Reason, 'BLOBS' as chrome.offscreen.Reason],
        justification: 'DASH(XML) 파싱 및 세그먼트 재조합(Blob/OPFS)',
      })
      .finally(() => {
        creating = null
      })
  }
  await creating
}

// ---- DASH 파싱 ----
export async function parseDashTask(xml: string, base: string): Promise<ManifestModel> {
  if (HAS_DOM) return parseDash(xml, base) // Firefox: 직접
  if (!HAS_OFFSCREEN) throw new Error('DASH 파싱 불가: DOM/offscreen 미지원 환경')
  await ensureOffscreen()
  const res = (await api.runtime.sendMessage({ target: 'offscreen', kind: 'parse-dash', xml, base })) as
    | { ok: boolean; model?: ManifestModel; error?: string }
    | undefined
  if (!res?.ok || !res.model) throw new Error(res?.error || 'offscreen DASH 파싱 실패')
  return res.model
}

// ---- 재조합(진행률 emit은 호출부에서 onProgress로 처리) ----
export async function assembleTask(
  plan: AssemblePlan,
  jobId: string,
  onProgress: Progress,
): Promise<{ blobUrl: string; size: number; aborted?: boolean }> {
  if (HAS_DOM) {
    const ac = new AbortController()
    localAborts.set(jobId, ac)
    try {
      return await assembleToBlobUrl(plan, { onProgress, signal: ac.signal })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { blobUrl: '', size: 0, aborted: true }
      throw e
    } finally {
      localAborts.delete(jobId)
    }
  }
  // Chrome: offscreen이 진행률을 'dl-progress'로 broadcast → 호출부가 별도 수신하므로 여기선 결과만.
  await ensureOffscreen()
  const res = (await api.runtime.sendMessage({ target: 'offscreen', kind: 'assemble', plan, jobId })) as
    | { ok: boolean; blobUrl?: string; size?: number; error?: string; aborted?: boolean }
    | undefined
  if (res?.aborted) return { blobUrl: '', size: 0, aborted: true }
  if (!res?.ok || !res.blobUrl) throw new Error(res?.error || '세그먼트 재조합 실패')
  return { blobUrl: res.blobUrl, size: res.size ?? 0 }
}

export function cancelTask(jobId: string): void {
  if (HAS_DOM) {
    localAborts.get(jobId)?.abort()
    return
  }
  void api.runtime.sendMessage({ target: 'offscreen', kind: 'cancel', jobId })
}

export async function revokeTask(blobUrl: string): Promise<void> {
  if (HAS_DOM) return revokeBlobUrl(blobUrl)
  void api.runtime.sendMessage({ target: 'offscreen', kind: 'revoke', blobUrl })
}
