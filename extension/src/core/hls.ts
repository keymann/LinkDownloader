// HLS(.m3u8) 파서 — docs/research/09-parser-spec.md §1 구현. 문자열 기반이라 어디서든 동작.
import type { ManifestModel, SegmentRef, Variant } from './types'

function resolve(uri: string, base: string): string {
  try {
    return new URL(uri, base).href
  } catch {
    return uri
  }
}

// KEY=VALUE 속성 리스트 파싱(quoted-string 내 쉼표 보존)
function parseAttrList(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1].toUpperCase()] = m[3] ?? m[2]
  return out
}

function parseByteRange(
  s: string | undefined,
  cursor: { pos: number },
): SegmentRef['byteRange'] | undefined {
  if (!s) return undefined
  const [len, off] = s.split('@')
  const offset = off !== undefined ? parseInt(off, 10) : cursor.pos
  const length = parseInt(len, 10)
  cursor.pos = offset + length
  return { offset, length }
}

export function parseHls(text: string, baseUrl: string): ManifestModel {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  if (!lines[0]?.startsWith('#EXTM3U')) {
    throw new Error('HLS: #EXTM3U 헤더 없음')
  }
  const isMaster = text.includes('#EXT-X-STREAM-INF')
  const m: ManifestModel = {
    protocol: 'hls',
    isMaster,
    isLive: !isMaster, // media에서 ENDLIST 확인 후 확정
    baseUrl,
    hasEncryption: false,
    variants: [],
    warnings: [],
  }

  if (isMaster) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const a = parseAttrList(line.slice(line.indexOf(':') + 1))
        const uri = lines[i + 1]
        if (uri && !uri.startsWith('#')) {
          const res = a.RESOLUTION?.split('x')
          m.variants.push({
            id: uri,
            type: 'muxed',
            bandwidth: a.BANDWIDTH ? parseInt(a.BANDWIDTH, 10) : undefined,
            resolution: res ? { w: +res[0], h: +res[1] } : undefined,
            codecs: a.CODECS,
            playlistUrl: resolve(uri, baseUrl),
            segments: [],
          })
        }
      } else if (line.startsWith('#EXT-X-MEDIA')) {
        const a = parseAttrList(line.slice(line.indexOf(':') + 1))
        if (a.URI) {
          m.variants.push({
            id: `${a['GROUP-ID'] ?? ''}:${a.NAME ?? ''}`,
            type: (a.TYPE?.toLowerCase() as Variant['type']) ?? 'audio',
            language: a.LANGUAGE,
            playlistUrl: resolve(a.URI, baseUrl),
            segments: [],
          })
        }
      } else if (line.startsWith('#EXT-X-SESSION-KEY')) {
        const k = parseAttrList(line.slice(line.indexOf(':') + 1))
        if (k.METHOD && k.METHOD.toUpperCase() !== 'NONE') {
          m.hasEncryption = true
          m.encryptionInfo = { source: 'hls-key', method: k.METHOD }
        }
      }
    }
    m.isLive = false
    return m
  }

  // media playlist
  const v: Variant = { id: 'media', type: 'muxed', segments: [] }
  m.variants.push(v)
  const cursor = { pos: 0 }
  let pendingDur: number | undefined
  let pendingRange: SegmentRef['byteRange']
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('#EXT-X-ENDLIST')) {
      m.isLive = false
    } else if (line.startsWith('#EXT-X-KEY')) {
      const k = parseAttrList(line.slice(line.indexOf(':') + 1))
      if (k.METHOD && k.METHOD.toUpperCase() !== 'NONE') {
        m.hasEncryption = true
        m.encryptionInfo = { source: 'hls-key', method: k.METHOD }
      }
    } else if (line.startsWith('#EXT-X-MAP')) {
      const a = parseAttrList(line.slice(line.indexOf(':') + 1))
      v.initSegment = {
        url: resolve(a.URI, baseUrl),
        byteRange: parseByteRange(a.BYTERANGE, cursor),
      }
    } else if (line.startsWith('#EXTINF')) {
      pendingDur = parseFloat(line.slice(line.indexOf(':') + 1).split(',')[0])
    } else if (line.startsWith('#EXT-X-BYTERANGE')) {
      pendingRange = parseByteRange(line.slice(line.indexOf(':') + 1), cursor)
    } else if (line.startsWith('#')) {
      // 기타 태그 무시
    } else {
      v.segments.push({ url: resolve(line, baseUrl), durationSec: pendingDur, byteRange: pendingRange })
      pendingDur = undefined
      pendingRange = undefined
    }
  }
  m.durationSec = v.segments.reduce((s, x) => s + (x.durationSec ?? 0), 0)
  return m
}
