// MSE↔세그먼트 상관 — docs/research/01 §3·§4, 02(Media Detector).
// MSE/blob로 숨겨진 재생을, 같은 탭에서 관측된 실제 매니페스트/세그먼트 소스와 연결한다.
// 정밀 매칭: MSE appendBuffer의 코덱을 매니페스트 variant 코덱과 대조해 과결합을 방지.
import { familiesFromMimes, familiesFromVariants, intersects } from './codecs'
import type { MediaCandidate } from './types'

export interface MseContext {
  active: boolean // MediaSource(blob) 또는 SourceBuffer 관측됨
  appendMimes: string[] // appendBuffer로 주입된 mime들(코덱 포함)
  mediaFetchUrls: string[] // 페이지가 fetch한 미디어 URL(세그먼트/매니페스트)
}

const SEG_RE = /\.(m4s|ts|mp4|webm)(\?|#|$)/i
const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i

function isBlobHidden(c: MediaCandidate): boolean {
  return c.origin === 'dom' && !c.url
}

export function correlate(candidates: MediaCandidate[], mse?: MseContext): MediaCandidate[] {
  const manifests = candidates.filter((c) => c.kind === 'hls' || c.kind === 'dash')
  const mseActive = !!mse?.active
  const segCount = (mse?.mediaFetchUrls ?? []).filter((u) => SEG_RE.test(u) && !MANIFEST_RE.test(u)).length

  // MSE 코덱 패밀리(있으면 정밀 매칭 가능)
  const mseFamilies = familiesFromMimes(mse?.appendMimes ?? [])
  const hasCodecInfo = mseFamilies.size > 0
  // 코덱이 일치하는 매니페스트(정밀 상관)
  const matched = hasCodecInfo
    ? manifests.filter((m) => (m.manifest ? intersects(familiesFromVariants(m.manifest.variants), mseFamilies) : false))
    : []
  const matchedIds = new Set(matched.map((m) => m.id))

  // blob 후보를 매니페스트로 대표(중복 제거)할 수 있는가?
  const canRepresent =
    mseActive &&
    (matched.length > 0 || // 코덱 일치 매니페스트 존재 → 확실
      (!hasCodecInfo && manifests.length === 1)) // 코덱 정보 없음 + 매니페스트 1개 → 탭 스코프 폴백

  const out: MediaCandidate[] = []
  for (const c of candidates) {
    if (isBlobHidden(c)) {
      if (canRepresent) continue // 실제 매니페스트가 대표 → blob 중복 제거
      out.push({
        ...c,
        signals: { ...c.signals, mse: mseActive },
        note: !mseActive
          ? 'blob URL — 원본 소스 미해결'
          : hasCodecInfo && manifests.length > 0
            ? 'MSE 스트림 — 관측된 매니페스트와 코덱 불일치(원본 미확인)'
            : segCount > 0
              ? `MSE 스트림 — 세그먼트 ${segCount}개 관측, 매니페스트 미확인(재조합 불가)`
              : 'MSE/blob 스트림 — 원본 소스 미해결',
      })
      continue
    }
    if ((c.kind === 'hls' || c.kind === 'dash') && mseActive) {
      if (matchedIds.has(c.id)) {
        out.push({ ...c, signals: { ...c.signals, mse: true }, note: 'MSE 재생 스트림(코덱 일치)' })
      } else if (hasCodecInfo) {
        // 코덱 불일치 → 이 매니페스트는 현재 MSE 재생과 다른 소스일 수 있음(표시만, 다운로드는 유효)
        out.push({ ...c, note: 'MSE 코덱과 불일치 — 다른 스트림일 수 있음' })
      } else {
        out.push({ ...c, signals: { ...c.signals, mse: true }, note: 'MSE 재생 스트림' })
      }
      continue
    }
    out.push(c)
  }
  return out
}
