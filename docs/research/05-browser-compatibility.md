# 05. 브라우저별 호환성 분석

> 값은 일반적 지원 경향. 실제 배포 전 대상 버전에서 계약 테스트(§08)로 재확인.

## 5.1 핵심 API 지원

| 기능 | Chrome/Edge (Chromium) | Firefox | Safari (WebKit) | 비고 |
|---|---|---|---|---|
| HTMLMediaElement | ✅ | ✅ | ✅ | 표준 |
| MSE (`MediaSource`) | ✅ | ✅ | ✅(데스크톱), iOS는 제한적 | iOS Safari는 MSE 제약(네이티브 HLS 선호) |
| `ManagedMediaSource`(iOS) | 부분 | – | ✅(iOS 17+) | iOS의 MSE 대체 경로 |
| EME(탐지 지표) | ✅ | ✅ | ✅ | 시스템별 키시스템 상이(탐지에만 사용) |
| Fetch/ReadableStream | ✅ | ✅ | ✅ | 스트리밍 저장 |
| `URL.createObjectURL` | ✅ | ✅ | ✅ | blob 추적 |
| File System Access API(`showSaveFilePicker`) | ✅ | ❌ | ❌ | 저장 경로 선택은 Chromium 데스크톱 한정 |
| MutationObserver / IntersectionObserver | ✅ | ✅ | ✅ | 표준 |
| Performance ResourceTiming | ✅ | ✅ | ✅ | cross-origin 타이밍 마스킹 존재 |

## 5.2 스트리밍 네이티브 재생

| 포맷 | Chromium | Firefox | Safari |
|---|---|---|---|
| HLS 네이티브(`<video src=.m3u8>`) | ❌(MSE 라이브러리 필요) | ❌ | ✅(네이티브) |
| DASH 네이티브 | ❌ | ❌ | ❌ | (모두 MSE 기반 라이브러리로 재생) |
| MP4/WebM progressive | ✅ | ✅ | ✅(WebM 일부 제한) |

> **함의**: Safari는 HLS를 네이티브로 재생 → `<video>.src`가 `.m3u8`로 직접 노출되기도 함(탐지 용이).
> Chromium/Firefox는 MSE 라이브러리로 재생 → blob+세그먼트 후킹 필요(§3).

## 5.3 자동화 도구 × 브라우저

| 도구 | Chromium | Firefox | WebKit |
|---|---|---|---|
| Playwright | ✅ | ✅ | ✅ |
| Puppeteer | ✅ | 실험적 | ❌ |
| CDP(raw) | ✅ | 부분(일부 도메인) | ❌ |
| Extension(WebExtensions) | ✅(MV3) | ✅ | ✅(제한적) |

## 5.4 저장 경로/다운로드 UX

| 방식 | Chromium 데스크톱 | 기타 브라우저/모바일 |
|---|---|---|
| `showSaveFilePicker`로 위치 선택 + 스트리밍 저장 | ✅ | ❌ → 기본 다운로드 폴더 fallback |
| 앵커 `download`(Blob) | ✅ | ✅(대용량은 메모리 부담) |

## 5.5 권장 대응 전략
- **기능 탐지(feature detection)** 로 분기: `'showSaveFilePicker' in window`, `'MediaSource' in window` 등.
- Safari/iOS: 네이티브 HLS로 `.m3u8` 직접 노출 케이스를 우선 처리, MSE 후킹은 데스크톱 중심.
- 크로스브라우저 탐지율은 Playwright 3엔진 매트릭스로 지속 측정.
- 저장 경로 선택 불가 환경은 명확히 안내 후 fallback.
