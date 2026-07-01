import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { HistoryItem } from '../types'
import { formatBytes, formatDateGroup, formatTime } from '../utils/format'

const STATUS_LABEL: Record<HistoryItem['status'], string> = {
  started: '진행',
  completed: '완료',
  canceled: '취소',
  failed: '실패',
}

export function History() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.getHistory()
      setItems(r.items)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // 날짜별 그룹화(최신 날짜 우선)
  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>()
    for (const it of [...items].sort((a, b) => b.ts - a.ts)) {
      const key = formatDateGroup(it.ts)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return [...map.entries()]
  }, [items])

  const redownload = (url: string) => {
    navigate('/', { state: { redownloadUrl: url } })
  }

  const removeOne = async (id: string) => {
    await api.deleteHistory(id).catch(() => {})
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const clearAll = async () => {
    if (!confirm('모든 히스토리를 삭제할까요?')) return
    await api.deleteHistory().catch(() => {})
    setItems([])
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">히스토리</h1>
        {items.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={clearAll}>
            전체 삭제
          </button>
        )}
      </div>

      {error && <div className="alert">{error}</div>}
      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>아직 다운로드 기록이 없습니다.</p>
        </div>
      ) : (
        groups.map(([date, list]) => (
          <section key={date} className="history-group">
            <h2 className="section-title">{date}</h2>
            {list.map((it) => (
              <div key={it.id} className="history-item">
                {it.thumbnail ? (
                  <img className="dl-thumb" src={it.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="dl-thumb placeholder">🎬</div>
                )}
                <div className="dl-main">
                  <div className="dl-row">
                    <span className="dl-title" title={it.title}>{it.title}</span>
                    <span className={`badge badge-${it.status === 'completed' ? 'completed' : it.status === 'failed' ? 'failed' : it.status === 'canceled' ? 'canceled' : 'downloading'}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                  </div>
                  <div className="dl-meta">
                    <span className="url-ellipsis" title={it.url}>{it.url}</span>
                    <span>{formatTime(it.ts)}</span>
                    {it.size != null && <span>{formatBytes(it.size)}</span>}
                  </div>
                </div>
                <div className="dl-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => redownload(it.url)}>
                    다시 다운로드
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removeOne(it.id)}>
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
