# 01. 기술 리서치 보고서

> 준법 전제는 [README](./README.md) 참조. 암호화/DRM 콘텐츠는 "불가 판정" 기준만 다룬다.

전체 탐지 파이프라인은 **3계층 융합**이다. 어느 한 계층도 단독으로는 모든 동영상을 잡지 못한다.

```
            ┌───────────────────────────────────────────────┐
            │                  Target Page                   │
            └───────────────────────────────────────────────┘
                 │                │                  │
        ┌────────▼───────┐ ┌──────▼───────┐ ┌────────▼─────────┐
        │  (A) DOM 계층   │ │ (B) Network  │ │ (C) 런타임 후킹  │
        │ video/source/  │ │  요청/응답    │ │ MSE·Blob·fetch   │
        │ iframe/shadow  │ │  MIME/Header │ │  가로채기         │
        └────────┬───────┘ └──────┬───────┘ └────────┬─────────┘
                 └────────────────┼───────────────────┘
                          ┌───────▼────────┐
                          │  Media Detector │  (정규화 · 중복제거 · 상관)
                          └───────┬────────┘
                          ┌───────▼────────┐
                          │ Eligibility     │ (DRM/암호화/CORS/ToS 게이트)
                          └────────────────┘
```

---

## 1. HTML 분석

### 1.1 탐지 대상별 방법 · 장단점 · 예외 · 난이도

| 대상 | 탐지 방법 | 장점 | 단점/예외 | 난이도 |
|---|---|---|---|---|
| `<video>` | `document.querySelectorAll('video')`, `.currentSrc`, `.src` | 가장 직접적, `currentSrc`는 실제 선택된 소스 | `src`가 `blob:`/`mediasource:`면 원본 불명 → C계층 필요 | ★☆☆☆☆ |
| `<source>` | `video > source[src|type]` 순회 | 다중 화질/포맷 후보 확보 | 브라우저가 실제 고른 것은 `currentSrc`로만 확인 | ★☆☆☆☆ |
| `<iframe>` | `querySelectorAll('iframe')` 후 same-origin이면 `contentDocument` 재귀 | 임베드 플레이어 탐지 | **cross-origin은 DOM 접근 불가**(SOP) → Network/프레임 단위 처리 | ★★★☆☆ |
| `<embed>`/`<object>` | `embed[src]`, `object[data]` | 레거시/PDF/플래시 잔재 | 최신 동영상엔 드묾, 타입 확인 필요 | ★★☆☆☆ |
| Shadow DOM | 요소의 `.shadowRoot`(open) 재귀 탐색 | 웹컴포넌트 플레이어 대응 | **closed shadow root은 접근 불가**; 재귀 비용 | ★★★☆☆ |
| Lazy Loading | `IntersectionObserver` 또는 스크롤 유도 후 재스캔; `loading="lazy"`, `data-src` | 지연 삽입 미디어 포착 | 뷰포트 진입 전 미존재; 무한스크롤 종료 판단 필요 | ★★★☆☆ |
| 동적 생성 video | `MutationObserver`(subtree, childList) | 실시간 삽입 감지 | 대량 DOM 변경 시 노이즈/성능; 삽입 후 `src` 세팅 타이밍 분리 | ★★★★☆ |

### 1.2 Cross-origin iframe 처리 원칙

동일 출처(same-origin) iframe만 `contentDocument`로 내부를 읽을 수 있다. Cross-origin iframe은
**DOM으로 못 읽으므로**, (a) 자동화 환경에서 **프레임 단위로 각각 스캔**(Playwright `frame`),
(b) Network 계층에서 그 프레임이 발생시킨 미디어 요청으로 간접 탐지한다.

### 1.3 통합 DOM 스캔 의사코드

```
function scanDom(root=document):
    results = []
    # 1) 표준 미디어 요소
    for el in root.querySelectorAll('video, audio, source, embed, object'):
        results.push(normalizeElement(el))     # src/currentSrc/type/poster
    # 2) Shadow DOM (open) 재귀
    for el in root.querySelectorAll('*'):
        if el.shadowRoot:                       # closed면 null → skip
            results.push(...scanDom(el.shadowRoot))
    # 3) same-origin iframe 재귀
    for f in root.querySelectorAll('iframe'):
        try: results.push(...scanDom(f.contentDocument))   # cross-origin → throw → skip
        catch: markCrossOriginFrame(f.src)      # Network 계층에 위임
    return dedupe(results)

# 동적/지연 요소: 관찰자 등록
observer = new MutationObserver(muts => scanDom() for added subtrees)
observer.observe(document, {childList:true, subtree:true, attributes:true, attributeFilter:['src']})
```

**핵심 예외 정리**
- `src`가 `blob:`/`mediasource:` → §4/§3 참조(런타임 후킹 필요).
- `currentSrc`가 비어있고 재생 전이면 소스 미정 → 재생 트리거 또는 Network 상관.
- closed Shadow DOM · cross-origin iframe → DOM 불가, Network로 우회 탐지.

---

## 2. Network 분석

브라우저 네트워크 계층에서 미디어 요청/응답을 관찰하여 컨테이너·스트리밍 매니페스트를 식별한다.

### 2.1 포맷별 신호

| 포맷 | 확장자 | 대표 MIME | 판별 신호 |
|---|---|---|---|
| MP4 | `.mp4` | `video/mp4` | `ftyp` box, `Accept-Ranges: bytes` |
| WebM | `.webm` | `video/webm` | EBML 헤더(`0x1A45DFA3`) |
| MOV | `.mov` | `video/quicktime` | `ftyp qt ` |
| HLS(매니페스트) | `.m3u8` | `application/vnd.apple.mpegurl`, `application/x-mpegURL` | 본문 `#EXTM3U` |
| DASH(매니페스트) | `.mpd` | `application/dash+xml` | 본문 `<MPD>` |
| MPEG-TS 세그먼트 | `.ts` | `video/mp2t` | 188바이트 배수, sync `0x47` |
| fMP4 세그먼트 | `.m4s`/`.mp4` | `video/mp4`, `video/iso.segment` | `styp`/`moof`+`mdat` |

### 2.2 관찰해야 할 응답 메타데이터

| 항목 | 왜 중요한가 |
|---|---|
| **MIME Type** (`Content-Type`) | 1차 포맷 판별. 단, 서버가 `application/octet-stream`으로 줄 수 있어 매직바이트 병행 |
| **Header** | `Content-Length`(용량), `Content-Disposition`(파일명/attachment) |
| **Response 본문 앞부분** | 매직바이트/`#EXTM3U`/`<MPD>`로 확정 |
| **Redirect** (3xx `Location`) | 최종 미디어 URL은 리다이렉트 후 확정 → 체인 추적 필요 |
| **Range Request** (`Accept-Ranges: bytes`, `206`, `Content-Range`) | 부분 다운로드/재개 가능 여부 |
| **Cache-Control** | `no-store`는 저장 정책 신호일 수 있음(적격성 참고), 재사용성 판단 |
| **CORS** (`Access-Control-Allow-Origin`) | 브라우저 컨텍스트에서 fetch 저장 가능 여부(§6) |

### 2.3 CDP vs Playwright 접근 비교

| 관점 | Chrome DevTools Protocol (raw) | Playwright |
|---|---|---|
| 네트워크 이벤트 | `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` | `page.on('request'|'response'|'requestfinished')` |
| 응답 본문 | `Network.getResponseBody` (일부 미디어는 본문 비제공/스트리밍) | `response.body()` (동일 제약) |
| 요청 가로채기 | `Fetch.enable` + `Fetch.requestPaused` | `page.route()` |
| 매니페스트 파싱용 텍스트 취득 | `getResponseBody` 또는 재요청 | `response.text()` 또는 `request.response()` |
| 장점 | 저수준 완전 제어, 멀티타깃(프레임/워커) | 고수준 API, 자동 대기, 크로스브라우저 |
| 단점 | 장황·수동 상태관리, Chromium 전용 | 일부 저수준 이벤트 추상화로 가려짐 |
| 권장 용도 | 정밀 네트워크/후킹 계측 | 페이지 오케스트레이션·프레임 순회·스크립트 주입 |

> **실무 결론**: Playwright로 페이지를 몰고, 필요한 저수준 계측은 `page.context().newCDPSession(page)`로
> CDP를 병행한다(Playwright는 CDP 세션을 노출).

### 2.4 네트워크 상관 의사코드

```
onResponse(res):
    ct = res.headers['content-type']; url = res.url
    kind = classify(url, ct, sniff(res.firstBytes))     # mp4/webm/hls/dash/ts/fmp4
    if kind == 'hls' or kind == 'dash':
        manifest = parse(res.text())                    # §5
        registerStream(url, manifest)
    elif kind in ['mp4','webm','mov']:
        registerFile(url, {size: res.headers['content-length'],
                           ranges: res.headers['accept-ranges']=='bytes'})
    correlateWithDom(url)                                # §9 Media Detector
```

---

## 3. Media Source Extensions (MSE)

### 3.1 동작 원리

`<video>`의 `src`에 직접 파일 URL을 주는 대신, JS가 세그먼트를 **버퍼에 주입**해 재생한다.

```
JS ──fetch(segment)──> ArrayBuffer
        │
        ▼
 MediaSource  ──addSourceBuffer(mime)──> SourceBuffer
        │                                    │
        │  URL.createObjectURL(mediaSource)  │ appendBuffer(initSeg)
        ▼                                    │ appendBuffer(mediaSeg...)
 video.src = "blob:...."  <──────────────────┘
        │
        ▼   (모든 세그먼트 후) mediaSource.endOfStream()
   재생/버퍼 관리
```

### 3.2 핵심 객체/메서드

| 요소 | 역할 |
|---|---|
| `MediaSource` | 가상 미디어 소스. `URL.createObjectURL(ms)` → `blob:` URL 로 video에 연결 |
| `SourceBuffer` | 코덱별 버퍼. `mediaSource.addSourceBuffer('video/mp4; codecs="avc1.4d401f"')` |
| `appendBuffer(ab)` | init/media 세그먼트를 버퍼에 주입(비동기, `updateend` 이벤트) |
| `endOfStream()` | 더 이상 세그먼트 없음 → 재생 종료 신호 |

### 3.3 Segment 구조

| 세그먼트 | 내용 | 비고 |
|---|---|---|
| **init segment** | 코덱/트랙 메타(`ftyp`+`moov` for fMP4) | 재생/재구성에 필수, 1회 |
| **media segment** | 실제 프레임 데이터(`moof`+`mdat` for fMP4, 또는 `.ts` 패킷) | 순서대로 다수 |

### 3.4 일반 `video.src` 방식과의 차이

| 구분 | `video.src = url` (Progressive) | MSE |
|---|---|---|
| 소스 | 단일 파일 URL(직접 노출) | JS가 세그먼트 주입, `src`는 `blob:` |
| 원본 URL 노출 | DOM에 그대로 | **DOM엔 blob만** → Network/후킹으로 세그먼트 역추적 |
| 적응형 스트리밍 | 불가 | 가능(HLS/DASH 재생 근간) |
| 탐지 난이도 | 낮음 | 높음(§4 후킹 결합 필요) |
| 다운로드(비암호화) | URL 직접 저장 | 세그먼트 수집 후 재조합(§5) |

### 3.5 MSE 후킹(계측) 의사코드 — 원본 세그먼트 상관용

```
# 페이지 컨텍스트에 주입 (자동화/확장). 재생을 막지 않고 관찰만 한다.
const _add = SourceBuffer.prototype.appendBuffer
SourceBuffer.prototype.appendBuffer = function(buf) {
    reportSegment({ mime: this._mime, byteLength: buf.byteLength, ts: now() })
    return _add.call(this, buf)             # 원 동작 보존
}
const _addSB = MediaSource.prototype.addSourceBuffer
MediaSource.prototype.addSourceBuffer = function(mime) {
    const sb = _addSB.call(this, mime); sb._mime = mime; return sb
}
# 주입된 바이트를 §2 네트워크 세그먼트와 상관 → 원본 스트림/세그먼트 URL 집합 복원
```

---

## 4. Blob URL

### 4.1 생성 구조

```
Network fetch ──> ArrayBuffer ──> new Blob([ab], {type}) ──> URL.createObjectURL(blob) ──> "blob:https://site/uuid"
                                                                                              │
                                                                                    video.src = blob URL
```
MSE의 경우 `createObjectURL(MediaSource)`로, 실제 바이트가 아니라 **MediaSource 핸들**을 가리키는 blob이 만들어진다(§3).

### 4.2 blob URL 추적 방법

| 방법 | 설명 | 한계 |
|---|---|---|
| `URL.createObjectURL` 후킹 | 인자가 `Blob`인지 `MediaSource`인지 구분, 반환 blob URL ↔ 원본 매핑 저장 | 페이지 컨텍스트 주입 필요(자동화/확장) |
| `Blob`/`Response` 상관 | 후킹으로 확보한 ArrayBuffer의 출처를 §2 네트워크 요청과 매칭 | 여러 소스 합성 시 상관 난해 |
| `fetch`/`XHR` 후킹 | blob을 만든 원본 응답 URL 포착 | CORS/스트림 응답은 본문 접근 제약 |

```
const _create = URL.createObjectURL
URL.createObjectURL = function(obj) {
    const u = _create.call(URL, obj)
    if (obj instanceof MediaSource) registerMseBlob(u)          # → §3 경로로 세그먼트 추적
    else if (obj instanceof Blob)   registerBlob(u, obj.size, obj.type)  # 직접 바이트 보유
    return u
}
```

### 4.3 구현 시 고려사항
- **blob은 그 자체로 원본 URL이 아니다.** 저장하려면 (a) MediaSource형이면 세그먼트 재수집(§3/§5),
  (b) Blob형이면 후킹으로 확보한 바이트를 직접 저장.
- 후킹은 **원 동작을 보존**(call through)해 재생을 깨지 않아야 한다.
- `revokeObjectURL` 이후에는 접근 불가 → 조기 캡처.
- **암호화 콘텐츠**의 blob(EME 경유)은 §6에 따라 즉시 **불가 판정**.

---

## 5. Streaming Protocol (비암호화 표준 스트림만 대상)

### 5.1 HLS

```
Master(Multivariant) Playlist  (.m3u8)
   ├─ #EXT-X-STREAM-INF (1080p) → Variant/Media Playlist A (.m3u8)
   ├─ #EXT-X-STREAM-INF (720p)  → Variant/Media Playlist B (.m3u8)
   └─ #EXT-X-MEDIA (audio/subs) → Rendition Playlist
Media Playlist
   ├─ #EXT-X-MAP:URI="init.mp4"        (fMP4일 때 init 세그먼트)
   ├─ #EXTINF:6.0,  seg0.ts
   ├─ #EXTINF:6.0,  seg1.ts
   └─ #EXT-X-ENDLIST                   (VOD 종료; 없으면 LIVE)
```

| 구성 | 설명 |
|---|---|
| Master Playlist | 화질/오디오/자막 variant 목록 |
| Variant/Media Playlist | 특정 화질의 세그먼트 시퀀스 |
| Segment | `.ts`(MPEG-TS) 또는 `.m4s`/`.mp4`(fMP4). fMP4는 `#EXT-X-MAP` init 필요 |

### 5.2 MPEG-DASH

```
MPD
 └─ Period
     ├─ AdaptationSet (video)
     │    ├─ Representation (id=1, 1080p, bandwidth=..)
     │    │    └─ SegmentTemplate initialization="init-$RepresentationID$.m4s"
     │    │                       media="chunk-$RepresentationID$-$Number$.m4s"
     │    │                       ↳ SegmentTimeline (S: t,d,r)
     │    └─ Representation (id=2, 720p ..)
     └─ AdaptationSet (audio) ...
```

| 구성 | 설명 |
|---|---|
| MPD | 최상위 매니페스트(XML) |
| AdaptationSet | 트랙 그룹(비디오/오디오/자막) |
| Representation | 화질/비트레이트 변형 |
| SegmentTemplate | `$Number$`/`$Time$`/`$RepresentationID$` 치환 규칙으로 세그먼트 URL 생성 |
| SegmentTimeline | 각 세그먼트 시작시각(t)·길이(d)·반복(r) |

### 5.3 다운로드 가능 조건 (비암호화 한정)

| 조건 | HLS | DASH |
|---|---|---|
| 암호화 부재 | `#EXT-X-KEY` **없음** (있으면 불가) | `<ContentProtection>` **없음** (있으면 불가) |
| VOD 여부 | `#EXT-X-ENDLIST` 존재(LIVE는 경계 모호) | `type="static"`(dynamic=LIVE) |
| init 확보 | fMP4면 `#EXT-X-MAP` URI 취득 | `SegmentTemplate@initialization` |
| 세그먼트 접근 | 세그먼트 URL이 CORS 허용/접근 가능 | 동일 |

### 5.4 세그먼트 재조합 의사코드

```
function assembleHls(mediaPlaylist):
    assertNoKey(mediaPlaylist)                 # #EXT-X-KEY 있으면 throw "INELIGIBLE"
    out = []
    if mediaPlaylist.map: out.push(fetch(mediaPlaylist.map.uri))   # init
    for seg in mediaPlaylist.segments:
        out.push(fetch(seg.uri))               # 순서 보존
    return concat(out)                         # .ts 연결 또는 fMP4 스트림 (트랜스코딩 없음)

function assembleDash(mpd, repId):
    rep = mpd.pick(repId)
    assertNoContentProtection(rep)             # 있으면 throw "INELIGIBLE"
    urls = expandTemplate(rep.segmentTemplate, rep.timeline)  # init + media[]
    return concat(urls.map(fetch))
```

### 5.5 구현 시 고려사항
- **트랜스코딩/muxing은 범위 밖**: `.ts` 연결은 원 컨테이너 유지, fMP4는 init+media 연결. 오디오/비디오가
  분리된 DASH는 별도 트랙 → 사용자에게 분리 저장 또는 선택 제공(브라우저 내 muxing은 비용/복잡도 큼).
- `$Time$` 기반 템플릿은 SegmentTimeline 누적 계산 필요.
- 상대 URL은 매니페스트 base URI로 해석.
- **LIVE**는 종료 경계가 없어 스냅샷 다운로드로 한정하거나 불가 처리.

---

## 6. 다운로드 가능 여부 판정

### 6.1 판정 신호

| 신호 | 확인 방법 | 판정 기여 |
|---|---|---|
| **DRM 여부** | 매니페스트 `#EXT-X-KEY`(METHOD≠NONE)/`<ContentProtection>`; `.mpd` `cenc:` | 있으면 **불가** |
| **EME 사용** | `navigator.requestMediaKeySystemAccess` 호출 후킹, `video.mediaKeys≠null`, `encrypted` 이벤트 | 있으면 **불가** |
| **License Server** | EME 세션의 license 요청 URL 존재 | 있으면 **불가** |
| **Content-Type** | 응답 헤더 + 매직바이트 | 미디어 확정/포맷 결정 |
| **HTTP Header** | `Content-Disposition: attachment`(허용 신호), `Accept-Ranges`(재개), `Content-Length` | 적격 보조 |
| **CORS** | `Access-Control-Allow-Origin` | 브라우저 fetch 저장 가능성(자동화/서버 프록시는 별개) |
| **robots.txt** | 대상 미디어/경로 `Disallow` 여부 | 자동 수집 정책 준수(불허 시 자동화 제외) |
| **ToS** | 서비스 약관의 다운로드/스크래핑 금지 조항 | 금지면 **불가**(수동 확인·정책 테이블화) |

### 6.2 ToS에서 확인할 항목(체크리스트)
- 다운로드/오프라인 저장 명시적 허용 여부
- 자동화·스크래핑·봇 접근 금지 조항
- 콘텐츠 재배포/2차 이용 제한
- API/공식 다운로드 수단 제공 여부(있으면 그 경로 우선)

### 6.3 다운로드 적격성 Decision Tree

```
[미디어 후보]
   │
   ├─ EME/MediaKeys/encrypted 신호 있음? ─────────── Y ─▶ ❌ 불가 (DRM)
   │                                          N
   ├─ 매니페스트 암호화 태그 있음?
   │   (#EXT-X-KEY≠NONE / <ContentProtection> / cenc) ─ Y ─▶ ❌ 불가 (암호화)
   │                                          N
   ├─ 접근에 로그인/토큰 우회가 필요? ───────────── Y ─▶ ❌ 불가 (접근제어)
   │                                          N
   ├─ robots.txt가 해당 경로 Disallow? ──────────── Y ─▶ ⚠️ 자동수집 제외 (정책)
   │                                          N
   ├─ ToS가 다운로드/스크래핑 금지? ─────────────── Y ─▶ ❌ 불가 (약관)
   │                                          N
   ├─ 미디어 URL·세그먼트 접근 가능(200/206, 필요시 CORS)? ─ N ─▶ ⚠️ 조건부(프록시/권한 필요)
   │                                          Y
   ├─ LIVE(무한) 스트림? ────────────────────────── Y ─▶ ⚠️ 스냅샷만/보류
   │                                          N
   └────────────────────────────────────────────────▶ ✅ 다운로드 가능
```

### 6.4 판정 의사코드

```
function eligibility(candidate):
    if candidate.eme or candidate.hasMediaKeys or candidate.encryptedEvent:
        return INELIGIBLE("DRM")
    if candidate.manifest and candidate.manifest.hasEncryption:      # #EXT-X-KEY / ContentProtection
        return INELIGIBLE("ENCRYPTED")
    if candidate.requiresAuthBypass: return INELIGIBLE("ACCESS_CONTROL")
    if robots.disallow(candidate.url): return SKIP("ROBOTS")
    if tosPolicy(candidate.host).forbidsDownload: return INELIGIBLE("TOS")
    if not reachable(candidate.url):  return CONDITIONAL("NEEDS_PROXY_OR_PERMISSION")
    if candidate.isLive:              return CONDITIONAL("LIVE")
    return ELIGIBLE
```

---

## 7. 브라우저 API 조사

| API | 목적 | 장점 | 한계 | 활용 사례 |
|---|---|---|---|---|
| **HTMLMediaElement** | `<video>/<audio>` 제어·상태 | `currentSrc`,`duration`,`buffered`,`videoWidth` 등 풍부 | `src`가 blob이면 원본 불명; closed shadow 내부 접근 불가 | 요소 메타 수집, 재생 트리거 |
| **MediaSource** | 세그먼트 기반 재생(MSE) | 스트림 구조·코덱 파악, 후킹 지점 | 후킹 필요, 암호화면 불가 | MSE 스트림 탐지·세그먼트 상관 |
| **Fetch API** | 리소스 요청/응답 | 스트리밍(`ReadableStream`), `Range`, 진행률 | CORS 제약, opaque 응답 본문 불가 | 세그먼트/파일 수집, 매니페스트 취득 |
| **XMLHttpRequest** | 레거시 요청 | `progress` 이벤트, 광범위 호환 | 콜백식, 스트리밍 약함 | 구형 플레이어 후킹 대상 |
| **Performance API** | 리소스 타이밍 | `getEntriesByType('resource')`로 로드된 URL·타입·크기 목록 | 본문 없음, cross-origin은 타이밍 마스킹 | 놓친 미디어 URL 사후 발견 |
| **MutationObserver** | DOM 변경 감지 | 동적 삽입 video 실시간 포착 | 대량변경 시 성능, 디바운스 필요 | 동적/지연 미디어 탐지 |
| **IntersectionObserver** | 뷰포트 진입 감지 | lazy 미디어 로드 유도·효율적 | 진입 전 미존재, 스크롤 제어 병행 | lazy-load 트리거 |

```
# Performance API로 사후 미디어 URL 회수
perf = performance.getEntriesByType('resource')
mediaUrls = perf.filter(e => /\.(m3u8|mpd|mp4|webm|m4s|ts)(\?|$)/.test(e.name))
                .map(e => ({url:e.name, size:e.transferSize, type:e.initiatorType}))
```

---

## 8. 브라우저 자동화

| 도구 | 구현 난이도 | 성능 | 유지보수 | 브라우저 호환성 |
|---|---|---|---|---|
| **Playwright** | 낮음(고수준 API) | 높음(병렬 컨텍스트) | 높음(활발한 유지, 자동 대기) | Chromium·Firefox·WebKit |
| **Puppeteer** | 낮음 | 높음 | 중(주로 Chromium) | Chromium(+실험적 Firefox) |
| **CDP (raw)** | 높음(수동 상태관리) | 매우 높음(저수준) | 낮음(장황·버전 민감) | Chromium 계열 전용 |
| **Browser Extension API** | 중 | 높음(사용자 브라우저 내) | 중(스토어 정책·MV3 제약) | Chrome/Edge/Firefox(WebExtensions) |

### 8.1 선택 가이드
- **서버/CI 분석**: Playwright(오케스트레이션) + CDP 세션(정밀 네트워크/후킹). 크로스브라우저 검증엔 Playwright 3엔진.
- **사용자 로컬·실사용 컨텍스트**(로그인 세션·권한 보유 콘텐츠를 사용자 본인이 저장): **Extension**이 자연스럽다
  (`webRequest`/`declarativeNetRequest`, content script로 DOM/MSE 후킹). 단, 스토어 정책·ToS 준수 필수.
- **최대 제어·특수 계측**: raw CDP. 유지보수 비용이 크므로 최소 범위로.

### 8.2 계측 지점 매핑

```
                DOM 스캔     Network      MSE/Blob 후킹   Frame 순회
Playwright      evaluate()   page.on()    addInitScript   page.frames()
CDP             DOM.*        Network.*    (inject via     Target.*
                                          Page.addScript)
Extension       content      webRequest/  content script  all_frames
                script       DNR          (MAIN world)
```

> **결론**: 단일 도구로 모든 계층을 최적 커버하기 어렵다. **Playwright + CDP 병행**을 기본으로 하고,
> 사용자 컨텍스트 저장 시나리오에는 **Extension**을 별도 채널로 둔다.
