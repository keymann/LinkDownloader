# 웹 미디어 탐지 & 다운로드 적격성 리서치 / 설계 문서 세트

> **범위 및 준법 원칙**
> 본 문서 세트는 **웹 표준·서비스 약관(ToS)·저작권·DRM 정책을 준수**하는 범위에서
> "웹페이지에 포함된 동영상을 자동 탐지하고, **다운로드가 허용된(비DRM·비암호화 또는 권한 보유)**
> 미디어에 한해 저장하는" 시스템을 연구·설계한다.
>
> 다음은 **조사·구현 대상에서 제외**한다. 해당 콘텐츠는 오직 **"다운로드 불가"로 판정하는 기준**만 정리한다.
> - DRM(Widevine / FairPlay / PlayReady) 우회
> - 암호화(AES-128, SAMPLE-AES, CENC 등) 해제
> - 접근 제어/로그인 우회
> - 서비스 약관 위반 다운로드 기법

## 문서 목록 (산출물)

| # | 문서 | 내용 |
|---|---|---|
| 1 | [01-technical-research.md](./01-technical-research.md) | 기술 리서치 보고서 (조사항목 1~8: HTML·Network·MSE·Blob·스트리밍·적격성·브라우저 API·자동화) |
| 2 | [02-architecture.md](./02-architecture.md) | 아키텍처 설계서 (조사항목 9: 7개 모듈 책임/입출력/인터페이스) |
| 3 | [03-implementation-plan.md](./03-implementation-plan.md) | 구현 계획서 (조사항목 10: 6주 로드맵, 마일스톤, 산출물) |
| 4 | [04-risk-analysis.md](./04-risk-analysis.md) | 위험 요소 분석 (기술·법적·운영 리스크와 완화책) |
| 5 | [05-browser-compatibility.md](./05-browser-compatibility.md) | 브라우저별 호환성 분석 |
| 6 | [06-test-strategy.md](./06-test-strategy.md) | 테스트 전략 |
| 7 | [07-performance-optimization.md](./07-performance-optimization.md) | 성능 최적화 전략 |
| 8 | [08-maintenance-strategy.md](./08-maintenance-strategy.md) | 유지보수 전략 |

### 심화(Deep-dive) 문서

| # | 문서 | 내용 |
|---|---|---|
| 9 | [09-parser-spec.md](./09-parser-spec.md) | Playlist Parser 상세 스펙 (HLS/DASH 렉싱·문법·데이터 모델·SegmentTemplate/Timeline 확장·암호화 신호 추출·엣지케이스·테스트 벡터) |
| 10 | [10-extension-design.md](./10-extension-design.md) | 브라우저 확장(MV3) 설계 (월드 구조·manifest·MSE/Blob 후킹·webRequest·다운로드·UI·호환성·스토어 준법) |

## 용어

| 약어 | 의미 |
|---|---|
| MSE | Media Source Extensions (`MediaSource`, `SourceBuffer`) |
| EME | Encrypted Media Extensions (DRM 재생 API) — **탐지 지표로만 사용** |
| CDP | Chrome DevTools Protocol |
| HLS | HTTP Live Streaming (`.m3u8` + 세그먼트) |
| DASH | Dynamic Adaptive Streaming over HTTP (`.mpd`) |
| fMP4 | fragmented MP4 (CMAF 세그먼트 컨테이너) |
| CENC | Common Encryption (DASH 표준 암호화) |

## 한 눈에 보는 핵심 결론

- **탐지**는 세 계층을 합쳐야 완전해진다: ① DOM(정적/동적/Shadow) ② Network(요청/응답 메타) ③ 런타임 API 후킹(MSE/Blob).
- **다운로드 적격성**의 1차 게이트는 **암호화·DRM 신호(EME/`#EXT-X-KEY`/`ContentProtection`)** 이며, 하나라도 있으면 즉시 **불가**.
- **Blob URL / MSE 스트림**은 원본 세그먼트 URL을 Network·후킹으로 역추적할 수 있을 때만 (비암호화 조건에서) 적격.
- 자동화는 **Playwright(오케스트레이션) + CDP(네트워크/후킹) + (선택)확장 API(사용자 브라우저 내 컨텍스트)** 조합이 현실적이다.
