// 매니페스트 → 다운로드 계획(AssemblePlan) 변환 + HLS master→media 해석.
// docs/research/09(파서)·11(재조합). 암호화/LIVE는 여기서 걸러 던진다(fail-closed).
import { parseHls } from './hls'
import type { AssemblePlan } from './remux'
import type { ManifestModel, Variant } from './types'

export class IneligibleError extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = 'IneligibleError'
  }
}

// 최고 대역폭 비디오/muxed variant(세그먼트 보유) 선택
export function bestVideoVariant(m: ManifestModel): Variant | undefined {
  const withSegs = m.variants.filter((v) => v.segments.length > 0)
  const pool = withSegs.filter((v) => v.type === 'video' || v.type === 'muxed')
  const pick = (pool.length ? pool : withSegs).slice()
  pick.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
  return pick[0]
}

export function firstAudioVariant(m: ManifestModel): Variant | undefined {
  return m.variants.find((v) => v.type === 'audio' && v.segments.length > 0)
}

// 세그먼트 URL로 컨테이너 추정(fMP4 vs TS)
function isTs(v: Variant): boolean {
  if (v.initSegment) return false // init(EXT-X-MAP)이 있으면 fMP4
  return v.segments.some((s) => /\.ts(\?|#|$)/i.test(s.url))
}

// ManifestModel → AssemblePlan. 암호화/LIVE/소스없음은 IneligibleError.
export function planFromManifest(m: ManifestModel): AssemblePlan {
  if (m.hasEncryption) throw new IneligibleError('ENCRYPTED')
  if (m.isLive) throw new IneligibleError('LIVE')

  const video = bestVideoVariant(m)
  if (!video) throw new IneligibleError('NO_RESOLVABLE_SOURCE')

  const audio = firstAudioVariant(m)
  // 비디오/오디오가 분리된 경우(오디오 트랙 별도) → separate-tracks
  if (audio && video.type === 'video') {
    return {
      mode: 'separate-tracks',
      tracks: [
        { kind: 'video', init: video.initSegment, media: video.segments },
        { kind: 'audio', init: audio.initSegment, media: audio.segments },
      ],
    }
  }
  if (isTs(video)) return { mode: 'ts-concat', media: video.segments }
  return { mode: 'fmp4-concat', init: video.initSegment, media: video.segments }
}

// HLS master 라면 최고 화질 variant의 media playlist까지 해석해 반환.
export async function resolveHlsManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ManifestModel> {
  const text = await (await fetchImpl(url)).text()
  const m = parseHls(text, url)
  if (!m.isMaster) return m
  // master → 최고 대역폭 variant 선택 후 media playlist 2차 fetch
  const variants = m.variants
    .filter((v) => v.playlistUrl && (v.type === 'muxed' || v.type === 'video'))
    .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
  const chosen = variants[0] ?? m.variants.find((v) => v.playlistUrl)
  if (!chosen?.playlistUrl) throw new IneligibleError('NO_RESOLVABLE_SOURCE')
  const mediaText = await (await fetchImpl(chosen.playlistUrl)).text()
  const media = parseHls(mediaText, chosen.playlistUrl)
  // master 레벨 세션 암호화 신호 승계
  if (m.hasEncryption) {
    media.hasEncryption = true
    media.encryptionInfo = m.encryptionInfo
  }
  return media
}
