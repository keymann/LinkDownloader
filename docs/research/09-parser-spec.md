# 09. Playlist Parser 상세 스펙 (HLS / DASH)

> [02-architecture](./02-architecture.md)의 **Playlist Parser** 모듈 상세. **비암호화 표준 스트림만** 대상이며,
> 암호화 신호(`#EXT-X-KEY`/`ContentProtection`/`cenc`)는 **추출해서 "불가 판정"에 넘기는 것**이 목적이다
> (복호화·우회 없음, [04-risk](./04-risk-analysis.md) fail-closed).

- 참조: HLS = RFC 8216(및 후속 draft), DASH = ISO/IEC 23009-1.
- 파서는 **관대하게 파싱, 보수적으로 판정**한다: 미지 태그는 무시하되, 판정에 필요한 신호가 불명확하면 CONDITIONAL/INELIGIBLE.

---

## 0. 공통 데이터 모델 (파서 산출물)

```
ManifestModel {
  protocol: 'hls' | 'dash'
  isMaster: boolean            # HLS 전용(멀티배리언트 여부)
  isLive: boolean              # HLS: ENDLIST 없음 / DASH: type="dynamic"
  baseUrl: string              # 상대경로 해석 기준
  hasEncryption: boolean       # 암호화 신호 존재(→ INELIGIBLE 트리거)
  encryptionInfo?: EncryptionInfo
  variants: Variant[]          # 화질/트랙 목록(master 또는 DASH Representation)
  durationSec?: number
  warnings: string[]           # 미지 태그·비표준 문법 로그
}

Variant {
  id: string
  type: 'video'|'audio'|'subtitle'|'muxed'
  bandwidth?: number
  resolution?: { w:number, h:number }
  codecs?: string
  playlistUrl?: string         # HLS master → media playlist URL
  initSegment?: SegmentRef     # fMP4 init (EXT-X-MAP / SegmentTemplate@initialization)
  segments: SegmentRef[]       # media playlist / DASH 확장 결과
  language?: string
}

SegmentRef {
  url: string
  seq?: number
  durationSec?: number
  byteRange?: { offset:number, length:number }   # EXT-X-BYTERANGE / DASH SegmentBase
  startTime?: number            # 타임라인 상 시작(초)
}

EncryptionInfo {
  source: 'hls-key' | 'dash-contentprotection'
  method?: string               # AES-128 / SAMPLE-AES / cenc / cbcs ...
  systemIds?: string[]          # DASH schemeIdUri(예: Widevine/PlayReady UUID)
}
```

> **원칙**: `hasEncryption === true`면 파서는 **세그먼트 URL을 확장하더라도 다운로드 대상으로 넘기지 않는다.**
> Eligibility가 즉시 INELIGIBLE 처리(§01 §6, §04).

---

## 1. HLS 파서

### 1.1 렉싱 규칙
- 라인 단위 처리. `#EXTM3U`로 시작해야 유효.
- `#EXT...` = 태그(콜론 뒤 속성/값), `#` 만 있는 라인 = 주석, 비어있지 않고 `#`로 시작 안 하면 = **URI 라인**.
- 속성 목록(attribute-list): `KEY=VALUE` 쉼표 구분. VALUE는 `"..."`(quoted-string), 정수, 열거형, `WxH`(해상도).
- 상대 URI는 `baseUrl` 기준 `new URL(uri, baseUrl)`.

### 1.2 태그 분류

| 태그 | 계층 | 파싱 대상 | 비고 |
|---|---|---|---|
| `#EXTM3U` | 공통 | 유효성 | 필수 첫 줄 |
| `#EXT-X-VERSION` | 공통 | 버전 | 문법 해석 힌트 |
| `#EXT-X-STREAM-INF` | master | BANDWIDTH, RESOLUTION, CODECS, AUDIO, 다음 줄 URI | variant(video/muxed) |
| `#EXT-X-MEDIA` | master | TYPE, URI, GROUP-ID, LANGUAGE, DEFAULT | audio/subtitle 렌디션 |
| `#EXT-X-I-FRAME-STREAM-INF` | master | (트릭플레이) | 다운로드 대상 아님(스킵/표시) |
| `#EXTINF` | media | duration, (title) | 다음 URI 라인이 세그먼트 |
| `#EXT-X-MAP` | media | URI, BYTERANGE | **fMP4 init 세그먼트**(필수 확보) |
| `#EXT-X-BYTERANGE` | media | length[@offset] | 세그먼트 부분범위 |
| `#EXT-X-KEY` | media | METHOD, URI, IV | **암호화 신호**(METHOD≠NONE → INELIGIBLE) |
| `#EXT-X-ENDLIST` | media | (존재) | VOD 확정. 없으면 LIVE |
| `#EXT-X-PLAYLIST-TYPE` | media | VOD/EVENT | VOD 힌트 |
| `#EXT-X-MEDIA-SEQUENCE` | media | 시작 seq | 세그먼트 번호 기준 |
| `#EXT-X-DISCONTINUITY` | media | (경계) | 타임라인/컨테이너 불연속 표시 |

### 1.3 master vs media 판별
```
if text.contains('#EXT-X-STREAM-INF') → master
else if text.contains('#EXTINF')      → media
else → 유효하지 않음(경고)
```

### 1.4 master 파싱 알고리즘
```
parseMaster(text, baseUrl):
  m = ManifestModel(protocol='hls', isMaster=true, baseUrl, variants=[], warnings=[])
  lines = splitLines(text)
  for i in range(len(lines)):
    line = trim(lines[i])
    if line.startsWith('#EXT-X-STREAM-INF'):
      attrs = parseAttrList(line.after(':'))
      uri = nextNonCommentLine(lines, i)           # 다음 URI 라인
      m.variants.push(Variant(
        id=uri, type='muxed',
        bandwidth=int(attrs.BANDWIDTH),
        resolution=parseRes(attrs.RESOLUTION),      # "1920x1080"
        codecs=attrs.CODECS,
        playlistUrl=resolve(uri, baseUrl)))
    elif line.startsWith('#EXT-X-MEDIA'):
      a = parseAttrList(line.after(':'))
      if a.URI: m.variants.push(Variant(
        id=a['GROUP-ID']+':'+a.NAME, type=mapType(a.TYPE),  # AUDIO/SUBTITLES
        language=a.LANGUAGE, playlistUrl=resolve(a.URI, baseUrl)))
    elif line.startsWith('#EXT-X-SESSION-KEY'):
      m.hasEncryption = true; m.encryptionInfo = readKey(line)   # 세션 레벨 암호화 신호
  return m
```
> master는 세그먼트를 직접 담지 않는다. **선택된 variant의 media playlist를 2차 fetch·파싱**해야 한다.

### 1.5 media 파싱 알고리즘 (핵심)
```
parseMedia(text, baseUrl):
  m = ManifestModel(protocol='hls', isMaster=false, baseUrl,
                    isLive=true, variants=[Variant(id='media', type='muxed', segments=[])])
  v = m.variants[0]
  cur = { byterangeCursor: 0 }
  pendingDuration = null
  pendingByteRange = null
  for line in splitLines(text):
    line = trim(line)
    if line == '' : continue
    if line.startsWith('#EXT-X-ENDLIST'): m.isLive = false
    elif line.startsWith('#EXT-X-KEY'):
      k = parseAttrList(line.after(':'))
      if upper(k.METHOD) != 'NONE':
        m.hasEncryption = true
        m.encryptionInfo = { source:'hls-key', method:k.METHOD }
        # 암호화 확정: 이후 세그먼트도 대상 아님(파싱은 계속하되 판정에서 차단)
    elif line.startsWith('#EXT-X-MAP'):
      a = parseAttrList(line.after(':'))
      v.initSegment = SegmentRef(url=resolve(a.URI, baseUrl),
                                 byteRange=parseByteRange(a.BYTERANGE))
    elif line.startsWith('#EXTINF'):
      pendingDuration = float(line.after(':').split(',')[0])
    elif line.startsWith('#EXT-X-BYTERANGE'):
      pendingByteRange = parseByteRange(line.after(':'), cur)   # length[@offset]
    elif line.startsWith('#'):
      continue                                   # 기타 태그 무시(경고 옵션)
    else:                                          # URI 라인 = 세그먼트
      v.segments.push(SegmentRef(
        url=resolve(line, baseUrl),
        durationSec=pendingDuration,
        byteRange=pendingByteRange))
      pendingDuration = null; pendingByteRange = null
  m.durationSec = sum(s.durationSec for s in v.segments)
  return m
```

### 1.6 BYTERANGE 처리
```
# "#EXT-X-BYTERANGE:LENGTH[@OFFSET]" — offset 생략 시 이전 세그먼트 끝에 이어짐
parseByteRange(str, cur):
  [len, off] = str.split('@')
  offset = off ? int(off) : cur.byterangeCursor
  cur.byterangeCursor = offset + int(len)
  return { offset, length: int(len) }
# 다운로드 시 Range: bytes=offset-(offset+length-1)
```

### 1.7 HLS 엣지 케이스
| 케이스 | 처리 |
|---|---|
| master인데 variant 0개 | 경고, 미디어로 재시도 실패 시 무효 |
| `#EXT-X-MAP` 없이 `.mp4` 세그먼트 | progressive fMP4 가능성 → 첫 세그먼트 자체가 init 포함일 수 있음, 경고 |
| `#EXT-X-DISCONTINUITY` | 재조합 시 컨테이너 경계 주의(트랜스코딩 없음 → 그대로 연결, 경고) |
| LIVE(ENDLIST 없음) | isLive=true → Eligibility에서 CONDITIONAL |
| 상대 URI + 리다이렉트된 baseUrl | 최종 URL 기준으로 baseUrl 갱신 후 해석 |
| BOM/CRLF/공백 | 렉서에서 정규화 |

---

## 2. DASH 파서 (MPD, XML)

### 2.1 구조 매핑
```
MPD(@type, @mediaPresentationDuration, @minBufferTime)
 └─ Period(@start, @duration)
     ├─ AdaptationSet(@mimeType, @contentType, @lang)
     │   ├─ ContentProtection(@schemeIdUri, ...)         ← 암호화 신호(있으면 INELIGIBLE)
     │   ├─ SegmentTemplate(@initialization,@media,@timescale,
     │   │                   @startNumber,@duration | SegmentTimeline)
     │   └─ Representation(@id,@bandwidth,@width,@height,@codecs)
     │       ├─ (선택) ContentProtection
     │       ├─ (선택) SegmentTemplate / SegmentList / SegmentBase
     │       └─ BaseURL?
     └─ AdaptationSet(audio) ...
```

### 2.2 파싱 알고리즘(개요)
```
parseDash(xml, baseUrl):
  doc = parseXml(xml)
  m = ManifestModel(protocol='dash', baseUrl, variants=[], warnings=[])
  m.isLive = (doc.MPD['@type'] == 'dynamic')
  mpdBase = resolve(doc.MPD.BaseURL ?? '', baseUrl)
  # 암호화: MPD/AdaptationSet/Representation 어느 레벨이든 ContentProtection이면 암호화로 간주
  for period in doc.MPD.Period:
    pBase = resolve(period.BaseURL ?? '', mpdBase)
    for as_ in period.AdaptationSet:
      asBase = resolve(as_.BaseURL ?? '', pBase)
      asCP = as_.ContentProtection
      asTemplate = as_.SegmentTemplate
      for rep in as_.Representation:
        cp = rep.ContentProtection ?? asCP
        if cp:
          m.hasEncryption = true
          m.encryptionInfo = { source:'dash-contentprotection',
                               systemIds: schemeIds(cp) }         # UUID 목록
        tmpl = rep.SegmentTemplate ?? asTemplate
        v = Variant(id=rep['@id'], type=mapContentType(as_),
                    bandwidth=int(rep['@bandwidth']),
                    resolution={w:rep['@width'], h:rep['@height']},
                    codecs=rep['@codecs'] ?? as_['@codecs'])
        if tmpl:
          expandTemplate(v, tmpl, rep, resolve(rep.BaseURL ?? '', asBase))
        elif rep.SegmentList:
          v.initSegment = ref(rep.SegmentList.Initialization, asBase)
          v.segments = [ref(u, asBase) for u in rep.SegmentList.SegmentURL]
        elif rep.SegmentBase:                              # single-file + index(byteRange)
          v.initSegment = byteRangeRef(rep.SegmentBase.Initialization, asBase)
          v.segments = [ single file, indexRange 기반 ]     # (인덱스 파싱 필요)
        m.variants.push(v)
  return m
```

### 2.3 SegmentTemplate 확장 (핵심)
치환 토큰: `$RepresentationID$`, `$Number$`, `$Time$`, `$Bandwidth$`, `$$`(리터럴 `$`).
포맷 지정자 `$Number%05d$` 지원(0패딩).

```
expandTemplate(v, tmpl, rep, base):
  init = tmpl['@initialization']
  media = tmpl['@media']
  ts = int(tmpl['@timescale'] ?? 1)
  v.initSegment = SegmentRef(url=resolve(subst(init, {RepresentationID:rep['@id']}), base))

  if tmpl.SegmentTimeline:                       # 명시적 타임라인
    number = int(tmpl['@startNumber'] ?? 1)
    time = 0
    for S in tmpl.SegmentTimeline.S:
      t = S['@t']; d = int(S['@d']); r = int(S['@r'] ?? 0)   # r=반복(추가횟수)
      if t != null: time = int(t)
      for k in range(r + 1):
        url = subst(media, {RepresentationID:rep['@id'], Number:number, Time:time})
        v.segments.push(SegmentRef(url=resolve(url, base),
                                   seq=number, startTime=time/ts, durationSec=d/ts))
        time += d; number += 1
  else:                                            # @duration 기반 균등 분할
    dur = int(tmpl['@duration']); number = int(tmpl['@startNumber'] ?? 1)
    total = mpdDurationSec(m) * ts
    count = ceil(total / dur)
    for i in range(count):
      time = i * dur
      url = subst(media, {RepresentationID:rep['@id'], Number:number+i, Time:time})
      v.segments.push(SegmentRef(url=resolve(url, base), seq=number+i,
                                 startTime=time/ts, durationSec=dur/ts))
```

```
subst(pattern, vars):
  # $$ → $, $Number%0Nd$ → zero-pad, $Time$/$RepresentationID$/$Bandwidth$ 치환
  return pattern.replace(/\$(\$)|\$(\w+)(%0\d+d)?\$/g, (m, dollar, key, fmt) =>
     dollar ? '$' : format(vars[key], fmt))
```

### 2.4 DASH 엣지 케이스
| 케이스 | 처리 |
|---|---|
| ContentProtection(어느 레벨이든) | hasEncryption=true → **세그먼트 확장하되 판정 차단** |
| `@type="dynamic"`(LIVE) | isLive=true → CONDITIONAL |
| video/audio가 별도 AdaptationSet | 분리 트랙 → 별도 Variant, 병합(mux) 없이 트랙별 저장/선택 안내 |
| SegmentTimeline `@r=-1` | (일부 LIVE) 무한 반복 → LIVE로 간주, 확장 중단 |
| SegmentBase(단일 파일 + sidx) | index range 파싱 필요, 미지원 시 CONDITIONAL |
| 다중 Period | Period별 세그먼트 이어붙임(불연속 경고) |
| xlink(외부 참조) | 원격 로드 필요; 미해석 시 경고+CONDITIONAL |

---

## 3. 암호화 신호 추출 (판정 연계)

```
detectEncryption(manifest):
  # HLS
  if hls and any(key.METHOD != 'NONE' for key in [#EXT-X-KEY, #EXT-X-SESSION-KEY]):
     return { encrypted:true, method:key.METHOD }
  # DASH
  if dash and exists(ContentProtection at MPD|AdaptationSet|Representation):
     return { encrypted:true, systemIds:[schemeIdUri...] }   # cenc / Widevine / PlayReady UUID
  return { encrypted:false }
```
| schemeIdUri (DASH) | 의미 |
|---|---|
| `urn:mpeg:dash:mp4protection:2011` (cenc) | 공통 암호화 → 암호화됨 |
| `urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` | Widevine |
| `urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95` | PlayReady |

> 위 신호 중 하나라도 있으면 파서는 `hasEncryption=true`로 표시하고, **다운로드 파이프라인은 진입 금지**.
> (복호화·키 취득·우회 로직은 **구현하지 않는다**.)

---

## 4. 파서 인터페이스 & 에러 처리

```
interface PlaylistParser {
  parseHls(text: string, baseUrl: string): ManifestModel
  parseDash(xml: string, baseUrl: string): ManifestModel
  parse(text: string, baseUrl: string, contentType?: string): ManifestModel  // 자동 판별
}
```
- 자동 판별: `contentType`/본문 첫 토큰(`#EXTM3U` vs `<MPD`)으로 분기.
- **에러 정책**: 치명(첫 토큰 불일치)→throw `ParseError`; 부분 실패(미지 태그/속성)→`warnings`에 누적 후 계속.
- **출력 검증**: variant≥1, ELIGIBLE 후보는 `segments.length>0`(또는 progressive면 단일 파일).

---

## 5. 테스트 벡터 (합성, [06-test](./06-test-strategy.md)와 연계)

| ID | 입력 | 기대 |
|---|---|---|
| HLS-1 | master(1080/720/audio) | variants=3, isMaster=true |
| HLS-2 | media(6 seg, ENDLIST) | segments=6, isLive=false, duration≈36 |
| HLS-3 | media + `#EXT-X-MAP`(fMP4) | initSegment 설정 |
| HLS-4 | media + `#EXT-X-BYTERANGE` | byteRange offset 누적 정확 |
| HLS-5 | media + `#EXT-X-KEY:METHOD=AES-128` | hasEncryption=true → INELIGIBLE |
| HLS-6 | media(ENDLIST 없음) | isLive=true → CONDITIONAL |
| DASH-1 | SegmentTemplate + `@duration` | count=ceil(dur/segdur) 세그먼트 |
| DASH-2 | SegmentTemplate + SegmentTimeline(t,d,r) | 반복 확장 정확, startTime 누적 |
| DASH-3 | `$Number%05d$` | 0패딩 URL |
| DASH-4 | ContentProtection(cenc) | hasEncryption=true → INELIGIBLE |
| DASH-5 | `@type=dynamic` | isLive=true → CONDITIONAL |
| DASH-6 | video/audio 분리 AdaptationSet | Variant 2개(트랙 분리) |
```
