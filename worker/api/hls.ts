import { assertSafeUrl, BROWSER_UA, error, json } from '../lib/http'

// m3u8 를 파싱해 세그먼트(.ts) URL 목록을 반환한다.
// 마스터 플레이리스트면 최고 대역폭 variant 를 선택한 뒤 미디어 플레이리스트를 다시 파싱한다.

async function fetchText(u: string): Promise<string> {
  const res = await fetch(u, { headers: { 'User-Agent': BROWSER_UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function parseMaster(text: string, base: string): string | null {
  const lines = text.split(/\r?\n/)
  let best: { bw: number; url: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bw = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10)
      const uri = (lines[i + 1] || '').trim()
      if (uri && !uri.startsWith('#')) {
        const abs = new URL(uri, base).href
        if (!best || bw > best.bw) best = { bw, url: abs }
      }
    }
  }
  return best?.url ?? null
}

function parseMedia(text: string, base: string): string[] {
  const segs: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    try {
      segs.push(new URL(line, base).href)
    } catch {
      /* skip */
    }
  }
  return segs
}

export async function handleHls(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) return error(400, 'url 파라미터가 필요합니다.')

  let safe: URL
  try {
    safe = assertSafeUrl(target)
  } catch (e) {
    return error(400, (e as Error).message)
  }

  try {
    let text = await fetchText(safe.href)
    let base = safe.href
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = parseMaster(text, base)
      if (!variant) return error(422, 'HLS variant 를 찾지 못했습니다.')
      base = variant
      text = await fetchText(variant)
    }
    const segments = parseMedia(text, base)
    if (segments.length === 0) return error(422, 'HLS 세그먼트를 찾지 못했습니다.')
    return json({ segments })
  } catch (e) {
    return error(502, `HLS 매니페스트 처리 실패: ${(e as Error).message}`)
  }
}
