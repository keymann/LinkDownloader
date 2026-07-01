# 10. 브라우저 확장 프로그램 설계 (MV3)

> [02-architecture](./02-architecture.md)의 **프로파일 B(사용자 로컬)** 상세 설계.
> 사용자가 **자신의 권한 범위**에서 비DRM·비암호화 미디어를 저장하는 시나리오. 준법 원칙([04-risk](./04-risk-analysis.md)) 유지:
> DRM/암호화/접근제어/로그인/ToS **우회 없음**, 애매하면 저장하지 않음(fail-closed).

## 1. 왜 확장인가 (자동화 대비)
| 관점 | 확장(Extension) | Playwright/CDP(서버) |
|---|---|---|
| 실행 컨텍스트 | **사용자의 실제 브라우저 세션**(로그인/권한 그대로) | 격리된 헤드리스 |
| MSE/Blob 후킹 | content script(MAIN world)로 자연스러움 | inject 필요 |
| 네트워크 관찰 | `webRequest`/`declarativeNetRequest` | CDP `Network.*` |
| 저장 | `chrome.downloads` + 사용자 폴더 | 서버 파일시스템 |
| 배포/정책 | 스토어 심사·MV3 제약 | 자유롭지만 사용자 컨텍스트 없음 |

## 2. 컴포넌트 구조

```
┌──────────────────────────── Extension ────────────────────────────┐
│                                                                    │
│  ┌───────────────┐   messages   ┌──────────────────────────────┐  │
│  │ Popup (UI)    │◀────────────▶│ Background (Service Worker)   │  │
│  │ React         │              │  - 오케스트레이션             │  │
│  │ 후보/판정/저장 │              │  - Detector/Parser/Eligibility│  │
│  └───────────────┘              │  - chrome.downloads          │  │
│                                 │  - declarativeNetRequest 규칙 │  │
│                                 └──────────────┬───────────────┘  │
│                                                │ webRequest 이벤트 │
│  ┌──────────────────────────── Content Scripts ─────────────────┐ │
│  │  ISOLATED world              │      MAIN world (page 컨텍스트) │ │
│  │  - DOM Analyzer(scan/watch)  │  - MSE/Blob/fetch 후킹         │ │
│  │  - 메시지 브리지             │◀── window.postMessage ───────▶ │ │
│  └──────────────────────────────┴───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
                     │ observe / download
                     ▼
              사용자의 웹페이지 / 네트워크
```

### 2.1 실행 컨텍스트(월드) 구분
| 컨텍스트 | 접근 | 용도 | 제약 |
|---|---|---|---|
| **Background(SW)** | chrome.* API | 오케스트레이션·다운로드·네트워크 규칙·코어 로직 | MV3는 이벤트 기반, 유휴 시 종료(상태는 storage) |
| **Content(ISOLATED)** | DOM, 격리된 JS | DOM 스캔·관찰, 브리지 | 페이지 JS 변수엔 접근 불가 |
| **Content(MAIN)** | 페이지의 window/프로토타입 | MSE/Blob/fetch **후킹** | chrome.* 대부분 불가 → 메시지로 위임 |

> MV3에서 MAIN world 주입: manifest `content_scripts[].world:"MAIN"` 또는 `chrome.scripting.executeScript({world:'MAIN'})`.

## 3. manifest.json (MV3, 핵심)

```jsonc
{
  "manifest_version": 3,
  "name": "Media Eligibility Inspector",
  "version": "0.1.0",
  "permissions": ["downloads", "storage", "scripting", "activeTab", "declarativeNetRequestWithHostAccess"],
  "optional_host_permissions": ["*://*/*"],     // 사용자가 사이트별로 명시 허가(최소권한)
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content-iso.js"], "run_at": "document_start", "all_frames": true },
    { "matches": ["<all_urls>"], "js": ["hook-main.js"], "run_at": "document_start", "world": "MAIN", "all_frames": true }
  ],
  "web_accessible_resources": [{ "resources": ["hook-main.js"], "matches": ["<all_urls>"] }]
}
```

### 3.1 권한 최소화 원칙
- 광범위 `host_permissions`를 **기본 부여하지 않고** `optional_host_permissions`로 두어 사용자가 **사이트별 허가**(activeTab/`chrome.permissions.request`).
- `webRequest`는 관찰만; 차단/변조 없음. 규칙 기반 관찰은 가능하면 `declarativeNetRequest`로.

## 4. 데이터 흐름 (탐지 → 판정 → 저장)

```
Page          hook-main(MAIN)     content-iso(ISOLATED)     Background(SW)          Popup
 │ 재생/DOM        │                     │                       │                    │
 │ MSE/blob ──hook─▶ reportSegment       │                       │                    │
 │                 ├─ postMessage ──────▶ relay ──runtime.msg──▶ Detector.merge       │
 │ DOM video ───────────────────────────▶ scan()  ──msg───────▶ Detector.merge       │
 │ network(mp4/m3u8) ─────────────────────────── webRequest ──▶ Network.record       │
 │                                                              Parser.parse(manifest) │
 │                                                              Eligibility.evaluate   │
 │                                                              store candidates ─────▶ 표시(open popup)
 │                                                              ◀── user clicks 저장 ──┤ (ELIGIBLE만)
 │                                                              chrome.downloads.download
```

## 5. 후킹 (MAIN world, `hook-main.js`)

관측 전용(call-through). 재생을 깨지 않는다. ([01 §3/§4](./01-technical-research.md) 참조)

```
(() => {
  const send = (type, data) => window.postMessage({ __mei:true, type, data }, '*')

  // MSE
  const _addSB = MediaSource.prototype.addSourceBuffer
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const sb = _addSB.call(this, mime); sb.__mime = mime
    send('mse-sourcebuffer', { mime }); return sb
  }
  const _append = SourceBuffer.prototype.appendBuffer
  SourceBuffer.prototype.appendBuffer = function (buf) {
    send('mse-append', { mime: this.__mime, bytes: buf.byteLength }); return _append.call(this, buf)
  }
  // Blob URL
  const _create = URL.createObjectURL
  URL.createObjectURL = function (obj) {
    const u = _create.call(URL, obj)
    send('object-url', { url: u, kind: obj instanceof MediaSource ? 'mediasource' : 'blob',
                         size: obj.size, type: obj.type }); return u
  }
  // EME 신호(탐지 전용 → 즉시 INELIGIBLE로 이어짐, 우회 아님)
  const _rmksa = navigator.requestMediaKeySystemAccess
  if (_rmksa) navigator.requestMediaKeySystemAccess = function (ks, cfg) {
    send('eme', { keySystem: ks }); return _rmksa.call(navigator, ks, cfg)
  }
  // fetch(매니페스트/세그먼트 URL 상관용, 본문 변조 없음)
  const _fetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (/\.(m3u8|mpd|m4s|ts|mp4|webm)(\?|$)/i.test(url)) send('media-fetch', { url })
    return _fetch.apply(this, arguments)
  }
})()
```
```
// content-iso.js: MAIN → ISOLATED 릴레이 + DOM 스캔
window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.__mei) chrome.runtime.sendMessage(e.data)
})
scanDom()                                   // §01 §1.3
new MutationObserver(() => debounce(scanDom, 80)).observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['src']})
```

> **보안**: `postMessage` 수신 시 `e.source === window` + 매직키(`__mei`) 검증(페이지의 위장 메시지 방지).
> MAIN world 후킹 코드는 페이지 JS와 동일 신뢰수준이므로 **민감정보(토큰/쿠키) 수집 금지**.

## 6. 네트워크 관찰 (Background)

```
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    const ct = header(d.responseHeaders, 'content-type')
    const kind = classify(d.url, ct)                 // §01 §2
    if (kind) Network.record({ url:d.url, type:ct, kind, tabId:d.tabId,
                               ranges: header(d.responseHeaders,'accept-ranges')==='bytes' })
  },
  { urls: ['<all_urls>'], types: ['media','xmlhttprequest','other'] },
  ['responseHeaders']
)
```
- MV3에서 `webRequest`는 **관찰(observe)만**; 차단/변조는 `declarativeNetRequest` 규칙으로 제한적. 본 설계는 **관찰만** 사용.
- 매니페스트(.m3u8/.mpd)는 Background가 별도 `fetch`로 본문 취득 후 Parser에 전달(동일 출처/권한 범위 내).

## 7. 다운로드 (Background)

```
async function download(candidate) {
  const verdict = Eligibility.evaluate(candidate)     // §01 §6
  if (verdict.verdict !== 'ELIGIBLE') return notify(verdict)   // 저장 차단
  if (candidate.kind === 'file') {
    chrome.downloads.download({ url: candidate.url, filename: safeName(candidate) })
  } else {                                             // hls/dash (비암호화 확정)
    const parts = await boundedFetchAll(candidate.manifest.segmentUrls, 5)  // §07
    const blob = new Blob(parts)                       // (대용량은 파일시스템 스트리밍 고려)
    chrome.downloads.download({ url: URL.createObjectURL(blob), filename: safeName(candidate) })
  }
}
```
- 세그먼트 재조합은 [01 §5](./01-technical-research.md)/[09](./09-parser-spec.md) 규칙. **암호화면 진입 자체가 차단**.
- 대용량 재조합은 메모리 이슈 → 향후 OPFS/`chrome.downloads` 스트리밍 검토([07](./07-performance-optimization.md)).

## 8. 상태/저장소
| 저장소 | 용도 |
|---|---|
| `chrome.storage.session` | 탭별 탐지 후보(휘발) |
| `chrome.storage.local` | 설정, ToS/robots 정책 테이블, 히스토리 |
| 메모리(SW) | 진행 중 다운로드(재시작 대비 local 백업) |

> MV3 서비스워커는 유휴 시 종료 → **상태는 storage에 지속**, 이벤트로 부팅.

## 9. UI (Popup)
```
[탭에서 발견된 미디어]  (판정별 그룹)
 ✅ 다운로드 가능
   ▢ 동영상 1  MP4  15MB   [저장]
   ▢ 동영상 2  HLS(비암호화) 6seg [저장]
 ⚠️ 조건부
   • LIVE 스트림 — 스냅샷만
 ❌ 불가
   • DRM(EME) 감지  · 암호화 HLS(#EXT-X-KEY)  · ToS 금지
[리포트 보기(JSON/MD)]  [설정]
```
- **불가 항목도 사유와 함께 표시**(투명성·준법 커뮤니케이션).

## 10. 브라우저 호환성
| 기능 | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| MV3 service_worker | ✅ | ✅(background scripts 병행) | 부분(Safari Web Extension) |
| content_scripts world:MAIN | ✅ | ✅(최근) | 제한적 |
| declarativeNetRequest | ✅ | ✅ | 부분 |
| chrome.downloads | ✅ | ✅ | 제한적 |
> Firefox는 `browser.*` 프로미스 API(webextension-polyfill로 흡수), Safari는 기능 제약 큼 → Chromium 우선, Firefox 차선.

## 11. 보안 · 프라이버시 · 스토어 준법
| 항목 | 조치 |
|---|---|
| 최소 권한 | optional host permission, 사이트별 사용자 승인 |
| 데이터 수집 | 미디어 메타만; **쿠키/토큰/개인정보 미수집·미전송** |
| 원격 코드 | 없음(MV3 금지). 모든 로직 번들 내 |
| 후킹 안전성 | call-through, 재생 무손상, 관측 전용 |
| 준법 | DRM/암호화/접근제어/ToS **우회 없음**; 불가 콘텐츠는 저장 버튼 미제공 |
| 투명성 | 개인정보 처리방침, 판정 근거 리포트 |

## 12. 자동화(프로파일 A)와 코어 공유
```
        공유 코어(순수 TS): Detector · Playlist Parser · Eligibility · Report
        ├── 확장 어댑터:  content/hook + webRequest + chrome.downloads
        └── 서버 어댑터:  Playwright/CDP + fetch + fs
```
> 코어는 브라우저 API 비의존 순수 모듈로 유지 → 두 프로파일이 동일 판정 로직·테스트를 공유([08](./08-maintenance-strategy.md) 포트-어댑터).

## 13. 확장 개발 로드맵(코어 재사용 전제, 3주 추가)
| 주 | 작업 |
|---|---|
| +1 | manifest/SW 골격, content(ISO/MAIN) 브리지, DOM 스캔 이식 |
| +2 | MSE/Blob/fetch 후킹, webRequest 관찰, 코어(Parser/Eligibility) 연결 |
| +3 | Popup UI, chrome.downloads 저장, 스토어 준법(권한/정책/개인정보), 크로스브라우저 점검 |
```
