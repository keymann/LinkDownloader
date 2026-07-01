// 준법 정책 레이어 — ToS 정책 테이블 + robots.txt 캐시를 eligibility PolicyLookup으로 결합.
// docs/research/01 §6, 04 (fail-closed). 정책 테이블은 준법 검토로 관리(storage.local).
import type { HostPolicy, PolicyLookup } from './eligibility'
import { isDisallowed, type RobotsRules } from './robots'

export interface HostPolicyEntry {
  forbidsDownload?: boolean // ToS가 다운로드/스크래핑 금지 → INELIGIBLE(TOS)
  note?: string
}
export type HostPolicyTable = Record<string, HostPolicyEntry>

// robots.txt에 사용할 UA 토큰(정직하게 식별)
export const ROBOTS_UA = 'MediaEligibilityInspector'

// table/robotsCache는 호출부에서 살아있는 참조를 넘긴다(갱신 반영).
export function createPolicyLookup(
  table: HostPolicyTable,
  robotsCache: Map<string, RobotsRules>,
): PolicyLookup {
  return (host: string): HostPolicy => {
    const entry = table[host]
    const rules = robotsCache.get(host)
    return {
      forbidsDownload: entry?.forbidsDownload,
      robotsDisallow: rules
        ? (url: string) => {
            try {
              return isDisallowed(rules, new URL(url).pathname + new URL(url).search, ROBOTS_UA)
            } catch {
              return false
            }
          }
        : undefined,
    }
  }
}
