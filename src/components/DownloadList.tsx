import { useDownloads } from '../download/DownloadContext'
import type { DownloadTask } from '../types'
import { formatBytes, formatDuration, formatSpeed } from '../utils/format'

function progressInfo(t: DownloadTask) {
  const elapsed = (Date.now() - t.startedAt) / 1000
  let percent: number | null = null
  let remaining: number | null = null
  if (t.segmentTotal) {
    percent = Math.round((t.segmentDone! / t.segmentTotal) * 100)
    if (t.segmentDone && t.segmentDone > 0) {
      const perSeg = elapsed / t.segmentDone
      remaining = perSeg * (t.segmentTotal - t.segmentDone)
    }
  } else if (t.totalBytes) {
    percent = Math.round((t.receivedBytes / t.totalBytes) * 100)
    if (t.bytesPerSec > 0) remaining = (t.totalBytes - t.receivedBytes) / t.bytesPerSec
  }
  return { elapsed, percent, remaining }
}

const STATUS_LABEL: Record<DownloadTask['status'], string> = {
  preparing: '준비 중',
  downloading: '다운로드 중',
  completed: '완료',
  canceled: '취소됨',
  failed: '실패',
}

export function DownloadList() {
  const { tasks, cancel, remove } = useDownloads()
  if (tasks.length === 0) return null

  return (
    <section className="dl-list">
      <h2 className="section-title">다운로드</h2>
      {tasks.map((t) => {
        const { elapsed, percent, remaining } = progressInfo(t)
        const active = t.status === 'downloading'
        return (
          <div key={t.id} className={`dl-item status-${t.status}`}>
            {t.thumbnail ? (
              <img className="dl-thumb" src={t.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="dl-thumb placeholder">🎬</div>
            )}
            <div className="dl-main">
              <div className="dl-row">
                <span className="dl-title" title={t.title}>{t.title}</span>
                <span className={`badge badge-${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${percent ?? (active ? 100 : 0)}%` }}
                  data-indeterminate={percent == null && active}
                />
              </div>
              <div className="dl-meta">
                <span>{percent != null ? `${percent}%` : active ? '진행 중' : ''}</span>
                <span>
                  {t.segmentTotal
                    ? `세그먼트 ${t.segmentDone ?? 0}/${t.segmentTotal}`
                    : `${formatBytes(t.receivedBytes)}${t.totalBytes ? ` / ${formatBytes(t.totalBytes)}` : ''}`}
                </span>
                {active && <span>{formatSpeed(t.bytesPerSec)}</span>}
                {active && (
                  <span>
                    {formatDuration(elapsed)} / {remaining != null ? `-${formatDuration(remaining)}` : '남은시간 계산 중'}
                  </span>
                )}
                {t.status === 'failed' && t.error && <span className="err">{t.error}</span>}
              </div>
            </div>
            <div className="dl-actions">
              {active ? (
                <button className="btn btn-sm btn-danger" onClick={() => cancel(t.id)}>
                  취소
                </button>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => remove(t.id)}>
                  지우기
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
