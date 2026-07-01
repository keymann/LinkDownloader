# 02. 아키텍처 설계서

> 조사항목 9. 준법 게이트(Eligibility)가 파이프라인의 1급 시민이다.

## 시스템 개요

```
                         ┌──────────────────────────────────────────────┐
                         │              Orchestrator / Runner            │
                         │  (Playwright page + CDP session, or Extension)│
                         └───────────────┬──────────────────────────────┘
        page events / injected hooks     │
   ┌──────────────┬──────────────┬───────┴───────┬────────────────┐
   ▼              ▼              ▼               ▼                ▼
┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐  ┌──────────────┐
│  DOM   │   │ Network  │   │ (hooks)  │   │  Playlist    │  │              │
│Analyzer│   │ Analyzer │   │ MSE/Blob │   │  Parser      │  │              │
└───┬────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘  │              │
    │  candidates │  requests    │ segments       │ manifest │              │
    └──────┬──────┴──────┬───────┴────────────────┘          │              │
           ▼             ▼                                    │              │
      ┌─────────────────────────┐                            │              │
      │     Media Detector       │  정규화·중복제거·상관       │              │
      └────────────┬────────────┘                            │              │
                   ▼  MediaCandidate[]                        │              │
      ┌─────────────────────────────┐                        │              │
      │ Download Eligibility Checker │  DRM/암호화/CORS/ToS   │              │
      └────────────┬────────────────┘                        │              │
       ELIGIBLE     │  CONDITIONAL/INELIGIBLE ────────────────┼──▶┌──────────┐
                    ▼                                         │   │  Report  │
          ┌───────────────────┐                              └──▶│ Generator│
          │  Download Manager  │  (진행률·취소·재조합)          │   └──────────┘
          └───────────────────┘                              (모든 단계 로그 수집)
```

## 공통 데이터 모델

```
MediaCandidate {
  id: string
  origin: 'dom' | 'network' | 'mse' | 'blob' | 'performance'
  kind: 'file' | 'hls' | 'dash'
  container?: 'mp4'|'webm'|'mov'|'ts'|'fmp4'
  url?: string                 # 직접 URL (blob/mse면 없을 수 있음)
  pageUrl: string
  frameUrl?: string
  poster?: string
  bytes?: number
  headers?: Record<string,string>
  manifest?: ManifestModel     # hls/dash일 때 (Playlist Parser 산출)
  signals: {                   # Eligibility 입력
    eme?: boolean
    encrypted?: boolean        # #EXT-X-KEY / ContentProtection
    licenseServer?: string
    cors?: 'allow'|'deny'|'unknown'
    acceptRanges?: boolean
    isLive?: boolean
  }
}

EligibilityResult {
  candidateId: string
  verdict: 'ELIGIBLE' | 'CONDITIONAL' | 'INELIGIBLE' | 'SKIP'
  reason: string               # DRM / ENCRYPTED / TOS / ROBOTS / LIVE / NEEDS_PROXY ...
}
```

## 모듈 명세

### 1) DOM Analyzer
| 항목 | 내용 |
|---|---|
| 책임 | 정적/동적/Shadow/iframe에서 미디어 요소 탐지(§1) |
| 입력 | page/frame 핸들, 관찰 옵션(scroll, timeout) |
| 출력 | `MediaCandidate[]`(origin='dom') |
| 인터페이스 | `scan(page): Promise<MediaCandidate[]>` · `watch(page, onFound)` (MutationObserver 기반) |
| 의존 | 없음(자동화 런너가 주입) |

### 2) Network Analyzer
| 항목 | 내용 |
|---|---|
| 책임 | 요청/응답 관찰, 포맷·헤더·리다이렉트·Range·CORS 수집(§2) |
| 입력 | Playwright `page`/CDP `Network.*` 이벤트 스트림 |
| 출력 | `MediaCandidate[]`(origin='network') + 원시 요청 로그 |
| 인터페이스 | `attach(page): void` · `on('media', cb)` · `getRequests(): NetRequest[]` |

### 3) Media Detector
| 항목 | 내용 |
|---|---|
| 책임 | 세 계층 후보를 **정규화·중복제거·상관**(URL/바이트/프레임 기준) |
| 입력 | DOM/Network/hook 후보 스트림 |
| 출력 | 통합 `MediaCandidate[]` (blob↔세그먼트 상관 반영) |
| 인터페이스 | `merge(sources): MediaCandidate[]` · `correlate(blob, netReqs)` |

### 4) Playlist Parser
| 항목 | 내용 |
|---|---|
| 책임 | HLS(.m3u8)/DASH(.mpd) 파싱 → 세그먼트/화질/암호화 신호 추출(§5) |
| 입력 | 매니페스트 텍스트 + base URL |
| 출력 | `ManifestModel { variants[], segments[], initSegment?, hasEncryption, isLive }` |
| 인터페이스 | `parseHls(text,base)` · `parseDash(xml,base)` |

### 5) Download Eligibility Checker
| 항목 | 내용 |
|---|---|
| 책임 | DRM/암호화/접근제어/robots/ToS/CORS/LIVE 게이트(§6 Decision Tree) |
| 입력 | `MediaCandidate` + robots/ToS 정책 테이블 |
| 출력 | `EligibilityResult` |
| 인터페이스 | `evaluate(candidate): EligibilityResult` |
| 비고 | **차단 우선(fail-closed)**: 신호 불명확 시 CONDITIONAL/INELIGIBLE로 보수적 판정 |

### 6) Download Manager
| 항목 | 내용 |
|---|---|
| 책임 | ELIGIBLE 후보 저장: 파일 스트리밍/세그먼트 재조합, 진행률·취소·재개(§5) |
| 입력 | ELIGIBLE `MediaCandidate` + 저장 대상(파일 핸들/스트림) |
| 출력 | 저장 결과(경로/크기/상태) |
| 인터페이스 | `download(candidate, target, {onProgress, signal})` |
| 비고 | 암호화 세그먼트 감지 시 즉시 중단(방어적 재확인) |

### 7) Report Generator
| 항목 | 내용 |
|---|---|
| 책임 | 탐지·판정·다운로드 전 과정을 구조화 리포트로 산출 |
| 입력 | 모든 단계 이벤트/결과 |
| 출력 | JSON + 사람이 읽는 요약(표/트리) |
| 인터페이스 | `build(session): Report` · `render(format='json'|'md')` |

## 인터페이스 흐름(시퀀스)

```
Runner       DOM    Network   Detector   Parser   Eligibility   DLManager   Report
  │  scan()   │        │         │          │          │            │          │
  ├──────────▶│        │         │          │          │            │          │
  │  attach() │        │         │          │          │            │          │
  ├───────────────────▶│         │          │          │            │          │
  │           │ media  │ media   │          │          │            │          │
  │           └───────▶├────────▶│ merge()  │          │            │          │
  │                    │         ├─ manifest?──parse()─▶│            │          │
  │                    │         │◀── ManifestModel ────┤            │          │
  │                    │         ├─ evaluate() ────────▶│            │          │
  │                    │         │◀── EligibilityResult ┤            │          │
  │                    │         │  (ELIGIBLE) ─────────────────────▶│ download │
  │                    │         │                                   ├─────────▶│
  │                    │         │  (모든 결과/로그) ─────────────────────────▶│ build()
```

## 배포 형태 (2가지 프로파일)

| 프로파일 | 런너 | 계측 | 저장 위치 | 용도 |
|---|---|---|---|---|
| **A. 서버/CI 분석** | Playwright + CDP | 헤드리스 계측 | 서버 파일시스템/오브젝트 스토리지 | 대량 URL 적격성 리포트 |
| **B. 사용자 로컬** | Browser Extension | content script + webRequest | 사용자 기기(권한 보유 콘텐츠) | 사용자 본인 저장 |

> 두 프로파일은 **모듈 코어(Detector·Parser·Eligibility·Report)를 공유**하고, DOM/Network/DL 어댑터만
> 런너별로 교체한다(포트-어댑터 구조).
