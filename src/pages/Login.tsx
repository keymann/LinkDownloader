import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

export function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">⚡</div>
        <h1>Link Downloader</h1>
        <p className="muted">로그인 후 이용할 수 있습니다.</p>

        <div className="field">
          <label className="field-label">아이디</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            placeholder="아이디"
          />
        </div>
        <div className="field">
          <label className="field-label">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="비밀번호"
          />
        </div>

        {error && <div className="alert">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}
