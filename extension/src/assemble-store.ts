// DOM 기반 스트리밍 재조합 + blob 수명 관리(컨텍스트 중립).
// Chrome은 offscreen document에서, Firefox는 background(event page)에서 동일하게 사용.
// docs/research/11 §5.
import { assemble, assembleToWriter, type AssembleOpts, type AssemblePlan } from './core/remux'

// blobUrl → OPFS 파일명(null이면 메모리 Blob). 다운로드 완료/취소 후 정리.
const alive = new Map<string, string | null>()

function uid(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// OPFS로 스트리밍(상수 메모리). 미지원 시 메모리 Blob 폴백.
export async function assembleToBlobUrl(
  plan: AssemblePlan,
  opts: AssembleOpts = {},
): Promise<{ blobUrl: string; size: number }> {
  const getDir = navigator.storage?.getDirectory?.bind(navigator.storage)
  if (!getDir) {
    const blob = await assemble(plan, opts)
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
    await assembleToWriter(plan, (chunk) => writer.write(chunk as unknown as BufferSource), opts)
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
  const file = await handle.getFile() // 디스크 기반 File → createObjectURL은 지연 참조
  const url = URL.createObjectURL(file)
  alive.set(url, name)
  return { blobUrl: url, size: file.size }
}

export async function revokeBlobUrl(blobUrl: string): Promise<void> {
  if (!alive.has(blobUrl)) return
  const name = alive.get(blobUrl)!
  URL.revokeObjectURL(blobUrl)
  alive.delete(blobUrl)
  if (name && navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(name).catch(() => {})
  }
}
