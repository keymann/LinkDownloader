# 06. 테스트 전략

## 6.1 테스트 피라미드

```
              ▲  E2E (합성 페이지 · 3엔진)         ~10%
             ─┼─ Integration (모듈 결합 · CDP 계측) ~30%
            ──┼── Unit (파서·판정·정규화)           ~60%
```

## 6.2 계층별 전략

| 계층 | 대상 | 방법 | 픽스처 |
|---|---|---|---|
| Unit | Playlist Parser, Eligibility Decision Tree, Detector 정규화 | 순수 함수 입력→출력 단언 | 다양한 .m3u8/.mpd 샘플, 신호 조합 |
| Integration | DOM+Network+hook → Detector → Eligibility | Playwright + CDP로 합성 페이지 로드 | 로컬 서버가 제공하는 합성 미디어 |
| E2E | 전 파이프라인(탐지→판정→저장/리포트) | 3엔진 매트릭스 | 시나리오별 합성 페이지 |

## 6.3 합성 픽스처 카탈로그 (자체 호스팅 · 준법)

> 실제 서비스가 아닌 **우리가 만든 테스트 페이지/미디어**로만 테스트한다(ToS 무관).

| 픽스처 | 목적 | 기대 판정 |
|---|---|---|
| 직접 mp4 `<video src>` | 기본 탐지/저장 | ELIGIBLE |
| `<source>` 다중 화질 | 후보 선택 | ELIGIBLE |
| same-origin iframe 내 video | 재귀 스캔 | ELIGIBLE |
| cross-origin iframe | 한계 검증 | Network 탐지 or 미탐지 로깅 |
| open Shadow DOM video | shadow 재귀 | ELIGIBLE |
| lazy-load(스크롤 삽입) | 관찰자/스크롤 | ELIGIBLE |
| MSE + blob(비암호화 fMP4) | 후킹·세그먼트 상관 | ELIGIBLE(상관 성공 시) |
| HLS VOD(비암호화) | 매니페스트/재조합 | ELIGIBLE |
| HLS + `#EXT-X-KEY` | 암호화 게이트 | INELIGIBLE(ENCRYPTED) |
| DASH(비암호화 static) | 템플릿 확장 | ELIGIBLE |
| DASH + ContentProtection | 암호화 게이트 | INELIGIBLE |
| EME 재생 페이지(합성) | DRM 신호 | INELIGIBLE(DRM) |
| robots Disallow 경로 | 정책 | SKIP |
| LIVE(무한) m3u8 | 경계 | CONDITIONAL |

## 6.4 핵심 단언 (Eligibility 회귀)

```
test("암호화 HLS는 반드시 불가"):
    m = parseHls(fixtures.hlsWithKey)
    assert eligibility({kind:'hls', manifest:m}).verdict == 'INELIGIBLE'
    assert reason == 'ENCRYPTED'

test("EME 신호는 반드시 불가"):
    assert eligibility({signals:{eme:true}}).verdict == 'INELIGIBLE'

test("신호 불명확은 자동 ELIGIBLE 금지"):
    r = eligibility({kind:'file', signals:{cors:'unknown'}})
    assert r.verdict in ['CONDITIONAL','INELIGIBLE']   # fail-closed
```

## 6.5 비기능 테스트
- **탐지율 회귀**: 픽스처 대비 탐지 성공률 지표화, 임계 미달 시 CI 실패.
- **성능 예산**(§07)을 CI에서 측정.
- **안정성**: 후킹 주입 후 합성 플레이어 재생이 정상인지(무손상) 검증.

## 6.6 CI 매트릭스
```
os: [ubuntu, macos]
browser: [chromium, firefox, webkit]
node: [20, 22]
→ Unit(전 조합) · Integration/E2E(핵심 조합)
```
