import { describe, expect, it } from 'vitest'
import { correlate, type MseContext } from '../src/core/correlate'
import type { MediaCandidate, ManifestModel } from '../src/core/types'

const mani = (id: string, codecs: string): MediaCandidate => ({
  id, origin: 'network', kind: 'hls', url: `https://cdn/${id}.m3u8`, pageUrl: 'p', signals: {},
  manifest: { protocol: 'hls', isMaster: false, isLive: false, baseUrl: '', hasEncryption: false, warnings: [], variants: [{ id: 'v', type: 'muxed', codecs, segments: [{ url: 's' }] }] } as ManifestModel,
})
const blob: MediaCandidate = { id: 'dom:blob', origin: 'dom', kind: 'file', url: undefined, pageUrl: 'p', signals: {} }
const mse = (mimes: string[]): MseContext => ({ active: true, appendMimes: mimes, mediaFetchUrls: [] })

const ids = (arr: MediaCandidate[]) => arr.map((c) => c.id)

describe('correlate (MSE ↔ codec matching)', () => {
  it('codec-matching manifest represents blob; blob removed, mismatch flagged', () => {
    const A = mani('A', 'avc1.4d401f,mp4a.40.2')
    const B = mani('B', 'vp09.00.10.08,opus')
    const out = correlate([blob, A, B], mse(['video/mp4; codecs="avc1.4d401f,mp4a.40.2"']))
    expect(ids(out)).toEqual(['A', 'B']) // blob deduped
    expect(out.find((c) => c.id === 'A')?.signals.mse).toBe(true)
    expect(out.find((c) => c.id === 'B')?.note).toMatch(/불일치/)
  })

  it('no codec info + single manifest → fallback dedup', () => {
    const A = mani('A', 'avc1.4d401f')
    expect(ids(correlate([blob, A], mse([])))).toEqual(['A'])
  })

  it('no codec info + multiple manifests → keep blob (ambiguous)', () => {
    const A = mani('A', 'avc1'); const B = mani('B', 'vp09')
    expect(ids(correlate([blob, A, B], mse([])))).toContain('dom:blob')
  })

  it('codec info but no matching manifest → keep blob (source unresolved)', () => {
    const B = mani('B', 'vp09.00.10.08')
    const out = correlate([blob, B], mse(['video/mp4; codecs="avc1.4d401f"']))
    expect(ids(out)).toContain('dom:blob')
    expect(out.find((c) => c.id === 'dom:blob')?.note).toMatch(/원본 미확인/)
  })

  it('no MSE → passthrough', () => {
    const file: MediaCandidate = { id: 'f', origin: 'network', kind: 'file', url: 'https://cdn/v.mp4', pageUrl: 'p', signals: {} }
    expect(correlate([file], undefined)).toEqual([file])
  })
})
