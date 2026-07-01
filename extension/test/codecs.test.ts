import { describe, expect, it } from 'vitest'
import { codecFamily, familiesFromMimes, familiesFromVariants, intersects, parseMimeCodecs } from '../src/core/codecs'
import type { Variant } from '../src/core/types'

describe('codecs', () => {
  it('codecFamily strips profile', () => {
    expect(codecFamily('avc1.4d401f')).toBe('avc1')
    expect(codecFamily('hev1.1.6.L93.B0')).toBe('hev1')
    expect(codecFamily('mp4a.40.2')).toBe('mp4a')
    expect(codecFamily('opus')).toBe('opus')
    expect(codecFamily(' VP09.00.10.08 ')).toBe('vp09')
  })

  it('parseMimeCodecs extracts container + codecs', () => {
    expect(parseMimeCodecs('video/mp4; codecs="avc1.4d401f, mp4a.40.2"')).toEqual({
      container: 'mp4',
      codecs: ['avc1.4d401f', 'mp4a.40.2'],
    })
    expect(parseMimeCodecs('video/webm').codecs).toEqual([])
  })

  it('familiesFromMimes / familiesFromVariants', () => {
    expect([...familiesFromMimes(['video/mp4; codecs="avc1.4d401f,mp4a.40.2"'])].sort()).toEqual(['avc1', 'mp4a'])
    const vars: Variant[] = [{ id: 'v', type: 'muxed', codecs: 'avc1.4d401f,mp4a.40.2', segments: [] }]
    expect([...familiesFromVariants(vars)].sort()).toEqual(['avc1', 'mp4a'])
  })

  it('intersects', () => {
    expect(intersects(new Set(['avc1']), new Set(['avc1', 'opus']))).toBe(true)
    expect(intersects(new Set(['vp09']), new Set(['avc1']))).toBe(false)
  })
})
