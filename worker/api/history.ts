import type { Env } from '../lib/auth'
import { error, json } from '../lib/http'

// 요구사항 6: 다운로드 시도 히스토리. 사용자별 KV JSON 배열로 저장(최근 500개 캡).
const MAX_ITEMS = 500
const historyKey = (user: string) => `history:${user}`

export interface HistoryItem {
  id: string
  url: string
  title: string
  thumbnail: string | null
  size: number | null
  status: 'completed' | 'canceled' | 'failed' | 'started'
  ts: number
}

async function readHistory(env: Env, user: string): Promise<HistoryItem[]> {
  const raw = await env.LINKDL_KV.get(historyKey(user))
  return raw ? (JSON.parse(raw) as HistoryItem[]) : []
}

async function writeHistory(env: Env, user: string, items: HistoryItem[]): Promise<void> {
  await env.LINKDL_KV.put(historyKey(user), JSON.stringify(items.slice(0, MAX_ITEMS)))
}

export async function handleHistoryGet(_request: Request, env: Env, user: string): Promise<Response> {
  const items = await readHistory(env, user)
  return json({ items })
}

export async function handleHistoryPost(request: Request, env: Env, user: string): Promise<Response> {
  let body: Partial<HistoryItem>
  try {
    body = await request.json()
  } catch {
    return error(400, '잘못된 요청입니다.')
  }
  if (!body.url) return error(400, 'url 이 필요합니다.')

  const items = await readHistory(env, user)
  const item: HistoryItem = {
    id: body.id || crypto.randomUUID(),
    url: body.url,
    title: body.title || body.url,
    thumbnail: body.thumbnail ?? null,
    size: body.size ?? null,
    status: body.status || 'started',
    ts: body.ts || Date.now(),
  }
  // 같은 id 가 있으면 갱신(상태 업데이트), 없으면 앞에 추가
  const idx = items.findIndex((it) => it.id === item.id)
  if (idx >= 0) items[idx] = item
  else items.unshift(item)
  await writeHistory(env, user, items)
  return json({ item })
}

export async function handleHistoryDelete(request: Request, env: Env, user: string): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    // 전체 삭제
    await env.LINKDL_KV.delete(historyKey(user))
    return json({ ok: true, cleared: true })
  }
  const items = await readHistory(env, user)
  await writeHistory(env, user, items.filter((it) => it.id !== id))
  return json({ ok: true })
}
