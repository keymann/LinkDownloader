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

const KIND_BADGE: Record<VideoSource['kind'], string> = {
  file: 'MP4',
  hls: 'HLS',
  dash: 'DASH',
}

export function DownloadDialog({ result, onClose }: Props) {
  const { startDownload, supportsLocationPicker } = useDownloads()
  const [selected, setSelected] = useState(0)
  const [chooseLocation, setChooseLocation] = useState(supportsLocationPicker)
  const [eta, setEta] = useState<number | null>(null)
  const [probing, setProbing] = useState(false)

  const source = result?.sources[selected]
  const multiple = (result?.sources.length ?? 0) > 1

  useEffect(() => {
    setSelected(0)
    setEta(null)
  }, [result])

  // 사전 예상 시간: 파일형 소스에 한해 대역폭을 측정해 추정. 선택이 바뀌면 재측정.
  useEffect(() => {
    if (!result || !source || source.kind !== 'file' || !source.size) {
      setEta(null)
      return
    }
    let alive = true
    setProbing(true)
    setEta(null)
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

  const previewImg = source?.poster || result.thumbnail

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
          {/* 2개 이상이면 어떤 동영상을 받을지 선택하는 목록을 먼저 보여준다 */}
          {multiple && (
            <div className="candidates">
              <div className="candidates-head">
                이 페이지에서 <strong>{result.sources.length}개</strong>의 동영상을 찾았습니다. 다운로드할 항목을 선택하세요.
              </div>
              <ul className="candidate-list" role="radiogroup" aria-label="동영상 선택">
                {result.sources.map((s, i) => {
                  const active = i === selected
                  const img = s.poster || result.thumbnail
                  return (
                    <li key={s.url}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={active ? 'candidate active' : 'candidate'}
                        onClick={() => setSelected(i)}
                      >
                        {img ? (
                          <img className="candidate-thumb" src={img} alt="" loading="lazy" />
                        ) : (
                          <div className="candidate-thumb placeholder">🎬</div>
                        )}
                        <div className="candidate-info">
                          <div className="candidate-title">
                            <span className="radio-dot" aria-hidden="true" />
                            동영상 {i + 1}
                            <span className={`badge kind-${s.kind}`}>{KIND_BADGE[s.kind]}</span>
                          </div>
                          <div className="candidate-meta">
                            <span>{s.label}</span>
                            <span>{s.kind === 'file' ? formatBytes(s.size) : '스트림'}</span>
                          </div>
                          <div className="candidate-url" title={s.url}>{s.url}</div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* 선택된 동영상 요약(단일 동영상이면 이 영역만 표시) */}
          <div className="dialog-preview">
            {previewImg ? (
              <img className="dialog-thumb" src={previewImg} alt="" />
            ) : (
              <div className="dialog-thumb placeholder">🎬</div>
            )}
            <div className="dialog-info">
              <div className="dialog-name" title={result.title}>
                {multiple ? `선택: 동영상 ${selected + 1}` : result.title}
              </div>
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
