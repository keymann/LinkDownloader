import { assertSafeUrl, BROWSER_UA, error } from '../lib/http'

// CORS 우회 스트리밍 프록시. Range 헤더를 전달하고 응답을 그대로 스트리밍한다.
export async function handleProxy(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) return error(400, 'url 파라미터가 필요합니다.')

  let safe: URL
  try {
    safe = assertSafeUrl(target)
  } catch (e) {
    return error(400, (e as Error).message)
  }

  const fwd: HeadersInit = { 'User-Agent': BROWSER_UA, Accept: '*/*' }
  const range = request.headers.get('Range')
  if (range) (fwd as Record<string, string>).Range = range
  // 일부 CDN은 Referer를 요구 → 대상 오리진을 Referer로 사용
  ;(fwd as Record<string, string>).Referer = safe.origin

  let upstream: Response
  try {
    upstream = await fetch(safe.href, { headers: fwd, redirect: 'follow' })
  } catch {
    return error(502, '대상 서버에서 파일을 가져오지 못했습니다.')
  }

  const headers = new Headers()
  const pass = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']
  for (const h of pass) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set('Cache-Control', 'no-store')
  // 브라우저 다운로드 진행률 계산을 위해 길이 노출
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')

  return new Response(upstream.body, { status: upstream.status, headers })
}
