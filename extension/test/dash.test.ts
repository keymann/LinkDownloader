// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseDash } from '../src/core/dash'

const MPD = `<?xml version="1.0"?>
<MPD type="static" mediaPresentationDuration="PT60S" xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period>
  <AdaptationSet contentType="video" mimeType="video/mp4">
   <SegmentTemplate initialization="init-$RepresentationID$.m4s" media="chunk-$RepresentationID$-$Number%05d$.m4s" timescale="1000" startNumber="1">
    <SegmentTimeline><S t="0" d="6000" r="2"/></SegmentTimeline>
   </SegmentTemplate>
   <Representation id="v0" bandwidth="5000000" width="1920" height="1080" codecs="avc1.4d401f"/>
  </AdaptationSet>
  <AdaptationSet contentType="audio" mimeType="audio/mp4">
   <SegmentTemplate initialization="ainit.m4s" media="a-$Number$.m4s" timescale="1000"><SegmentTimeline><S t="0" d="6000" r="2"/></SegmentTimeline></SegmentTemplate>
   <Representation id="a0" bandwidth="128000" codecs="mp4a.40.2"/>
  </AdaptationSet>
 </Period>
</MPD>`

describe('parseDash', () => {
  it('SegmentTemplate + Timeline expansion, %05d, RepresentationID', () => {
    const m = parseDash(MPD, 'https://cdn/dash/manifest.mpd')
    expect(m.isLive).toBe(false)
    expect(m.variants).toHaveLength(2)
    const v = m.variants[0]
    expect(v.initSegment?.url).toBe('https://cdn/dash/init-v0.m4s')
    expect(v.segments).toHaveLength(3) // S r=2 → 3
    expect(v.segments[0].url).toBe('https://cdn/dash/chunk-v0-00001.m4s')
    expect(v.segments[2].url).toBe('https://cdn/dash/chunk-v0-00003.m4s')
  })

  it('ContentProtection anywhere → hasEncryption', () => {
    const enc = MPD.replace('<Representation id="v0"', '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/><Representation id="v0"')
    expect(parseDash(enc, 'https://cdn/dash/m.mpd').hasEncryption).toBe(true)
  })

  it('type=dynamic → isLive', () => {
    expect(parseDash(MPD.replace('type="static"', 'type="dynamic"'), 'https://cdn/d/m.mpd').isLive).toBe(true)
  })

  it('throws without <MPD>', () => {
    expect(() => parseDash('<foo/>', 'https://cdn/x')).toThrow()
  })
})
