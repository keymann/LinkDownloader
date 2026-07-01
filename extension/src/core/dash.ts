// DASH(.mpd) 파서 — docs/research/09-parser-spec.md §2 구현.
// XML 파싱에 DOMParser 사용 → content script / offscreen document 컨텍스트에서 실행할 것.
// (MV3 service worker에는 DOMParser가 없으므로 background는 offscreen에 위임 — background.ts 주석 참조.)
import type { ManifestModel, Variant } from './types'

function resolve(uri: string, base: string): string {
  try {
    return new URL(uri || '', base).href
  } catch {
    return uri
  }
}

// $Number$/$Time$/$RepresentationID$/$Bandwidth$/$$ + %0Nd 포맷 치환
function subst(pattern: string, vars: Record<string, number | string>): string {
  return pattern.replace(/\$(\$)|\$(\w+)(%0\d+d)?\$/g, (_all, dollar, key, fmt) => {
    if (dollar) return '$'
    const val = vars[key]
    if (val === undefined) return ''
    if (fmt) {
      const width = parseInt(fmt.slice(2, -1), 10)
      return String(val).padStart(width, '0')
    }
    return String(val)
  })
}

function schemeIds(el: Element): string[] {
  return Array.from(el.querySelectorAll('ContentProtection')).map(
    (c) => c.getAttribute('schemeIdUri') || '',
  )
}

export function parseDash(xml: string, baseUrl: string): ManifestModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const mpd = doc.querySelector('MPD')
  if (!mpd) throw new Error('DASH: <MPD> 없음')

  const m: ManifestModel = {
    protocol: 'dash',
    isMaster: false,
    isLive: mpd.getAttribute('type') === 'dynamic',
    baseUrl,
    hasEncryption: false,
    variants: [],
    warnings: [],
  }
  // fail-closed: 문서 어느 레벨이든 ContentProtection이 하나라도 있으면 암호화로 간주(09 §3).
  const allCP = Array.from(doc.querySelectorAll('ContentProtection'))
  if (allCP.length) {
    m.hasEncryption = true
    m.encryptionInfo = {
      source: 'dash-contentprotection',
      systemIds: allCP.map((c) => c.getAttribute('schemeIdUri') || '').filter(Boolean),
    }
  }

  const mpdBase = resolve(mpd.querySelector(':scope > BaseURL')?.textContent ?? '', baseUrl)

  for (const period of Array.from(mpd.querySelectorAll(':scope > Period'))) {
    const pBase = resolve(period.querySelector(':scope > BaseURL')?.textContent ?? '', mpdBase)
    for (const as_ of Array.from(period.querySelectorAll(':scope > AdaptationSet'))) {
      const asBase = resolve(as_.querySelector(':scope > BaseURL')?.textContent ?? '', pBase)
      const asTemplate = as_.querySelector(':scope > SegmentTemplate')
      const asCP = schemeIds(as_)
      const contentType =
        as_.getAttribute('contentType') || as_.getAttribute('mimeType')?.split('/')[0] || 'video'

      for (const rep of Array.from(as_.querySelectorAll(':scope > Representation'))) {
        const cp = [...asCP, ...schemeIds(rep)].filter(Boolean)
        if (cp.length) {
          m.hasEncryption = true
          m.encryptionInfo = { source: 'dash-contentprotection', systemIds: cp }
        }
        const repBase = resolve(rep.querySelector(':scope > BaseURL')?.textContent ?? '', asBase)
        const tmpl = rep.querySelector(':scope > SegmentTemplate') ?? asTemplate
        const v: Variant = {
          id: rep.getAttribute('id') || contentType,
          type: contentType === 'audio' ? 'audio' : contentType === 'text' ? 'subtitle' : 'video',
          bandwidth: rep.getAttribute('bandwidth') ? +rep.getAttribute('bandwidth')! : undefined,
          resolution:
            rep.getAttribute('width') && rep.getAttribute('height')
              ? { w: +rep.getAttribute('width')!, h: +rep.getAttribute('height')! }
              : undefined,
          codecs: rep.getAttribute('codecs') || as_.getAttribute('codecs') || undefined,
          segments: [],
        }
        if (tmpl) expandTemplate(v, tmpl, rep.getAttribute('id') || '', repBase, m)
        m.variants.push(v)
      }
    }
  }
  return m
}

function expandTemplate(
  v: Variant,
  tmpl: Element,
  repId: string,
  base: string,
  m: ManifestModel,
): void {
  const media = tmpl.getAttribute('media') || ''
  const init = tmpl.getAttribute('initialization')
  const timescale = +(tmpl.getAttribute('timescale') || '1')
  let number = +(tmpl.getAttribute('startNumber') || '1')

  if (init) {
    v.initSegment = { url: resolve(subst(init, { RepresentationID: repId }), base) }
  }

  const timeline = tmpl.querySelector('SegmentTimeline')
  if (timeline) {
    let time = 0
    for (const s of Array.from(timeline.querySelectorAll('S'))) {
      const t = s.getAttribute('t')
      const d = +(s.getAttribute('d') || '0')
      const r = +(s.getAttribute('r') || '0')
      if (t !== null) time = +t
      if (r < 0) {
        m.warnings.push('SegmentTimeline @r<0 (LIVE) — 확장 중단')
        m.isLive = true
        break
      }
      for (let k = 0; k <= r; k++) {
        const url = subst(media, { RepresentationID: repId, Number: number, Time: time })
        v.segments.push({
          url: resolve(url, base),
          seq: number,
          startTime: time / timescale,
          durationSec: d / timescale,
        })
        time += d
        number += 1
      }
    }
  } else {
    // @duration 기반 균등 분할 (총 길이가 필요 → warnings로 표시, 스캐폴드는 상한 적용)
    const dur = +(tmpl.getAttribute('duration') || '0')
    if (!dur) {
      m.warnings.push('SegmentTemplate: timeline/duration 없음 — 세그먼트 미확장')
      return
    }
    // 총 재생시간 미상 시 안전 상한(실사용은 MPD@mediaPresentationDuration으로 계산)
    m.warnings.push('duration 기반 확장은 총 길이 계산 필요(스캐폴드: 미확장/CONDITIONAL 권장)')
  }
}

export function segmentUrls(v: Variant): string[] {
  const out: string[] = []
  if (v.initSegment) out.push(v.initSegment.url)
  for (const s of v.segments) out.push(s.url)
  return out
}
