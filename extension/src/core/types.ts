// 공유 코어 타입 — 브라우저 API 비의존(포트-어댑터: 확장/서버가 공유).
// docs/research/02-architecture.md, 09-parser-spec.md 참조.

export type SourceKind = 'file' | 'hls' | 'dash'
export type Container = 'mp4' | 'webm' | 'mov' | 'ts' | 'fmp4' | 'unknown'
export type TrackType = 'video' | 'audio' | 'subtitle' | 'muxed'

export interface SegmentRef {
  url: string
  seq?: number
  durationSec?: number
  byteRange?: { offset: number; length: number }
  startTime?: number
}

export interface Variant {
  id: string
  type: TrackType
  bandwidth?: number
  resolution?: { w: number; h: number }
  codecs?: string
  language?: string
  playlistUrl?: string // HLS master → media playlist (2차 fetch 필요)
  initSegment?: SegmentRef
  segments: SegmentRef[]
}

export interface EncryptionInfo {
  source: 'hls-key' | 'dash-contentprotection'
  method?: string
  systemIds?: string[]
}

export interface ManifestModel {
  protocol: SourceKind // 'hls' | 'dash'
  isMaster: boolean
  isLive: boolean
  baseUrl: string
  hasEncryption: boolean
  encryptionInfo?: EncryptionInfo
  variants: Variant[]
  durationSec?: number
  warnings: string[]
}

export interface MediaSignals {
  eme?: boolean
  encrypted?: boolean
  licenseServer?: string
  cors?: 'allow' | 'deny' | 'unknown'
  acceptRanges?: boolean
  isLive?: boolean
  mse?: boolean // MSE(blob)로 재생되는 스트림과 상관됨
}

export interface MediaCandidate {
  id: string
  origin: 'dom' | 'network' | 'mse' | 'blob' | 'performance'
  kind: SourceKind
  container?: Container
  url?: string
  pageUrl: string
  frameUrl?: string
  poster?: string | null
  bytes?: number | null
  headers?: Record<string, string>
  manifest?: ManifestModel
  signals: MediaSignals
  note?: string // UI 표시용 부가 설명(예: MSE/blob 상관 결과)
}

export type Verdict = 'ELIGIBLE' | 'CONDITIONAL' | 'INELIGIBLE' | 'SKIP'

export interface EligibilityResult {
  candidateId: string
  verdict: Verdict
  reason: string
}

// 진행 중 다운로드 작업(진행률 UI용). background가 소유, popup이 구독.
export interface DownloadJob {
  id: string
  tabId: number
  candidateId: string
  title: string
  phase: 'assembling' | 'downloading' | 'done' | 'error'
  done: number // 완료 세그먼트 수
  total: number // 전체 세그먼트 수
  bytes: number // 수신 바이트 누계
  error?: string
}

// content(MAIN)→background 메시지
export interface HookMessage {
  __mei: true
  type: 'mse-sourcebuffer' | 'mse-append' | 'object-url' | 'eme' | 'media-fetch' | 'dom-candidates'
  data: unknown
}
