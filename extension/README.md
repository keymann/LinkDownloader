# Media Eligibility Inspector — 확장 프로그램 스캐폴드 (MV3)

웹페이지의 미디어를 탐지하고 **다운로드 적격성(비DRM·비암호화)** 을 판정하는 크로스브라우저(MV3) 확장의 **스캐폴드** (Chrome/Edge, Firefox).
설계 근거: [`docs/research/10-extension-design.md`](../docs/research/10-extension-design.md),
파서 [`09`](../docs/research/09-parser-spec.md), 재조합 [`11`](../docs/research/11-segment-remux.md).

> **준법**: DRM(Widevine/FairPlay/PlayReady)·암호화·접근제어·로그인·ToS **우회 없음**.
> 해당 콘텐츠는 "불가(INELIGIBLE)"로만 표시. 애매하면 저장하지 않는다(fail-closed).

## 구조

```
extension/
├─ manifest.json            # MV3: SW + content(ISOLATED/MAIN) + popup, 최소 권한
├─ build.mjs                # esbuild 번들러 → dist/
├─ src/
│  ├─ core/                 # ★ 브라우저 API 비의존 순수 코어(서버 프로파일과 공유)
│  │  ├─ types.ts           #   공유 타입
│  │  ├─ hls.ts             #   HLS 파서(09 §1)
│  │  ├─ dash.ts            #   DASH 파서(09 §2, DOMParser 필요 → offscreen/content)
│  │  ├─ eligibility.ts     #   적격성 Decision Tree(01 §6, fail-closed)
│  │  └─ remux.ts           #   세그먼트 concat(기본) + remux 옵트인 스텁(11)
│  ├─ env.ts                # 크로스브라우저 런타임(api=browser??chrome, HAS_DOM/HAS_OFFSCREEN)
│  ├─ dom-tasks.ts          # DASH 파싱·재조합 라우팅(Chrome=offscreen / Firefox=로컬)
│  ├─ assemble-store.ts     # DOM 기반 OPFS 스트리밍 재조합 + blob 수명(컨텍스트 중립)
│  ├─ hook-main.ts          # MAIN world: MSE/Blob/fetch/EME 후킹(관측 전용, call-through)
│  ├─ content-iso.ts        # ISOLATED world: DOM 스캔/관찰 + MAIN→background 릴레이
│  ├─ background.ts         # webRequest 관찰·매니페스트 파싱·판정·downloads (api.* 사용)
│  ├─ offscreen.ts          # (Chrome) DASH 파싱·재조합 어댑터
│  └─ popup/                # 판정별 그룹 UI + 진행바/취소
└─ icons/                   # 128.png 등(교체)
```

## 크로스브라우저(Chrome/Edge, Firefox)

| 관심사 | Chrome/Edge | Firefox |
|---|---|---|
| API 네임스페이스 | `chrome.*`(MV3 promise) | `browser.*`(promise) — `env.api`로 통일 |
| background | service worker(DOM 없음) | event page(DOM 있음) |
| DASH 파싱·세그먼트 재조합 | **offscreen document** | **background에서 직접**(DOMParser/OPFS 존재) |
| manifest background | `service_worker` | `scripts`(+ `browser_specific_settings.gecko`) |
| content `world:"MAIN"` | 지원 | Firefox 128+ |

`dom-tasks.ts`가 `HAS_DOM`/`HAS_OFFSCREEN`로 실행 위치를 자동 선택하므로 **동일 background 번들**이 양쪽에서 동작한다.

> ⚠️ Chrome 경로는 이 저장소에서 검증(빌드/코어 로직/브라우저 단위테스트). **실제 Firefox 로드 검증은 `web-ext`/Firefox에서 별도 수행** 필요(환경 제약).

## 빌드 & 로드

```bash
cd extension
npm install
npm run build          # → extension/dist/
# Chrome: chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → extension/dist 선택
npm run watch          # 개발 중 자동 재빌드

npm test               # vitest — 코어 로직 단위 테스트 (9 suites / 50 tests)
npm run lint           # web-ext lint (매니페스트/번들 정적 검증)
npm run start:firefox  # web-ext run (Firefox에 로드하여 실행)
npm run start:chromium # web-ext run (Chromium에 로드하여 실행)
```

### 린트 결과(참고)
`npm run lint`는 **0 errors**. 남는 2개 warning은 **단일 매니페스트로 Chrome+Firefox 동시 지원**에서 오는
의도된 트레이드오프다(무해, Firefox가 무시):
- `MANIFEST_PERMISSIONS`: `offscreen`은 Chrome 전용 권한(Firefox는 로컬 DOM 사용 → 불필요)
- `MANIFEST_FIELD_UNSUPPORTED`: `background.service_worker`(Chrome)는 Firefox가 무시하고 `background.scripts` 사용

## 동작 개요

1. `content-iso.ts`가 DOM을 스캔/관찰하고, `hook-main.ts`가 MSE/Blob/fetch/EME를 후킹해 신호를 background로 보낸다.
2. `background.ts`가 `webRequest`로 미디어 요청을 관찰하고, 매니페스트(.m3u8/.mpd)를 파싱한다.
   - HLS는 어디서나 파싱, **DASH는 DOMParser 필요** → `dom-tasks`가 Chrome=offscreen / Firefox=로컬로 라우팅.
3. `eligibility.ts`가 DRM/암호화/robots/ToS/CORS/LIVE를 게이트해 판정한다.
4. Popup에서 **ELIGIBLE 항목만 저장** 버튼 노출. 나머지는 사유와 함께 표시.
5. 저장 시작 시 offscreen 재조합 진행률이 background를 거쳐 popup에 **실시간 진행바**로 표시된다
   (재조합 세그먼트 %/바이트 → 저장 중 → 완료/실패).
6. 진행 중 작업은 **취소** 가능: 재조합 중이면 offscreen의 `AbortController`로 중단(OPFS 임시파일 삭제),
   저장 중이면 `chrome.downloads.cancel` → 작업 상태 `canceled`.

## 스캐폴드 TODO (프로덕션화 시)

- [x] DASH offscreen 파서(`chrome.offscreen` + `core/dash.parseDash`) 연결
      — `src/offscreen.ts`(+`offscreen.html`)에서 `parseDash` 수행, `background.ts`가
      `ensureOffscreen()`/`parseDashViaOffscreen()`로 위임. `offscreen` 권한 추가.
- [x] HLS master→media 2차 fetch/파싱 체인 (`core/plan.resolveHlsManifest`)
- [x] `core/remux.assemble`로 세그먼트 재조합 + 다운로드 배선
      (offscreen에서 fetch+concat→Blob→blobURL, background가 `chrome.downloads`로 저장 후 revoke)
- [x] 대용량 스트리밍 저장(OPFS/`WritableStream`)로 메모리 피크 제거
      — offscreen이 `assembleToWriter`로 세그먼트를 OPFS 파일에 순차 스트리밍(상수 메모리),
      디스크 기반 File→blobURL로 다운로드, 완료 시 revoke+파일 삭제. OPFS 미지원 시 Blob 폴백.
- [x] robots/ToS 정책 테이블 로드(`chrome.storage.local`) 및 준법 검토 프로세스
      — `core/robots`(REP 파서/매처) + `core/policy`(ToS 테이블+robots 캐시→PolicyLookup),
      background가 호스트별 robots.txt fetch·캐시, 다운로드 시 robots 강제. 정책 테이블은
      `storage.local.policyTable`(호스트별 `forbidsDownload`)로 관리.
- [x] blob↔세그먼트 상관(MSE append ↔ media-fetch)
      — `core/correlate`가 같은 탭의 MSE(blob) 재생을 실제 매니페스트와 연결(중복 blob 제거,
      매니페스트를 대표로 표기). 매니페스트 없이 세그먼트만 관측되면 사유(재조합 불가)와 함께 CONDITIONAL.
      background가 object-url/mse-sourcebuffer/mse-append/media-fetch를 탭별 컨텍스트로 수집.
- [x] 정밀 MIME/코덱 매칭(상관 과결합 방지) — `core/codecs`가 MSE appendBuffer mime의 코덱을
      매니페스트 variant 코덱과 대조. 코덱 일치 매니페스트만 대표로 blob 중복 제거하고, 여러 매니페스트가
      있고 코덱이 안 맞으면 blob을 유지(오결합 방지)하며 "코덱 불일치"로 표시.
- [ ] 아이콘·개인정보 처리방침·스토어 심사 자료
- [x] Firefox 호환(`env.api`=browser??chrome, dom-tasks 라우팅, manifest gecko) — 위 "크로스브라우저" 참조
- [x] 취소 정리 — 저장 중 취소 시 중단된 다운로드 항목을 `downloads.erase`로 정리(부분 파일/기록 제거),
      완료/취소/실패 작업은 팝업 "지우기"(`clear-job`)로 목록에서 제거. (재조합 중 취소는 OPFS 임시파일 자동 삭제)
- [ ] Safari(Web Extension) 대응 및 실제 Firefox 로드 검증(`web-ext`)

## 테스트 (`npm test`, vitest)

브라우저 API 비의존 **코어 로직**을 정식 단위 테스트로 커버(`extension/test/`):

| 스위트 | 대상 |
|---|---|
| `codecs` | 코덱 패밀리/MIME 파싱/집합 매칭 |
| `robots` | REP 파서·매처(최장/allow-tie/`*`/`$`) |
| `eligibility` | 판정 Decision Tree(DRM/암호화/robots/ToS/CORS/LIVE/무소스/OK) |
| `hls` | media/master 파싱, EXT-X-MAP/KEY/BYTERANGE/ENDLIST |
| `dash` | (jsdom) SegmentTemplate/Timeline·`%0Nd`·ContentProtection·static/dynamic |
| `plan` | AssemblePlan 생성(fmp4/ts/분리트랙), 암호화·LIVE 차단, HLS master→media |
| `remux` | planToSegments·assembleToWriter(순서/abort)·assemble(Blob) |
| `correlate` | MSE↔코덱 매칭(대표/폴백/모호/불일치) |
| `policy` | robots+ToS 테이블 ↔ eligibility 통합 |

DASH만 `jsdom` 환경(`// @vitest-environment jsdom`), 나머지는 node. 네트워크는 `fetchImpl` 주입으로 목킹.

## 준법 체크리스트(코드리뷰 필수)

- [ ] 복호화/키 취득/EME 우회 코드 없음
- [ ] 로그인/접근제어/ToS 우회 없음
- [ ] 쿠키/토큰/개인정보 수집·전송 없음
- [ ] 불가 판정 콘텐츠에 저장 경로 미제공
