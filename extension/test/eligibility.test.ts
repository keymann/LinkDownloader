import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/core/eligibility'
import type { MediaCandidate, ManifestModel } from '../src/core/types'

function cand(patch: Partial<MediaCandidate> = {}): MediaCandidate {
  return { id: 'x', origin: 'network', kind: 'file', url: 'https://cdn/v.mp4', pageUrl: 'https://p', signals: {}, ...patch }
}
const manifest = (o: Partial<ManifestModel>): ManifestModel => ({
  protocol: 'hls', isMaster: false, isLive: false, baseUrl: '', hasEncryption: false, variants: [{ id: 'v', type: 'muxed', segments: [{ url: 's' }] }], warnings: [], ...o,
})

describe('eligibility decision tree (fail-closed)', () => {
  it('EME → INELIGIBLE/DRM', () => {
    expect(evaluate(cand({ signals: { eme: true } }))).toMatchObject({ verdict: 'INELIGIBLE', reason: 'DRM' })
  })
  it('encrypted signal → INELIGIBLE/ENCRYPTED', () => {
    expect(evaluate(cand({ signals: { encrypted: true } })).reason).toBe('ENCRYPTED')
  })
  it('encrypted manifest → INELIGIBLE/ENCRYPTED', () => {
    expect(evaluate(cand({ kind: 'hls', url: 'https://cdn/x.m3u8', manifest: manifest({ hasEncryption: true }) })).reason).toBe('ENCRYPTED')
  })
  it('robots disallow → SKIP/ROBOTS', () => {
    const r = evaluate(cand(), () => ({ robotsDisallow: () => true }))
    expect(r).toMatchObject({ verdict: 'SKIP', reason: 'ROBOTS' })
  })
  it('ToS forbid → INELIGIBLE/TOS', () => {
    const r = evaluate(cand(), () => ({ forbidsDownload: true }))
    expect(r).toMatchObject({ verdict: 'INELIGIBLE', reason: 'TOS' })
  })
  it('cors deny → CONDITIONAL', () => {
    expect(evaluate(cand({ signals: { cors: 'deny' } })).verdict).toBe('CONDITIONAL')
  })
  it('live → CONDITIONAL', () => {
    expect(evaluate(cand({ signals: { isLive: true } })).reason).toBe('LIVE')
  })
  it('no resolvable source → CONDITIONAL', () => {
    expect(evaluate(cand({ url: undefined })).reason).toBe('NO_RESOLVABLE_SOURCE')
  })
  it('clean file → ELIGIBLE', () => {
    expect(evaluate(cand()).verdict).toBe('ELIGIBLE')
  })
})
