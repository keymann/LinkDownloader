// MAIN world 후킹 — docs/research/10 §5. 관측 전용(call-through), 재생 무손상.
// 민감정보(쿠키/토큰) 수집 금지. 페이지와 동일 신뢰수준임에 유의.
import type { HookMessage } from './core/types'

;(() => {
  const KEY = '__mei'
  const send = (type: HookMessage['type'], data: unknown) =>
    window.postMessage({ [KEY]: true, type, data } as HookMessage, '*')

  // --- MSE ---
  const MS = (self as unknown as { MediaSource?: typeof MediaSource }).MediaSource
  if (MS) {
    const _addSB = MS.prototype.addSourceBuffer
    MS.prototype.addSourceBuffer = function (mime: string) {
      const sb = _addSB.call(this, mime) as SourceBuffer & { __mime?: string }
      sb.__mime = mime
      send('mse-sourcebuffer', { mime })
      return sb
    }
    const _append = (SourceBuffer.prototype as SourceBuffer).appendBuffer
    ;(SourceBuffer.prototype as SourceBuffer).appendBuffer = function (
      this: SourceBuffer & { __mime?: string },
      buf: BufferSource,
    ) {
      send('mse-append', { mime: this.__mime, bytes: (buf as ArrayBufferView).byteLength ?? 0 })
      return _append.call(this, buf as ArrayBuffer)
    }
  }

  // --- Blob / MediaSource URL ---
  const _create = URL.createObjectURL
  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = _create.call(URL, obj as Blob)
    const kind = MS && obj instanceof MS ? 'mediasource' : 'blob'
    send('object-url', {
      url,
      kind,
      size: (obj as Blob).size,
      type: (obj as Blob).type,
    })
    return url
  }

  // --- EME (탐지 전용 → INELIGIBLE 연계. 우회 아님) ---
  const _rmksa = navigator.requestMediaKeySystemAccess?.bind(navigator)
  if (_rmksa) {
    navigator.requestMediaKeySystemAccess = function (ks: string, cfg: MediaKeySystemConfiguration[]) {
      send('eme', { keySystem: ks })
      return _rmksa(ks, cfg)
    }
  }

  // --- fetch (미디어 URL 상관용, 본문 변조 없음) ---
  const _fetch = window.fetch
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    if (/\.(m3u8|mpd|m4s|ts|mp4|webm)(\?|$)/i.test(url)) send('media-fetch', { url })
    return _fetch.call(this, input, init)
  }
})()
