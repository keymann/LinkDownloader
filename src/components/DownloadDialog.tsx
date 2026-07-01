import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useDownloads } from '../download/DownloadContext'
import { probeBandwidth } from '../download/engine'
import type { ExtractResult, VideoSource } from '../types'
import { formatBytes, formatDuration } from '../utils/format'

interface Props {
  result: ExtractResult | null
  onClose: () => void
}

const KIND_LABEL: Record<VideoSource['kind'], string> = {
  file: '동영상 파일',
  hls: 'HLS 스트림 (.m3u8)',
  dash: 'DASH (.mpd)',
}

export function DownloadDialog({ result, onClose }: Props) {
  const { startDownload, supportsLocationPicker } = useDownloads()
  const [selected, setSelected] = useState(0)
  const [chooseLocation, setChooseLocation] = useState(supportsLocationPicker)
  const [eta, setEta] = useState<number | null>(null)
  const [probing, setProbing] = useState(false)

  const source = result?.sources[selected]

  useEffect(() => {
    setSelected(0)
    setEta(null)
  }, [result])

  // 사전 예상 시간: 파일형 소스에 한해 대역폭을 측정해 추정
  useEffect(() => {
    if (!result || !source || source.kind !== 'file' || !source.size) {
      setEta(null)
      return
    }
    let alive = true
    setProbing(true)
    probeBandwidth(source.url)
      .then((bps) => {
        if (alive && bps) setEta(source.size! / bps)
      })
      .finally(() => alive && setProbing(false))
    return () => {
      alive = false
    }
  }, [result, source])

  const hasSources = useMemo(() => (result?.sources.length ?? 0) > 0, [result])

  if (!result) return null

  const confirm = async () => {
    if (!source) return
    onClose()
    await startDownload(result, source, { chooseLocation })
  }

  const requestPersist = async () => {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist()
      alert(granted ? '저장 권한이 허용되었습니다.' : '브라우저가 저장 권한을 거부했습니다.')
    } else {
      alert('이 환경은 저장 권한 API를 지원하지 않습니다.')
    }
  }

  return (
    <Modal
      open={!!result}
      title="다운로드"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={!hasSources}>
            다운로드 시작
          </button>
        </>
      }
    >
      {!hasSources ? (
        <div className="empty">
          <p>이 페이지에서 다운로드 가능한 동영상을 찾지 못했습니다.</p>
          <p className="muted">
            YouTube·Instagram·TikTok 등 보호된 플랫폼은 지원되지 않습니다. 직접 동영상 파일 링크,
            HTML5 &lt;video&gt;, og:video, HLS(.m3u8) 등이 있는 페이지를 시도해 보세요.
          </p>
        </div>
      ) : (
        <>
          <div className="dialog-preview">
            {result.thumbnail ? (
              <img className="dialog-thumb" src={result.thumbnail} alt="" />
            ) : (
              <div className="dialog-thumb placeholder">🎬</div>
            )}
            <div className="dialog-info">
              <div className="dialog-name" title={result.title}>{result.title}</div>
              <div className="dialog-stats">
                <div>
                  <span className="muted">유형</span> {KIND_LABEL[source!.kind]}
                </div>
                <div>
                  <span className="muted">용량</span>{' '}
                  {source!.kind === 'file' ? formatBytes(source!.size) : '스트림 (사전 크기 미상)'}
                </div>
                <div>
                  <span className="muted">예상 시간</span>{' '}
                  {source!.kind !== 'file'
                    ? '스트림 — 시작 후 계산'
                    : probing
                      ? '측정 중…'
                      : eta != null
                        ? `약 ${formatDuration(eta)}`
                        : '측정 불가 (시작 후 표시)'}
                </div>
              </div>
            </div>
          </div>

          {result.sources.length > 1 && (
            <div className="field">
              <label className="field-label">소스 선택</label>
              <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
                {result.sources.map((s, i) => (
                  <option key={s.url} value={i}>
                    {KIND_LABEL[s.kind]} · {s.label}
                    {s.size ? ` · ${formatBytes(s.size)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            {supportsLocationPicker ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={chooseLocation}
                  onChange={(e) => setChooseLocation(e.target.checked)}
                />
                저장 위치 직접 선택 (지원 환경)
              </label>
            ) : (
              <p className="muted small">
                이 브라우저는 저장 위치 선택을 지원하지 않아 기본 다운로드 폴더에 저장됩니다.
              </p>
            )}
            <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={requestPersist}>
              저장 권한 요청
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
