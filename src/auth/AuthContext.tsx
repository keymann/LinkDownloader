import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'

interface AuthContextValue {
  user: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 앱 시작 시 세션 확인(요구사항 3: 새로고침해도 로그인 유지)
  useEffect(() => {
    api
      .session()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const r = await api.login(username, password)
    setUser(r.user)
  }

  const logout = async () => {
    await api.logout().catch(() => {})
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
