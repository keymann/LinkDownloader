// MSE↔세그먼트 상관 — docs/research/01 §3·§4, 02(Media Detector).
// MSE/blob로 숨겨진 재생을, 같은 탭에서 관측된 실제 매니페스트/세그먼트 소스와 연결한다.
// (탐지 정확도 향상용. 상관은 탭 스코프 근사이며 과결합 가능 → note로 명시.)
import type { MediaCandidate } from './types'

export interface MseContext {
  active: boolean // MediaSource(blob) 또는 SourceBuffer 관측됨
  appendMimes: string[] // appendBuffer로 주입된 mime들
  mediaFetchUrls: string[] // 페이지가 fetch한 미디어 URL(세그먼트/매니페스트)
}

const SEG_RE = /\.(m4s|ts|mp4|webm)(\?|#|$)/i
const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i

// blob src(해석 불가 URL)인 DOM 후보 = MSE 재생 표식
function isBlobHidden(c: MediaCandidate): boolean {
  return c.origin === 'dom' && !c.url
}

export function correlate(candidates: MediaCandidate[], mse?: MseContext): MediaCandidate[] {
  const manifests = candidates.filter((c) => c.kind === 'hls' || c.kind === 'dash')
  const hasManifest = manifests.length > 0
  const mseActive = !!mse?.active
  const segCount = (mse?.mediaFetchUrls ?? []).filter((u) => SEG_RE.test(u) && !MANIFEST_RE.test(u)).length

  const out: MediaCandidate[] = []
  for (const c of candidates) {
    if (isBlobHidden(c)) {
      // 실제 소스(매니페스트)가 같은 탭에 있으면 blob 항목은 중복 → 제거(매니페스트로 대표)
      if (mseActive && hasManifest) continue
      // 소스 미해결: 정보용으로 남기되 사유 명시(eligibility에서 CONDITIONAL 처리됨)
      out.push({
        ...c,
        signals: { ...c.signals, mse: mseActive },
        note: mseActive
          ? segCount > 0
            ? `MSE 스트림 — 세그먼트 ${segCount}개 관측, 매니페스트 미확인(재조합 불가)`
            : 'MSE/blob 스트림 — 원본 소스 미해결'
          : 'blob URL — 원본 소스 미해결',
      })
      continue
    }
    // 매니페스트가 MSE로 재생 중임을 표시(사용자 안내)
    if ((c.kind === 'hls' || c.kind === 'dash') && mseActive) {
      out.push({ ...c, signals: { ...c.signals, mse: true }, note: 'MSE 재생 스트림' })
      continue
    }
    out.push(c)
  }
  return out
}
