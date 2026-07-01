// 공통 HTTP 응답 헬퍼 및 SSRF 완화 유틸.

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  })
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status })
}

// http/https 스킴만 허용하고, 사설/루프백 대상 호스트를 차단한다(SSRF 완화).
export function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('유효하지 않은 URL 입니다.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http/https URL만 허용됩니다.')
  }
  const host = url.hostname.toLowerCase()
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  if (blocked) throw new Error('허용되지 않은 대상입니다.')
  return url
}

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
