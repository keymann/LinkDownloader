// Cloudflare Worker 진입점 (static assets 모델).
// - /api/* 요청은 아래 라우터가 처리한다.
// - 그 외 요청은 정적 자산(dist)으로 위임하며, 매칭이 없으면 SPA 폴백(index.html)된다.
//   (wrangler.toml: [assets] run_worker_first=true, not_found_handling=single-page-application)
import { ensureBootstrapUser, getSessionUser, type Env } from './lib/auth'
import { error } from './lib/http'
import { handleLogin } from './api/login'
import { handleSession } from './api/session'
import { handleLogout } from './api/logout'
import { handleChangePassword } from './api/change-password'
import { handleExtract } from './api/extract'
import { handleProxy } from './api/proxy'
import { handleHls } from './api/hls'
import {
  handleHistoryDelete,
  handleHistoryGet,
  handleHistoryPost,
} from './api/history'

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // 초기 사용자(keymann) 부트스트랩
  await ensureBootstrapUser(env)

  // 인증 불필요 엔드포인트
  if (path === '/api/login' && method === 'POST') return handleLogin(request, env)
  if (path === '/api/session' && method === 'GET') return handleSession(request, env)

  // 인증 가드
  const user = await getSessionUser(env, request)
  if (!user) return error(401, '로그인이 필요합니다.')

  if (path === '/api/logout' && method === 'POST') return handleLogout(request, env)
  if (path === '/api/change-password' && method === 'POST') return handleChangePassword(request, env, user)
  if (path === '/api/extract' && method === 'POST') return handleExtract(request)
  if (path === '/api/proxy' && method === 'GET') return handleProxy(request)
  if (path === '/api/hls' && method === 'GET') return handleHls(request)
  if (path === '/api/history') {
    if (method === 'GET') return handleHistoryGet(request, env, user)
    if (method === 'POST') return handleHistoryPost(request, env, user)
    if (method === 'DELETE') return handleHistoryDelete(request, env, user)
  }

  return error(404, '존재하지 않는 API 입니다.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env)
    }
    // 정적 자산 + SPA 폴백
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
