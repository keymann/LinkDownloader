# Media Eligibility Inspector — 확장 프로그램 스캐폴드 (MV3)

웹페이지의 미디어를 탐지하고 **다운로드 적격성(비DRM·비암호화)** 을 판정하는 Chrome/Edge(MV3) 확장의 **스캐폴드**.
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
│  ├─ hook-main.ts          # MAIN world: MSE/Blob/fetch/EME 후킹(관측 전용, call-through)
│  ├─ content-iso.ts        # ISOLATED world: DOM 스캔/관찰 + MAIN→background 릴레이
│  ├─ background.ts         # SW: webRequest 관찰·매니페스트 파싱·판정·chrome.downloads
│  └─ popup/                # 판정별 그룹 UI(불가 사유 표시)
└─ icons/                   # 128.png 등(교체)
```

## 빌드 & 로드

```bash
cd extension
npm install
npm run build          # → extension/dist/
# Chrome: chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → extension/dist 선택
npm run watch          # 개발 중 자동 재빌드
```

## 동작 개요

1. `content-iso.ts`가 DOM을 스캔/관찰하고, `hook-main.ts`가 MSE/Blob/fetch/EME를 후킹해 신호를 background로 보낸다.
2. `background.ts`가 `webRequest`로 미디어 요청을 관찰하고, 매니페스트(.m3u8/.mpd)를 파싱한다.
   - HLS는 SW에서 직접 파싱, **DASH는 DOMParser가 필요**하여 offscreen document 위임(스텁 TODO).
3. `eligibility.ts`가 DRM/암호화/robots/ToS/CORS/LIVE를 게이트해 판정한다.
4. Popup에서 **ELIGIBLE 항목만 저장** 버튼 노출. 나머지는 사유와 함께 표시.

## 스캐폴드 TODO (프로덕션화 시)

- [ ] DASH offscreen 파서(`chrome.offscreen` + `core/dash.parseDash`) 연결
- [ ] HLS master→media 2차 fetch/파싱 체인
- [ ] `core/remux.assemble`로 세그먼트 재조합(스트리밍 저장/OPFS), 대용량 대응
- [ ] robots/ToS 정책 테이블 로드(`chrome.storage.local`) 및 준법 검토 프로세스
- [ ] blob↔세그먼트 상관(MSE append ↔ media-fetch) 정밀화
- [ ] 아이콘·개인정보 처리방침·스토어 심사 자료
- [ ] Firefox(`browser.*` 폴리필)·Safari 대응

## 준법 체크리스트(코드리뷰 필수)

- [ ] 복호화/키 취득/EME 우회 코드 없음
- [ ] 로그인/접근제어/ToS 우회 없음
- [ ] 쿠키/토큰/개인정보 수집·전송 없음
- [ ] 불가 판정 콘텐츠에 저장 경로 미제공
