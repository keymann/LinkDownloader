import { getSessionUser, type Env } from '../lib/auth'
import { json } from '../lib/http'

// 앱 시작 시 현재 로그인 상태 확인(요구사항 3: 세션 유지).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(env, request)
  return json({ user: user ?? null })
}
