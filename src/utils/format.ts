export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '알 수 없음'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '--:--'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '-'
  return `${formatBytes(bytesPerSec)}/s`
}

// KST 기준 배포 시각 (YYYY-MM-DD HH:mm:ss)
export function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}:${p(kst.getUTCSeconds())} (KST)`
  } catch {
    return iso
  }
}

// 히스토리 날짜 그룹 라벨 (YYYY년 M월 D일)
export function formatDateGroup(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
