// 세그먼트 재조합 — docs/research/11-segment-remux.md 구현.
// 기본: concat(무손실·스트리밍). remux(표준 mp4/트랙 병합)는 옵트인 스텁(ffmpeg.wasm 지연 로드).
// transcode·복호화·우회 없음.
import type { SegmentRef } from './types'

export type AssemblePlan =
  | { mode: 'progressive'; url: string }
  | { mode: 'fmp4-concat'; init?: SegmentRef; media: SegmentRef[] }
  | { mode: 'ts-concat'; media: SegmentRef[] }
  | {
      mode: 'separate-tracks'
      tracks: { kind: 'video' | 'audio'; init?: SegmentRef; media: SegmentRef[] }[]
    }

export interface AssembleOpts {
  fetchImpl?: typeof fetch
  onProgress?: (done: number, total: number, bytes: number) => void
  signal?: AbortSignal
  concurrency?: number
}

function rangeHeader(r?: SegmentRef['byteRange']): HeadersInit | undefined {
  return r ? { Range: `bytes=${r.offset}-${r.offset + r.length - 1}` } : undefined
}

async function fetchSeg(seg: SegmentRef, opts: AssembleOpts): Promise<Uint8Array> {
  const f = opts.fetchImpl ?? fetch
  const res = await f(seg.url, { headers: rangeHeader(seg.byteRange), signal: opts.signal })
  if (!res.ok && res.status !== 206) throw new Error(`세그먼트 실패 ${res.status}: ${seg.url}`)
  return new Uint8Array(await res.arrayBuffer())
}

// 제한 동시성으로 순서 보존 수집 (docs/research/07 §7.3)
async function boundedFetch(segs: SegmentRef[], opts: AssembleOpts): Promise<Uint8Array[]> {
  const limit = Math.max(1, opts.concurrency ?? 5)
  const out = new Array<Uint8Array>(segs.length)
  let idx = 0
  let bytes = 0
  let done = 0
  const worker = async () => {
    while (idx < segs.length) {
      const i = idx++
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      out[i] = await fetchSeg(segs[i], opts)
      bytes += out[i].byteLength
      done += 1
      opts.onProgress?.(done, segs.length, bytes)
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return out
}

function concat(parts: Uint8Array[]): Blob {
  return new Blob(parts as BlobPart[])
}

// 기본 경로: concat → Blob 반환(대용량은 스트리밍 저장 권장, 11 §5 참조)
export async function assemble(plan: AssemblePlan, opts: AssembleOpts = {}): Promise<Blob> {
  switch (plan.mode) {
    case 'progressive': {
      const res = await (opts.fetchImpl ?? fetch)(plan.url, { signal: opts.signal })
      return await res.blob()
    }
    case 'fmp4-concat': {
      const list = plan.init ? [plan.init, ...plan.media] : plan.media
      return concat(await boundedFetch(list, opts))
    }
    case 'ts-concat': {
      return concat(await boundedFetch(plan.media, opts))
    }
    case 'separate-tracks': {
      // 기본은 트랙별 분리 저장 권고 → 여기서는 첫(비디오) 트랙만 concat 반환.
      // 단일 파일 병합이 필요하면 remux()(ffmpeg.wasm) 사용.
      const t = plan.tracks[0]
      const list = t.init ? [t.init, ...t.media] : t.media
      return concat(await boundedFetch(list, opts))
    }
  }
}

// 옵트인 remux (표준 MP4/트랙 병합). ffmpeg.wasm 지연 로드 스텁.
export async function remux(_plan: AssemblePlan, _target: 'mp4', _opts: AssembleOpts = {}): Promise<Uint8Array> {
  // 구현 지침(11 §4): ffmpeg.wasm을 동적 import → -c copy 로 컨테이너만 변경(재인코딩 없음).
  //   ts→mp4:  ['-i','in.ts','-c','copy','-movflags','+faststart','out.mp4']
  //   av 병합: ['-i','v.mp4','-i','a.mp4','-c','copy','muxed.mp4']
  // 큰 wasm/메모리 → 사용자 옵트인 + 크기 상한 필수.
  throw new Error('remux(ffmpeg.wasm)는 옵트인 기능입니다. docs/research/11-segment-remux.md §4 참조.')
}
