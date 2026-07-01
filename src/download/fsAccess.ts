// 저장 대상 추상화.
// - File System Access API 지원(주로 Chromium 데스크톱): 사용자가 경로/파일명 선택 후 스트리밍 저장.
// - 미지원: 메모리에 청크를 모아 마지막에 앵커 다운로드(기본 다운로드 폴더).

export interface SaveTarget {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

function extForType(contentType: string | null, url: string): string {
  if (contentType?.includes('mp4')) return 'mp4'
  if (contentType?.includes('webm')) return 'webm'
  const m = url.match(/\.([a-z0-9]{2,4})(\?|#|$)/i)
  if (m) return m[1].toLowerCase()
  return 'mp4'
}

export function suggestFileName(title: string, contentType: string | null, url: string, isHls: boolean): string {
  const ext = isHls ? 'ts' : extForType(contentType, url)
  const base = (title || 'video')
    .replace(/[\\/:*?"<>|]+/g, '_')
    // 제목에 이미 동일 확장자가 있으면 중복 방지(예: "mov_bbb.mp4" → "mov_bbb")
    .replace(new RegExp(`\\.${ext}$`, 'i'), '')
    .slice(0, 80)
    .trim() || 'video'
  return `${base}.${ext}`
}

// FS Access 로 저장 위치를 선택한다. 사용자가 취소하면 null 반환.
export async function pickFileTarget(suggestedName: string): Promise<SaveTarget | null> {
  if (!supportsFilePicker()) return null
  let handle: FileSystemFileHandle
  try {
    handle = await window.showSaveFilePicker!({ suggestedName })
  } catch {
    return null // 사용자가 대화상자 취소
  }
  const writable = await handle.createWritable()
  return {
    // 캐스팅: 런타임 값은 항상 일반 ArrayBuffer 기반 Uint8Array
    write: (chunk) => writable.write(chunk as unknown as BufferSource),
    close: () => writable.close(),
    abort: async () => {
      try {
        await writable.close()
      } catch {
        /* ignore */
      }
    },
  }
}

// 메모리 누적 후 앵커 다운로드하는 fallback 저장 대상.
export function blobTarget(fileName: string): SaveTarget {
  const chunks: Uint8Array[] = []
  let aborted = false
  return {
    write: async (chunk) => {
      if (!aborted) chunks.push(chunk)
    },
    close: async () => {
      if (aborted) return
      const blob = new Blob(chunks as unknown as BlobPart[])
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    },
    abort: async () => {
      aborted = true
      chunks.length = 0
    },
  }
}
