import { describe, expect, it } from 'vitest'
import { IneligibleError, bestVideoVariant, planFromManifest, resolveHlsManifest } from '../src/core/plan'
import type { ManifestModel } from '../src/core/types'

const base = (o: Partial<ManifestModel>): ManifestModel => ({
  protocol: 'hls', isMaster: false, isLive: false, baseUrl: '', hasEncryption: false, variants: [], warnings: [], ...o,
})

describe('planFromManifest', () => {
  it('fMP4 (init present) → fmp4-concat', () => {
    const m = base({ variants: [{ id: 'v', type: 'muxed', initSegment: { url: 'i' }, segments: [{ url: 's0' }] }] })
    expect(planFromManifest(m)).toMatchObject({ mode: 'fmp4-concat' })
  })
  it('.ts segments (no init) → ts-concat', () => {
    const m = base({ variants: [{ id: 'v', type: 'muxed', segments: [{ url: 'https://c/s0.ts' }] }] })
    expect(planFromManifest(m).mode).toBe('ts-concat')
  })
  it('separate video+audio → separate-tracks', () => {
    const m = base({
      variants: [
        { id: 'v', type: 'video', initSegment: { url: 'vi' }, segments: [{ url: 'v0' }] },
        { id: 'a', type: 'audio', initSegment: { url: 'ai' }, segments: [{ url: 'a0' }] },
      ],
    })
    expect(planFromManifest(m).mode).toBe('separate-tracks')
  })
  it('encrypted → IneligibleError(ENCRYPTED)', () => {
    expect(() => planFromManifest(base({ hasEncryption: true, variants: [{ id: 'v', type: 'muxed', segments: [{ url: 's' }] }] }))).toThrow(IneligibleError)
  })
  it('live → IneligibleError(LIVE)', () => {
    try {
      planFromManifest(base({ isLive: true, variants: [{ id: 'v', type: 'muxed', segments: [{ url: 's' }] }] }))
      expect.unreachable()
    } catch (e) {
      expect((e as IneligibleError).reason).toBe('LIVE')
    }
  })
  it('no segments → IneligibleError', () => {
    expect(() => planFromManifest(base({ variants: [] }))).toThrow(IneligibleError)
  })

  it('bestVideoVariant picks highest bandwidth', () => {
    const m = base({
      variants: [
        { id: 'lo', type: 'muxed', bandwidth: 1000, segments: [{ url: 's' }] },
        { id: 'hi', type: 'muxed', bandwidth: 5000, segments: [{ url: 's' }] },
      ],
    })
    expect(bestVideoVariant(m)?.id).toBe('hi')
  })
})

describe('resolveHlsManifest', () => {
  it('master → picks highest variant → parses media', async () => {
    const files: Record<string, string> = {
      'https://cdn/master.m3u8': `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nhi.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlo.m3u8`,
      'https://cdn/hi.m3u8': `#EXTM3U\n#EXTINF:6,\ns0.ts\n#EXT-X-ENDLIST`,
    }
    const fakeFetch = (async (u: string) =>
      files[u] !== undefined ? new Response(files[u]) : new Response('', { status: 404 })) as typeof fetch
    const m = await resolveHlsManifest('https://cdn/master.m3u8', fakeFetch)
    expect(m.isMaster).toBe(false)
    expect(m.variants[0].segments[0].url).toBe('https://cdn/s0.ts')
  })
})
