import { describe, expect, it } from 'vitest'
import { parseHls } from '../src/core/hls'

describe('parseHls', () => {
  it('media playlist: segments, init, endlist', () => {
    const m = parseHls(
      `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg0.m4s
#EXTINF:6.0,
seg1.m4s
#EXT-X-ENDLIST`,
      'https://cdn/hls/index.m3u8',
    )
    expect(m.isMaster).toBe(false)
    expect(m.isLive).toBe(false)
    expect(m.variants[0].initSegment?.url).toBe('https://cdn/hls/init.mp4')
    expect(m.variants[0].segments.map((s) => s.url)).toEqual(['https://cdn/hls/seg0.m4s', 'https://cdn/hls/seg1.m4s'])
  })

  it('master playlist: variants with bandwidth/resolution', () => {
    const m = parseHls(
      `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.4d401f"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720.m3u8`,
      'https://cdn/m/master.m3u8',
    )
    expect(m.isMaster).toBe(true)
    expect(m.variants).toHaveLength(2)
    expect(m.variants[0]).toMatchObject({ bandwidth: 5000000, playlistUrl: 'https://cdn/m/1080.m3u8' })
  })

  it('#EXT-X-KEY (non-NONE) → hasEncryption', () => {
    const m = parseHls(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:6,\ns.ts\n#EXT-X-ENDLIST`, 'https://cdn/e/i.m3u8')
    expect(m.hasEncryption).toBe(true)
  })

  it('no ENDLIST → isLive', () => {
    const m = parseHls(`#EXTM3U\n#EXTINF:6,\ns0.ts`, 'https://cdn/l/i.m3u8')
    expect(m.isLive).toBe(true)
  })

  it('EXT-X-BYTERANGE offset accumulates', () => {
    const m = parseHls(
      `#EXTM3U
#EXT-X-BYTERANGE:100@0
#EXTINF:6,
s.ts
#EXT-X-BYTERANGE:200
#EXTINF:6,
s.ts
#EXT-X-ENDLIST`,
      'https://cdn/b/i.m3u8',
    )
    expect(m.variants[0].segments[0].byteRange).toEqual({ offset: 0, length: 100 })
    expect(m.variants[0].segments[1].byteRange).toEqual({ offset: 100, length: 200 })
  })

  it('throws without #EXTM3U', () => {
    expect(() => parseHls('not a playlist', 'https://cdn/x')).toThrow()
  })
})
