# 07. 성능 최적화 전략

## 7.1 성능 예산(목표치, 조정 가능)

| 지표 | 목표 |
|---|---|
| 단일 페이지 탐지(정적) | < 1.5s (네트워크 제외) |
| DOM 스캔(1회, 중간 규모 페이지) | < 100ms |
| 매니페스트 파싱(.m3u8/.mpd) | < 20ms |
| Eligibility 판정(후보당) | < 5ms |
| MutationObserver 오버헤드 | < 5% 프레임 예산 |
| 동시 다운로드 세그먼트 | 4~6 (호스트별 상한) |

## 7.2 병목과 대응

| 병목 | 원인 | 대응 |
|---|---|---|
| DOM 재스캔 폭주 | MutationObserver 대량 콜백 | **디바운스/배치**(rAF 또는 50~100ms), 추가된 서브트리만 스캔 |
| 전체 트리 재귀 | Shadow/iframe 재귀 비용 | 방문 캐시, 이미 스캔한 노드 스킵, 깊이 제한 |
| 응답 본문 취득 | 대용량 미디어 본문 로딩 | 매니페스트/텍스트만 본문 취득, 미디어는 **헤더+매직바이트 스니핑**만 |
| 세그먼트 순차 다운로드 | 지연 누적 | **제한된 동시성 큐**(concurrency=4~6) + 순서 보존 재조립 |
| 메모리(대용량 blob 누적) | 전체를 메모리 적재 | **스트리밍 저장**(WritableStream), fallback만 Blob |
| 네트워크 로그 폭증 | 모든 요청 기록 | 미디어 관련 요청만 필터링 후 보관 |

## 7.3 동시성 큐 의사코드

```
async function boundedFetchAll(urls, limit=5, signal):
    results = new Array(urls.length)
    let i = 0
    workers = range(limit).map(async () => {
        while (i < urls.length):
            const idx = i++; if signal.aborted: throw Abort
            results[idx] = await fetchWithRetry(urls[idx], signal)   # 지수 백오프
    })
    await Promise.all(workers)
    return results            # 인덱스 순서 보존 → 재조립 무결성
```

## 7.4 스트리밍 저장(메모리 안전)

```
resp = await fetch(url, {signal})
reader = resp.body.getReader()
writer = await saveTarget.getWriter()        # showSaveFilePicker or 서버 스트림
loop:
    {done, value} = await reader.read()
    if done: break
    await writer.write(value)                 # 청크 단위, 메모리 상수
    onProgress(received += value.byteLength)
```

## 7.5 계측 오버헤드 최소화(후킹)
- 후킹은 **얇게**: 메타(길이/타입/시각)만 보고, 바이트 복사는 피함.
- 관측 데이터는 링버퍼/샘플링으로 상한.
- 프로덕션 리포트는 요약만, 원시 로그는 옵트인.

## 7.6 자동화 스루풋(서버 프로파일)
- 페이지당 **컨텍스트 재사용 vs 격리** 트레이드오프: 격리(정확)·재사용(빠름) → 배치 크기로 조절.
- 병렬 페이지 수 = f(CPU, 메모리). Playwright 워커 풀로 상한.
- 불필요 리소스 차단(`route`로 이미지/폰트 abort)로 로드 단축(단, 미디어 탐지에 영향 없는 범위).
