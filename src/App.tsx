import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { DownloadProvider } from './download/DownloadContext'
import { Nav } from './components/Nav'
import { Login } from './pages/Login'
import { Main } from './pages/Main'
import { History } from './pages/History'
import { Settings } from './pages/Settings'

function Shell() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="splash">
        <div className="login-logo">⚡</div>
        <p className="muted">불러오는 중…</p>
      </div>
    )
  }

  // 요구사항 2: 로그인한 사용자만 다음 페이지 접근
  if (!user) return <Login />

  return (
    <DownloadProvider>
      <div className="layout">
        <Nav />
        <main className="content">
          <Routes>
            <Route path="/" element={<Main />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </DownloadProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}
