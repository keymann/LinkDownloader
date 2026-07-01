// 세션/계정 관련 공통 로직. KV에 계정과 세션을 저장한다.
import { hashPassword, randomHex, verifyPassword } from './crypto'

export interface Env {
  LINKDL_KV: KVNamespace
}

interface UserRecord {
  salt: string
  hash: string
}

interface SessionRecord {
  user: string
  exp: number
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 30 // 30일
const COOKIE_NAME = 'ld_session'

// 요구사항: 초기 사용자 keymann 을 등록해 둔다. KV에 없으면 최초 접근 시 부트스트랩.
const BOOTSTRAP_USER = 'keymann'
const BOOTSTRAP_PASSWORD = 'dlsghcjsxh82'

const userKey = (name: string) => `user:${name}`
const sessionKey = (token: string) => `session:${token}`

export async function ensureBootstrapUser(env: Env): Promise<void> {
  const existing = await env.LINKDL_KV.get(userKey(BOOTSTRAP_USER))
  if (existing) return
  const { salt, hash } = await hashPassword(BOOTSTRAP_PASSWORD)
  await env.LINKDL_KV.put(userKey(BOOTSTRAP_USER), JSON.stringify({ salt, hash } satisfies UserRecord))
}

export async function getUser(env: Env, name: string): Promise<UserRecord | null> {
  const raw = await env.LINKDL_KV.get(userKey(name))
  return raw ? (JSON.parse(raw) as UserRecord) : null
}

export async function setUserPassword(env: Env, name: string, password: string): Promise<void> {
  const { salt, hash } = await hashPassword(password)
  await env.LINKDL_KV.put(userKey(name), JSON.stringify({ salt, hash } satisfies UserRecord))
}

export async function checkCredentials(env: Env, name: string, password: string): Promise<boolean> {
  const user = await getUser(env, name)
  if (!user) return false
  return verifyPassword(password, user.salt, user.hash)
}

export async function createSession(env: Env, user: string): Promise<string> {
  const token = randomHex(32)
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC
  await env.LINKDL_KV.put(
    sessionKey(token),
    JSON.stringify({ user, exp } satisfies SessionRecord),
    { expirationTtl: SESSION_TTL_SEC },
  )
  return token
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.LINKDL_KV.delete(sessionKey(token))
}

export function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export async function getSessionUser(env: Env, request: Request): Promise<string | null> {
  const token = parseCookie(request, COOKIE_NAME)
  if (!token) return null
  const raw = await env.LINKDL_KV.get(sessionKey(token))
  if (!raw) return null
  const session = JSON.parse(raw) as SessionRecord
  if (session.exp < Math.floor(Date.now() / 1000)) {
    await destroySession(env, token)
    return null
  }
  return session.user
}

export function sessionCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function getCookieToken(request: Request): string | null {
  return parseCookie(request, COOKIE_NAME)
}

export { BOOTSTRAP_USER }
