import { NavLink } from 'react-router-dom'

// 반응형 내비게이션: 모바일 = 하단 탭바, 태블릿/PC = 사이드바 (CSS로 전환)
const items = [
  { to: '/', label: '메인', icon: '⬇️', end: true },
  { to: '/history', label: '히스토리', icon: '🕘', end: false },
  { to: '/settings', label: '설정', icon: '⚙️', end: false },
]

export function Nav() {
  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="nav-logo">⚡</span>
        <span className="nav-title">Link Downloader</span>
      </div>
      <ul className="nav-list">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="nav-icon">{it.icon}</span>
              <span className="nav-label">{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
