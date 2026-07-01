import { checkCredentials, setUserPassword, type Env } from '../lib/auth'
import { error, json } from '../lib/http'

// 요구사항 7: 비밀번호 변경. 라우터에서 인증된 사용자(user)만 도달한다.
export async function handleChangePassword(request: Request, env: Env, user: string): Promise<Response> {
  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await request.json()
  } catch {
    return error(400, '잘못된 요청입니다.')
  }
  const current = body.currentPassword || ''
  const next = body.newPassword || ''
  if (!current || !next) return error(400, '현재/새 비밀번호를 입력하세요.')
  if (next.length < 6) return error(400, '새 비밀번호는 6자 이상이어야 합니다.')

  const ok = await checkCredentials(env, user, current)
  if (!ok) return error(401, '현재 비밀번호가 올바르지 않습니다.')

  await setUserPassword(env, user, next)
  return json({ ok: true })
}
