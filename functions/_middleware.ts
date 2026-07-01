// 모든 /api/* 요청에 대한 인증 가드. 로그인/세션 확인 엔드포인트는 예외.
import { ensureBootstrapUser, getSessionUser, type Env } from './lib/auth'
import { error } from './lib/http'

const PUBLIC_PATHS = new Set(['/api/login', '/api/session'])

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context
  const url = new URL(request.url)

  // 정적 자산 및 비 API 경로는 그대로 통과
  if (!url.pathname.startsWith('/api/')) return next()

  // 초기 사용자 부트스트랩(요구사항 2)
  await ensureBootstrapUser(env)

  if (PUBLIC_PATHS.has(url.pathname)) return next()

  const user = await getSessionUser(env, request)
  if (!user) return error(401, '로그인이 필요합니다.')

  // 인증된 사용자명을 다운스트림 핸들러로 전달
  context.data.user = user
  return next()
}
