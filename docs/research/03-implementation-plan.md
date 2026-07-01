# 03. 구현 계획서 (6주 로드맵)

> 조사항목 10. 각 주차는 이전 주 산출물 위에 쌓인다. 포트-어댑터 코어 우선.

## 마일스톤 개요

```
W1 DOM ─▶ W2 Network ─▶ W3 MSE/Blob ─▶ W4 HLS/DASH ─▶ W5 Eligibility/Report ─▶ W6 통합/최적화/문서
[탐지 골격]   [소스 확장]   [숨은 소스]     [스트리밍]      [준법 게이트]         [출고 품질]
```

## 주차별 상세

### 1주차 — DOM 분석 · HTML5 Video 탐지
| 작업 | 산출물 | 완료 기준(DoD) |
|---|---|---|
| DOM Analyzer 코어(`scan`/`watch`) | `dom-analyzer` 모듈 | video/source/embed/object 탐지 |
| Shadow(open)·same-origin iframe 재귀 | 재귀 스캐너 | 중첩 컴포넌트에서 요소 발견 |
| MutationObserver 동적 탐지 | watcher | 지연 삽입 video 포착(디바운스) |
| MediaCandidate 스키마 확정 | 타입 정의 | Detector 입력 계약 고정 |

### 2주차 — Network 분석 · Media 탐지
| 작업 | 산출물 | DoD |
|---|---|---|
| Network Analyzer(Playwright `on` + CDP 세션) | `network-analyzer` | mp4/webm/mov/m3u8/mpd/ts/fmp4 분류 |
| 헤더/리다이렉트/Range/CORS 수집 | NetRequest 로그 | 응답 메타 정규화 |
| Media Detector 상관/중복제거 | `media-detector` | DOM↔Network 후보 병합 |
| Performance API 사후 회수 | 보강 스캐너 | 놓친 URL 회수 |

### 3주차 — MSE 지원 · Blob 분석
| 작업 | 산출물 | DoD |
|---|---|---|
| MSE 후킹(addSourceBuffer/appendBuffer) | inject 스크립트 | 세그먼트 주입 관측(재생 무손상) |
| `createObjectURL` 후킹(Blob/MediaSource 구분) | blob 추적기 | blob↔원본 상관 |
| fetch/XHR 후킹 상관 | 후킹 어댑터 | blob의 원본 요청 매핑 |

### 4주차 — HLS · DASH Parser
| 작업 | 산출물 | DoD |
|---|---|---|
| HLS 파서(master/media, `#EXT-X-MAP`, ENDLIST) | `playlist-parser` | variant/세그먼트/init 추출 |
| DASH 파서(MPD/AdaptationSet/Representation/SegmentTemplate/Timeline) | 동일 모듈 | 세그먼트 URL 확장 |
| 암호화 신호 추출(`#EXT-X-KEY`/ContentProtection) | 신호 플래그 | 암호화 매니페스트 식별 |

### 5주차 — 다운로드 적격성 판정 · 리포트
| 작업 | 산출물 | DoD |
|---|---|---|
| Eligibility Checker(Decision Tree) | `eligibility` | DRM/암호화/robots/ToS/CORS/LIVE 판정 |
| EME/MediaKeys 후킹 신호 | 신호 수집 | EME 사용 시 INELIGIBLE |
| Report Generator(JSON+MD) | `report` | 후보·판정·근거 리포트 |
| ToS/robots 정책 테이블 | 정책 데이터 | 호스트별 규칙 로드 |

### 6주차 — 통합 테스트 · 성능 · 문서
| 작업 | 산출물 | DoD |
|---|---|---|
| Download Manager 통합(재조합/진행률/취소) | `download-manager` | ELIGIBLE 저장 E2E |
| E2E 픽스처(합성 페이지) 테스트 | 테스트 스위트 | §06 전략 충족 |
| 성능 최적화 | 프로파일 리포트 | §07 목표치 달성 |
| 문서화 | 사용/운영 문서 | 인수 기준 충족 |

## 의존성 그래프

```
DOM ─┐
     ├─▶ Media Detector ─▶ Eligibility ─▶ Download Manager ─▶ Report
Network ┘        ▲
MSE/Blob hooks ──┘
Playlist Parser ─┴─(hls/dash 후보에 부착)
```

## 리소스/역할(예시)
| 역할 | 주 담당 |
|---|---|
| 브라우저 계측(Network/MSE/CDP) | 시니어 브라우저 엔지니어 |
| 파서/코어 로직 | 미디어 엔지니어 |
| 준법(Eligibility/ToS/robots) | 엔지니어 + 법무 검토 |
| 테스트/CI | QA/DevOps |

## 범위 밖(명시적 제외)
- DRM 복호화, 암호화 해제, 로그인/접근제어 우회, ToS 위반 수집 — **전 주차에서 구현 금지**.
- 트랜스코딩/리muxing(브라우저 내) — 초기 범위 밖(연결 저장까지만).
