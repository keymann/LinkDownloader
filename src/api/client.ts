// 백엔드 /api 호출 래퍼. 세션 쿠키 기반이므로 credentials: 'include'.
import type { ExtractResult, HistoryItem } from '../types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error((data.error as string) || `요청 실패 (${res.status})`)
  return data as T
}

export const api = {
  session: () => req<{ user: string | null }>('/api/session'),

  login: (username: string, password: string) =>
    req<{ user: string }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => req<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  extract: (url: string) =>
    req<ExtractResult>('/api/extract', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  hls: (url: string) =>
    req<{ segments: string[] }>(`/api/hls?url=${encodeURIComponent(url)}`),

  getHistory: () => req<{ items: HistoryItem[] }>('/api/history'),

  addHistory: (item: Partial<HistoryItem>) =>
    req<{ item: HistoryItem }>('/api/history', {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  deleteHistory: (id?: string) =>
    req<{ ok: boolean }>(`/api/history${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
      method: 'DELETE',
    }),
}

// 프록시 URL(다운로드/세그먼트 스트리밍)
export const proxyUrl = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`
