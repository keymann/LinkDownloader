export type SourceKind = 'file' | 'hls' | 'dash'

export interface VideoSource {
  url: string
  kind: SourceKind
  label: string
  size: number | null
  contentType: string | null
}

export interface ExtractResult {
  pageUrl: string
  title: string
  thumbnail: string | null
  sources: VideoSource[]
}

export type DownloadStatus =
  | 'preparing'
  | 'downloading'
  | 'completed'
  | 'canceled'
  | 'failed'

export interface DownloadTask {
  id: string
  pageUrl: string
  title: string
  thumbnail: string | null
  source: VideoSource
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number | null
  startedAt: number
  bytesPerSec: number
  error?: string
  // 세그먼트(HLS) 진행 표시용
  segmentTotal?: number
  segmentDone?: number
}

export interface HistoryItem {
  id: string
  url: string
  title: string
  thumbnail: string | null
  size: number | null
  status: 'completed' | 'canceled' | 'failed' | 'started'
  ts: number
}
