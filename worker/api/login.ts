import { checkCredentials, createSession, sessionCookieHeader, type Env } from '../lib/auth'
import { error, json } from '../lib/http'

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return error(400, '잘못된 요청입니다.')
  }
  const username = (body.username || '').trim()
  const password = body.password || ''
  if (!username || !password) return error(400, '아이디와 비밀번호를 입력하세요.')

  const ok = await checkCredentials(env, username, password)
  if (!ok) return error(401, '아이디 또는 비밀번호가 올바르지 않습니다.')

  const token = await createSession(env, username)
  return json(
    { user: username },
    { headers: { 'Set-Cookie': sessionCookieHeader(token) } },
  )
}
