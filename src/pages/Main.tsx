import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { DownloadDialog } from '../components/DownloadDialog'
import { DownloadList } from '../components/DownloadList'
import type { ExtractResult } from '../types'

export function Main() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExtractResult | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // 히스토리에서 "다시 다운로드"로 넘어온 경우 자동 분석
  useEffect(() => {
    const state = location.state as { redownloadUrl?: string } | null
    if (state?.redownloadUrl) {
      setUrl(state.redownloadUrl)
      navigate('.', { replace: true, state: null })
      void analyze(state.redownloadUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const analyze = async (target: string) => {
    const trimmed = target.trim()
    if (!trimmed) return
    setError('')
    setLoading(true)
    setResult(null)
    try {
      const r = await api.extract(trimmed)
      setResult(r)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void analyze(url)
  }

  return (
    <div className="page">
      <h1 className="page-title">동영상 다운로드</h1>
      <p className="muted">동영상이 포함된 웹페이지 URL 또는 동영상 파일 링크를 입력하세요.</p>

      <form className="url-form" onSubmit={submit}>
        <input
          className="url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/page 또는 https://.../video.mp4"
          inputMode="url"
          autoCapitalize="none"
        />
        <button className="btn btn-primary" type="submit" disabled={loading || !url.trim()}>
          {loading ? '분석 중…' : '분석'}
        </button>
      </form>

      {error && <div className="alert">{error}</div>}

      <DownloadList />

      <DownloadDialog result={result} onClose={() => setResult(null)} />
    </div>
  )
}
