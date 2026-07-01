import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { formatBuildTime } from '../utils/format'

export function Settings() {
  const { user, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (next !== confirm) {
      setMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setMsg({ type: 'ok', text: '비밀번호가 변경되었습니다.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">설정</h1>

      <section className="card">
        <h2 className="section-title">계정</h2>
        <p className="muted">
          로그인 사용자: <strong>{user}</strong>
        </p>
        <button className="btn btn-ghost" onClick={() => logout()}>
          로그아웃
        </button>
      </section>

      <section className="card">
        <h2 className="section-title">비밀번호 변경</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label className="field-label">현재 비밀번호</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label className="field-label">새 비밀번호 (6자 이상)</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field">
            <label className="field-label">새 비밀번호 확인</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {msg && <div className={msg.type === 'ok' ? 'alert alert-ok' : 'alert'}>{msg.text}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy || !current || !next}>
            {busy ? '변경 중…' : '비밀번호 변경'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">버전</h2>
        <p className="muted">배포 시각</p>
        <p className="version">{formatBuildTime(__BUILD_TIME__)}</p>
      </section>
    </div>
  )
}
