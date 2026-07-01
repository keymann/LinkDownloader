// Offscreen document — docs/research/10 §6, 11 §5.
// service worker에 없는 기능 대행: (1) DOMParser(DASH), (2) Blob/OPFS 스트리밍 재조합.
import { parseDash } from './core/dash'
import { assemble, assembleToWriter, type AssemblePlan } from './core/remux'

type Msg =
  | { target: 'offscreen'; kind: 'parse-dash'; xml: string; base: string }
  | { target: 'offscreen'; kind: 'assemble'; plan: AssemblePlan; jobId?: string }
  | { target: 'offscreen'; kind: 'revoke'; blobUrl: string }

// blobUrl → OPFS 파일명(다운로드 완료 후 revoke + 파일 삭제로 정리)
const alive = new Map<string, string | null>()

function uid(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 재조합 진행률을 broadcast(background/popup 구독). jobId로 작업 식별.
function emitProgress(jobId: string | undefined, done: number, total: number, bytes: number): void {
  if (!jobId) return
  void chrome.runtime.sendMessage({ type: 'dl-progress', jobId, done, total, bytes })
}

// OPFS로 스트리밍 재조합(상수 메모리). 미지원 시 Blob 조립으로 폴백.
async function assembleStreaming(
  plan: AssemblePlan,
  jobId?: string,
): Promise<{ blobUrl: string; size: number }> {
  const onProgress = (done: number, total: number, bytes: number) => emitProgress(jobId, done, total, bytes)
  const getDir = navigator.storage?.getDirectory?.bind(navigator.storage)
  if (!getDir) {
    const blob = await assemble(plan, { onProgress }) // 폴백: 메모리 Blob
    const url = URL.createObjectURL(blob)
    alive.set(url, null)
    return { blobUrl: url, size: blob.size }
  }
  const name = `dl-${uid()}.part`
  const root = await getDir()
  const handle = await root.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  const writer = writable.getWriter()
  try {
    await assembleToWriter(plan, (chunk) => writer.write(chunk as unknown as BufferSource), { onProgress })
    await writer.close()
  } catch (e) {
    try {
      await writer.abort()
    } catch {
      /* ignore */
    }
    await root.removeEntry(name).catch(() => {})
    throw e
  }
  const file = await handle.getFile() // 디스크 기반 File → createObjectURL은 지연 참조(메모리 절약)
  const url = URL.createObjectURL(file)
  alive.set(url, name)
  return { blobUrl: url, size: file.size }
}

async function cleanup(blobUrl: string): Promise<void> {
  if (!alive.has(blobUrl)) return
  const name = alive.get(blobUrl)!
  URL.revokeObjectURL(blobUrl)
  alive.delete(blobUrl)
  if (name) {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(name).catch(() => {})
  }
}

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
    assembleStreaming(msg.plan, msg.jobId)
      .then(({ blobUrl, size }) => reply({ ok: true, blobUrl, size }))
      .catch((e) => reply({ ok: false, error: (e as Error).message }))
    return true
  }

  if (msg.kind === 'revoke') {
    cleanup(msg.blobUrl)
      .then(() => reply({ ok: true }))
      .catch(() => reply({ ok: false }))
    return true
  }

  return false
})
