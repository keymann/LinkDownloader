import { describe, expect, it } from 'vitest'
import { isAllowed, isDisallowed, parseRobots } from '../src/core/robots'

const RULES = parseRobots(`User-agent: *
Disallow: /private
Allow: /private/ok
Disallow: /*.mp4$

User-agent: BadBot
Disallow: /`)

describe('robots', () => {
  const T = (p: string) => isAllowed(RULES, p, 'MediaEligibilityInspector')

  it('allows unmatched paths', () => {
    expect(T('/public')).toBe(true)
  })
  it('disallows matched prefix', () => {
    expect(T('/private')).toBe(false)
    expect(T('/private/secret')).toBe(false)
  })
  it('longer Allow beats Disallow', () => {
    expect(T('/private/ok')).toBe(true)
  })
  it('$ end-anchor + wildcard', () => {
    expect(T('/video.mp4')).toBe(false)
    expect(T('/video.mp4x')).toBe(true)
  })
  it('specific UA group overrides * (BadBot blocked all)', () => {
    expect(isDisallowed(RULES, '/anything', 'BadBot')).toBe(true)
  })
  it('empty robots = allow all', () => {
    expect(isAllowed(parseRobots(''), '/whatever')).toBe(true)
  })
})
