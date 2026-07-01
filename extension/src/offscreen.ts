// Offscreen document — docs/research/10 §6. MV3 service worker에는 DOMParser가 없으므로
// DASH(MPD) XML 파싱을 DOMParser가 존재하는 이 컨텍스트에서 수행한다.
import { parseDash } from './core/dash'

interface ParseDashMsg {
  target: 'offscreen'
  kind: 'parse-dash'
  xml: string
  base: string
}

chrome.runtime.onMessage.addListener((msg: ParseDashMsg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return // 우리 대상이 아니면 무시
  if (msg.kind === 'parse-dash') {
    try {
      reply({ ok: true, model: parseDash(msg.xml, msg.base) })
    } catch (e) {
      reply({ ok: false, error: (e as Error).message })
    }
    return true // 비동기 응답 허용
  }
  return false
})
