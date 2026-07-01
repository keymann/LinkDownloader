// robots.txt 파서/매처 — docs/research/01 §6. 자동 수집 정책 준수(courtesy + 준법).
// 표준(REP) 근사 구현: User-agent 그룹, Allow/Disallow, * 와일드카드, $ 종료 앵커, 최장·Allow 우선.

export interface RobotsRule {
  allow: boolean
  pattern: string
}
export interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}
export interface RobotsRules {
  groups: RobotsGroup[]
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = []
  let cur: RobotsGroup | null = null
  let expectingAgent = false // 연속된 User-agent는 같은 그룹으로 묶는다

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (field === 'user-agent') {
      if (!cur || !expectingAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(value.toLowerCase())
      expectingAgent = true
    } else if (field === 'allow' || field === 'disallow') {
      if (!cur) {
        cur = { agents: ['*'], rules: [] }
        groups.push(cur)
      }
      expectingAgent = false
      // "Disallow:" (빈 값) = 제한 없음 → 규칙에 넣되 빈 패턴은 매칭 스킵
      cur.rules.push({ allow: field === 'allow', pattern: value })
    } else {
      expectingAgent = false // sitemap 등 기타 필드
    }
  }
  return { groups }
}

// UA에 맞는 그룹 선택: 정확 토큰 매치 우선, 없으면 '*'
function selectGroup(rules: RobotsRules, ua: string): RobotsGroup | undefined {
  const ual = ua.toLowerCase()
  let star: RobotsGroup | undefined
  for (const g of rules.groups) {
    for (const a of g.agents) {
      if (a === '*') star = star ?? g
      else if (ual.includes(a)) return g
    }
  }
  return star
}

// robots 패턴 → 정규식. 매칭 시 특이도(패턴 길이) 반환, 미매칭 -1.
function matchLength(pattern: string, path: string): number {
  if (pattern === '') return -1 // 빈 Disallow = 매칭 없음(=허용)
  const anchoredEnd = pattern.endsWith('$')
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern
  const re =
    '^' +
    body
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 정규식 특수문자 escape (단 * 제외 위해 아래서 처리)
      .replace(/\\\*/g, '.*') // escape된 \* 를 .* 로 (위 escape가 *를 건드리진 않지만 안전)
      .replace(/\*/g, '.*') +
    (anchoredEnd ? '$' : '')
  try {
    return new RegExp(re).test(path) ? pattern.length : -1
  } catch {
    return path.startsWith(body) ? pattern.length : -1
  }
}

// 경로 허용 여부. 매칭 규칙 없으면 허용(기본). 최장 매치 우선, 동률이면 Allow 우선.
export function isAllowed(rules: RobotsRules, path: string, ua = '*'): boolean {
  const g = selectGroup(rules, ua)
  if (!g) return true
  let best: { allow: boolean; len: number } | null = null
  for (const r of g.rules) {
    const len = matchLength(r.pattern, path)
    if (len < 0) continue
    if (!best || len > best.len || (len === best.len && r.allow)) {
      best = { allow: r.allow, len }
    }
  }
  return best ? best.allow : true
}

export function isDisallowed(rules: RobotsRules, path: string, ua = '*'): boolean {
  return !isAllowed(rules, path, ua)
}
