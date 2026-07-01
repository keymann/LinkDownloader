// 코덱/MIME 매칭 유틸 — MSE appendBuffer mime ↔ 매니페스트 variant codecs 대조.
// 상관(correlate)의 과결합 방지에 사용. docs/research/01 §3.
import type { Variant } from './types'

// 'avc1.4d401f' → 'avc1', 'hev1.1.6.L93.B0' → 'hev1', 'mp4a.40.2' → 'mp4a', 'opus' → 'opus'
export function codecFamily(codec: string): string {
  return codec.trim().toLowerCase().split('.')[0]
}

// 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"' → { container:'mp4', codecs:['avc1.4d401f','mp4a.40.2'] }
export function parseMimeCodecs(mime: string): { container?: string; codecs: string[] } {
  const container = mime.split(';')[0].trim().split('/')[1]?.toLowerCase()
  const m = mime.match(/codecs\s*=\s*"?([^"]*)"?/i)
  const codecs = m ? m[1].split(',').map((c) => c.trim()).filter(Boolean) : []
  return { container, codecs }
}

// 여러 mime 문자열에서 코덱 패밀리 집합 추출
export function familiesFromMimes(mimes: string[]): Set<string> {
  const out = new Set<string>()
  for (const mime of mimes) for (const c of parseMimeCodecs(mime).codecs) out.add(codecFamily(c))
  return out
}

// 매니페스트 variant들의 codecs에서 패밀리 집합 추출
export function familiesFromVariants(variants: Variant[]): Set<string> {
  const out = new Set<string>()
  for (const v of variants) {
    if (!v.codecs) continue
    for (const c of v.codecs.split(',')) if (c.trim()) out.add(codecFamily(c))
  }
  return out
}

export function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}
