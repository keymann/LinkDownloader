import type { Env } from '../lib/auth'
import { assertSafeUrl, BROWSER_UA, error, json } from '../lib/http'
import { extractSources, type VideoSource } from '../lib/htmlparse'

interface EnrichedSource extends VideoSource {
  size: number | null
  contentType: string | null
}

// 후보 소스에 HEAD 요청으로 용량/타입을 붙인다(HLS/DASH는 매니페스트라 크기 미상).
async function enrich(source: VideoSource): Promise<EnrichedSource> {
  if (source.kind !== 'file') return { ...source, size: null, contentType: null }
  try {
    const res = await fetch(source.url, {
      method: 'HEAD',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    })
    const len = res.headers.get('Content-Length')
    return {
      ...source,
      size: len ? parseInt(len, 10) : null,
      contentType: res.headers.get('Content-Type'),
    }
  } catch {
    return { ...source, size: null, contentType: null }
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return error(400, '잘못된 요청입니다.')
  }
  const raw = (body.url || '').trim()
  if (!raw) return error(400, 'URL을 입력하세요.')

  let target: URL
  try {
    target = assertSafeUrl(raw)
  } catch (e) {
    return error(400, (e as Error).message)
  }

  // 입력 자체가 미디어 파일/매니페스트면 페이지 파싱 없이 바로 후보로 사용
  if (/\.(mp4|webm|mov|m4v|mkv|m3u8|mpd)(\?|#|$)/i.test(target.pathname)) {
    const kind = /\.m3u8/i.test(target.pathname) ? 'hls' : /\.mpd/i.test(target.pathname) ? 'dash' : 'file'
    const source: VideoSource = { url: target.href, kind, label: '직접 링크' }
    const enriched = await enrich(source)
    return json({
      pageUrl: target.href,
      title: target.pathname.split('/').pop() || target.href,
      thumbnail: null,
      sources: [enriched],
    })
  }

  let html: string
  try {
    const res = await fetch(target.href, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
    })
    if (!res.ok) return error(502, `페이지를 불러오지 못했습니다 (HTTP ${res.status}).`)
    const ct = res.headers.get('Content-Type') || ''
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return error(415, '동영상을 찾을 수 있는 HTML 페이지가 아닙니다.')
    }
    html = await res.text()
  } catch {
    return error(502, '페이지를 불러오는 중 오류가 발생했습니다.')
  }

  const result = extractSources(html, target.href)
  if (result.sources.length === 0) {
    return json({ ...result, sources: [] })
  }

  // 상위 몇 개만 HEAD 조회(과도한 요청 방지)
  const limited = result.sources.slice(0, 8)
  const enriched = await Promise.all(limited.map(enrich))
  return json({ ...result, sources: enriched })
}
