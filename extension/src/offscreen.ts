// Offscreen document (Chrome 전용) — service worker에 없는 DOM/Blob 기능 대행.
// DASH 파싱(DOMParser)과 세그먼트 재조합(OPFS/createObjectURL)을 수행.
// 실제 로직은 컨텍스트 중립 모듈(core/dash, assemble-store)에 있고 여기선 메시지 어댑터.
import { api } from './env'
import { assembleToBlobUrl, revokeBlobUrl } from './assemble-store'
import { parseDash } from './core/dash'
import type { AssemblePlan } from './core/remux'

type Msg =
  | { target: 'offscreen'; kind: 'parse-dash'; xml: string; base: string }
  | { target: 'offscreen'; kind: 'assemble'; plan: AssemblePlan; jobId?: string }
  | { target: 'offscreen'; kind: 'cancel'; jobId: string }
  | { target: 'offscreen'; kind: 'revoke'; blobUrl: string }

const controllers = new Map<string, AbortController>()

api.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return

  if (msg.kind === 'parse-dash') {
    try {
      reply({ ok: true, model: parseDash(msg.xml, msg.base) })
    } catch (e) {
      reply({ ok: false, error: (e as Error).message })
    }
    return true
  }

  if (msg.kind === 'assemble') {
    const ac = new AbortController()
    if (msg.jobId) controllers.set(msg.jobId, ac)
    const onProgress = (done: number, total: number, bytes: number) =>
      void api.runtime.sendMessage({ type: 'dl-progress', jobId: msg.jobId, done, total, bytes })
    assembleToBlobUrl(msg.plan, { onProgress, signal: ac.signal })
      .then(({ blobUrl, size }) => reply({ ok: true, blobUrl, size }))
      .catch((e) => reply({ ok: false, error: (e as Error).message, aborted: (e as Error).name === 'AbortError' }))
      .finally(() => {
        if (msg.jobId) controllers.delete(msg.jobId)
      })
    return true
  }

  if (msg.kind === 'cancel') {
    controllers.get(msg.jobId)?.abort()
    reply({ ok: true })
    return true
  }

  if (msg.kind === 'revoke') {
    revokeBlobUrl(msg.blobUrl)
      .then(() => reply({ ok: true }))
      .catch(() => reply({ ok: false }))
    return true
  }

  return false
})
