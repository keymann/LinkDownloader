import { clearCookieHeader, destroySession, getCookieToken, type Env } from '../lib/auth'
import { json } from '../lib/http'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = getCookieToken(request)
  if (token) await destroySession(env, token)
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } })
}
