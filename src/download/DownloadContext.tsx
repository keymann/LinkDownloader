// 진행 중인 다운로드 태스크를 관리하는 컨텍스트. 메인 화면의 진행 리스트가 이를 구독한다.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { DownloadTask, ExtractResult, VideoSource } from '../types'
import { CanceledError, runFileDownload, runHlsDownload, type Progress } from './engine'
import { blobTarget, pickFileTarget, suggestFileName, supportsFilePicker, type SaveTarget } from './fsAccess'

interface StartOptions {
  chooseLocation: boolean // FS Access 로 저장 위치 선택 여부
}

interface DownloadContextValue {
  tasks: DownloadTask[]
  startDownload: (meta: ExtractResult, source: VideoSource, opts: StartOptions) => Promise<void>
  cancel: (id: string) => void
  remove: (id: string) => void
  supportsLocationPicker: boolean
}

const Ctx = createContext<DownloadContextValue | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const controllers = useRef<Map<string, AbortController>>(new Map())

  const patch = useCallback((id: string, updates: Partial<DownloadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
  }, [])

  const startDownload = useCallback(
    async (meta: ExtractResult, source: VideoSource, opts: StartOptions) => {
      const id = crypto.randomUUID()
      const isHls = source.kind === 'hls'
      const fileName = suggestFileName(meta.title, source.contentType, source.url, isHls)

      // 저장 대상 준비(경로 선택 or fallback)
      let target: SaveTarget | null = null
      if (opts.chooseLocation && supportsFilePicker()) {
        target = await pickFileTarget(fileName)
        if (!target) return // 사용자가 저장 위치 선택을 취소
      } else {
        target = blobTarget(fileName)
      }

      const controller = new AbortController()
      controllers.current.set(id, controller)

      const task: DownloadTask = {
        id,
        pageUrl: meta.pageUrl,
        title: meta.title,
        thumbnail: meta.thumbnail,
        source,
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: source.size,
        startedAt: Date.now(),
        bytesPerSec: 0,
      }
      setTasks((prev) => [task, ...prev])

      // 히스토리에 '시작' 기록(요구사항 6)
      api
        .addHistory({
          id,
          url: meta.pageUrl,
          title: meta.title,
          thumbnail: meta.thumbnail,
          size: source.size,
          status: 'started',
          ts: task.startedAt,
        })
        .catch(() => {})

      const onProgress = (p: Progress) => {
        const elapsed = (Date.now() - task.startedAt) / 1000
        const bps = elapsed > 0 ? p.receivedBytes / elapsed : 0
        patch(id, {
          receivedBytes: p.receivedBytes,
          totalBytes: p.totalBytes ?? task.totalBytes,
          bytesPerSec: bps,
          segmentDone: p.segmentDone,
          segmentTotal: p.segmentTotal,
        })
      }

      try {
        if (isHls) await runHlsDownload(source, target, controller.signal, onProgress)
        else await runFileDownload(source, target, controller.signal, onProgress)
        patch(id, { status: 'completed' })
        api.addHistory({ id, url: meta.pageUrl, title: meta.title, thumbnail: meta.thumbnail, size: source.size, status: 'completed', ts: task.startedAt }).catch(() => {})
      } catch (e) {
        if (e instanceof CanceledError || controller.signal.aborted) {
          patch(id, { status: 'canceled' })
          api.addHistory({ id, url: meta.pageUrl, title: meta.title, thumbnail: meta.thumbnail, size: source.size, status: 'canceled', ts: task.startedAt }).catch(() => {})
        } else {
          patch(id, { status: 'failed', error: (e as Error).message })
          api.addHistory({ id, url: meta.pageUrl, title: meta.title, thumbnail: meta.thumbnail, size: source.size, status: 'failed', ts: task.startedAt }).catch(() => {})
        }
      } finally {
        controllers.current.delete(id)
      }
    },
    [patch],
  )

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
  }, [])

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <Ctx.Provider
      value={{ tasks, startDownload, cancel, remove, supportsLocationPicker: supportsFilePicker() }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useDownloads(): DownloadContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider')
  return ctx
}
