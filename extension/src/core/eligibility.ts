// 다운로드 적격성 판정 — docs/research/01 §6 Decision Tree, 04 fail-closed 구현.
// DRM/암호화/접근제어/ToS 우회는 하지 않는다. 애매하면 저장하지 않는다.
import type { EligibilityResult, MediaCandidate } from './types'

export interface HostPolicy {
  // ToS/robots 기반 정책 테이블(호스트별). 준법 검토로 관리.
  forbidsDownload?: boolean
  robotsDisallow?: (url: string) => boolean
}

export type PolicyLookup = (host: string) => HostPolicy | undefined

function verdict(id: string, v: EligibilityResult['verdict'], reason: string): EligibilityResult {
  return { candidateId: id, verdict: v, reason }
}

export function evaluate(c: MediaCandidate, policyOf?: PolicyLookup): EligibilityResult {
  const host = safeHost(c.url ?? c.pageUrl)
  const policy = policyOf?.(host)

  // 1) DRM / EME
  if (c.signals.eme || c.signals.licenseServer) {
    return verdict(c.id, 'INELIGIBLE', 'DRM')
  }
  // 2) 암호화(매니페스트 신호 포함)
  if (c.signals.encrypted || c.manifest?.hasEncryption) {
    return verdict(c.id, 'INELIGIBLE', 'ENCRYPTED')
  }
  // 3) robots.txt
  if (policy?.robotsDisallow?.(c.url ?? c.pageUrl)) {
    return verdict(c.id, 'SKIP', 'ROBOTS')
  }
  // 4) ToS
  if (policy?.forbidsDownload) {
    return verdict(c.id, 'INELIGIBLE', 'TOS')
  }
  // 5) 도달 가능성/CORS 불명확 → 보수적(fail-closed)
  if (c.signals.cors === 'deny') {
    return verdict(c.id, 'CONDITIONAL', 'NEEDS_PROXY_OR_PERMISSION')
  }
  // 6) LIVE
  if (c.signals.isLive || c.manifest?.isLive) {
    return verdict(c.id, 'CONDITIONAL', 'LIVE')
  }
  // 7) 미디어 URL/세그먼트 확보 여부
  const hasTarget =
    !!c.url || (c.manifest && c.manifest.variants.some((v) => v.segments.length > 0))
  if (!hasTarget) {
    return verdict(c.id, 'CONDITIONAL', 'NO_RESOLVABLE_SOURCE')
  }

  return verdict(c.id, 'ELIGIBLE', 'OK')
}

function safeHost(u: string): string {
  try {
    return new URL(u).host
  } catch {
    return ''
  }
}
