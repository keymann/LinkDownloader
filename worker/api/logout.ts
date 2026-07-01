import { clearCookieHeader, destroySession, getCookieToken, type Env } from '../lib/auth'
import { json } from '../lib/http'

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getCookieToken(request)
  if (token) await destroySession(env, token)
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } })
}
