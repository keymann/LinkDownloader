import { describe, expect, it } from 'vitest'
import { createPolicyLookup } from '../src/core/policy'
import { parseRobots } from '../src/core/robots'
import { evaluate } from '../src/core/eligibility'
import type { MediaCandidate } from '../src/core/types'

const rules = parseRobots(`User-agent: *\nDisallow: /private`)
const cand = (url: string): MediaCandidate => ({ id: url, origin: 'network', kind: 'file', url, pageUrl: url, signals: {} })

describe('policy integration', () => {
  const lookup = createPolicyLookup({ 'tos.com': { forbidsDownload: true } }, new Map([['ex.com', rules]]))

  it('robots-disallowed path → SKIP', () => {
    expect(evaluate(cand('https://ex.com/private/a.mp4'), lookup)).toMatchObject({ verdict: 'SKIP', reason: 'ROBOTS' })
  })
  it('robots-allowed path → ELIGIBLE', () => {
    expect(evaluate(cand('https://ex.com/public/a.mp4'), lookup).verdict).toBe('ELIGIBLE')
  })
  it('ToS host → INELIGIBLE/TOS', () => {
    expect(evaluate(cand('https://tos.com/a.mp4'), lookup).reason).toBe('TOS')
  })
  it('host without policy → ELIGIBLE', () => {
    expect(evaluate(cand('https://free.com/a.mp4'), lookup).verdict).toBe('ELIGIBLE')
  })
})
