// 웹페이지 HTML에서 동영상 소스 후보를 추출한다.
// fallback 순서: 직접 파일 → <video>/<source> → og:video/twitter → JSON-LD → HLS(.m3u8)/DASH(.mpd)

export type SourceKind = 'file' | 'hls' | 'dash'

export interface VideoSource {
  url: string
  kind: SourceKind
  label: string
}

export interface ExtractResult {
  pageUrl: string
  title: string
  thumbnail: string | null
  sources: VideoSource[]
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|flv|ogv|ogg|3gp)(\?|#|$)/i

function resolveUrl(base: string, ref: string): string | null {
  try {
    return new URL(ref, base).href
  } catch {
    return null
  }
}

function kindForUrl(url: string): SourceKind {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls'
  if (/\.mpd(\?|#|$)/i.test(url)) return 'dash'
  return 'file'
}

// 속성값 추출 헬퍼(태그 문자열 내 attr="..." / attr='...')
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? (m[2] ?? m[3] ?? null) : null
}

function metaContent(html: string, keyAttr: string, keyVal: string): string | null {
  const re = new RegExp(
    `<meta[^>]*${keyAttr}\\s*=\\s*["']${keyVal}["'][^>]*>`,
    'i',
  )
  const m = html.match(re)
  if (!m) return null
  return attr(m[0], 'content')
}

export function extractSources(html: string, pageUrl: string): ExtractResult {
  const sources: VideoSource[] = []
  const seen = new Set<string>()

  const add = (rawUrl: string | null, label: string) => {
    if (!rawUrl) return
    const abs = resolveUrl(pageUrl, rawUrl)
    if (!abs || seen.has(abs)) return
    seen.add(abs)
    sources.push({ url: abs, kind: kindForUrl(abs), label })
  }

  // 제목
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const ogTitle = metaContent(html, 'property', 'og:title')
  const title = (ogTitle || (titleMatch ? titleMatch[1] : '') || pageUrl).trim().slice(0, 200)

  // 썸네일
  const thumbnail =
    (metaContent(html, 'property', 'og:image') ||
      metaContent(html, 'name', 'twitter:image') ||
      null)

  // 1) <video> src, poster & 하위 <source>
  const videoTags = html.match(/<video[\s\S]*?<\/video>/gi) || []
  for (const block of videoTags) {
    const openTag = block.match(/<video[^>]*>/i)?.[0] || ''
    add(attr(openTag, 'src'), '<video> 태그')
    const sourceTags = block.match(/<source[^>]*>/gi) || []
    for (const st of sourceTags) add(attr(st, 'src'), '<source> 태그')
  }
  // 페이지 전역의 독립 <source> (일부 사이트)
  for (const st of html.match(/<source[^>]*>/gi) || []) {
    const t = attr(st, 'type') || ''
    if (/video|mpegurl|dash/i.test(t) || VIDEO_EXT.test(attr(st, 'src') || '')) {
      add(attr(st, 'src'), '<source> 태그')
    }
  }

  // 2) OpenGraph / Twitter player
  add(metaContent(html, 'property', 'og:video:secure_url'), 'og:video')
  add(metaContent(html, 'property', 'og:video:url'), 'og:video')
  add(metaContent(html, 'property', 'og:video'), 'og:video')
  add(metaContent(html, 'name', 'twitter:player:stream'), 'twitter:player')

  // 3) JSON-LD VideoObject.contentUrl
  const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  for (const block of ldBlocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '')
    try {
      const data = JSON.parse(body)
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        const cu = node?.contentUrl || node?.video?.contentUrl
        if (typeof cu === 'string') add(cu, 'JSON-LD VideoObject')
      }
    } catch {
      /* JSON-LD 파싱 실패는 무시 */
    }
  }

  // 4) 본문 내 직접 미디어 URL 스캔(.mp4/.webm/.m3u8/.mpd 등)
  const urlRe = /https?:\/\/[^\s"'<>()]+/gi
  for (const raw of html.match(urlRe) || []) {
    const clean = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&')
    if (VIDEO_EXT.test(clean) || /\.m3u8(\?|#|$)/i.test(clean) || /\.mpd(\?|#|$)/i.test(clean)) {
      const k = kindForUrl(clean)
      add(clean, k === 'hls' ? 'HLS(.m3u8)' : k === 'dash' ? 'DASH(.mpd)' : '미디어 링크')
    }
  }

  return { pageUrl, title, thumbnail, sources }
}
