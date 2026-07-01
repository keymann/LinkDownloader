// Offscreen document — docs/research/10 §6, 11 §5.
// service worker에 없는 두 기능을 대신한다: (1) DOMParser(DASH), (2) Blob/createObjectURL(세그먼트 재조합).
import { parseDash } from './core/dash'
import { assemble, type AssemblePlan } from './core/remux'

type Msg =
  | { target: 'offscreen'; kind: 'parse-dash'; xml: string; base: string }
  | { target: 'offscreen'; kind: 'assemble'; plan: AssemblePlan }
  | { target: 'offscreen'; kind: 'revoke'; blobUrl: string }

// blobUrl → 살아있는 Blob 참조(다운로드 완료까지 유지, revoke로 해제)
const alive = new Set<string>()

chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
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
    // fetch+concat → Blob → blobURL (host 권한 하에 CORS 우회 fetch 가능)
    assemble(msg.plan)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        alive.add(url)
        reply({ ok: true, blobUrl: url, size: blob.size })
      })
      .catch((e) => reply({ ok: false, error: (e as Error).message }))
    return true
  }

  if (msg.kind === 'revoke') {
    if (alive.has(msg.blobUrl)) {
      URL.revokeObjectURL(msg.blobUrl)
      alive.delete(msg.blobUrl)
    }
    reply({ ok: true })
    return true
  }

  return false
})
