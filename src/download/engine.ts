// 실제 다운로드 실행 엔진. 진행률 콜백 + AbortSignal 취소 지원.
import { api, proxyUrl } from '../api/client'
import type { SaveTarget } from './fsAccess'
import type { VideoSource } from '../types'

export interface Progress {
  receivedBytes: number
  totalBytes: number | null
  segmentDone?: number
  segmentTotal?: number
}

export class CanceledError extends Error {
  constructor() {
    super('취소됨')
    this.name = 'CanceledError'
  }
}

// 사전 예상 시간 계산을 위한 대역폭 측정. 최대 ~1MB 만 읽고 중단한다.
export async function probeBandwidth(url: string): Promise<number | null> {
  const controller = new AbortController()
  const PROBE_LIMIT = 1024 * 1024
  const start = performance.now()
  try {
    const res = await fetch(proxyUrl(url), {
      signal: controller.signal,
      headers: { Range: `bytes=0-${PROBE_LIMIT - 1}` },
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) received += value.byteLength
      if (received >= PROBE_LIMIT) {
        controller.abort()
        break
      }
    }
    const elapsed = (performance.now() - start) / 1000
    if (elapsed <= 0 || received === 0) return null
    return received / elapsed // bytes/sec
  } catch {
    return null
  }
}

// 단일 파일(mp4 등) 프록시 스트리밍 다운로드.
export async function runFileDownload(
  source: VideoSource,
  target: SaveTarget,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<void> {
  const res = await fetch(proxyUrl(source.url), { signal })
  if (!res.ok || !res.body) throw new Error(`다운로드 실패 (HTTP ${res.status})`)

  const lenHeader = res.headers.get('Content-Length')
  const totalBytes = lenHeader ? parseInt(lenHeader, 10) : source.size
  const reader = res.body.getReader()
  let received = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await target.write(value)
        received += value.byteLength
        onProgress({ receivedBytes: received, totalBytes })
      }
    }
    await target.close()
  } catch (e) {
    await target.abort()
    if (signal.aborted) throw new CanceledError()
    throw e
  }
}

// HLS: 세그먼트 목록을 받아 순차 다운로드 후 하나의 .ts 로 연결 저장.
export async function runHlsDownload(
  source: VideoSource,
  target: SaveTarget,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<void> {
  const { segments } = await api.hls(source.url)
  if (signal.aborted) throw new CanceledError()

  let received = 0
  try {
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new CanceledError()
      const res = await fetch(proxyUrl(segments[i]), { signal })
      if (!res.ok) throw new Error(`세그먼트 ${i + 1} 다운로드 실패 (HTTP ${res.status})`)
      const buf = new Uint8Array(await res.arrayBuffer())
      await target.write(buf)
      received += buf.byteLength
      onProgress({
        receivedBytes: received,
        totalBytes: null,
        segmentDone: i + 1,
        segmentTotal: segments.length,
      })
    }
    await target.close()
  } catch (e) {
    await target.abort()
    if (signal.aborted) throw new CanceledError()
    throw e
  }
}
