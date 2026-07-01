# 11. 세그먼트 재조합 · Remux 상세

> [01 §5](./01-technical-research.md)·[09](./09-parser-spec.md)의 다운로드 단계 심화.
> **비암호화 표준 스트림만** 대상. **재인코딩(transcode)은 범위 밖**이며, "remux"(재컨테이너화, 무손실)만 다룬다.
> 암호화 세그먼트는 진입 자체가 차단된다([04](./04-risk-analysis.md) fail-closed).

## 0. 용어: concat vs remux vs transcode

| 구분 | 의미 | 비용 | 본 프로젝트 |
|---|---|---|---|
| **concat** | 세그먼트 바이트 이어붙이기 | 매우 낮음 | 기본 경로 |
| **remux** | 디먹스→다른 컨테이너로 재포장(코덱 유지) | 중 | 선택(ffmpeg.wasm/mux.js) |
| **transcode** | 코덱 재인코딩 | 매우 높음 | **제외** |

핵심 판단: **컨테이너가 이미 "이어붙이기 가능"한가?**
- fMP4(CMAF): init + media 세그먼트를 **그대로 concat → 유효한 fMP4 스트림**(대부분 플레이어 재생 가능).
- MPEG-TS(.ts): 각 세그먼트가 독립적 TS → **concat만으로도 재생되는 경우가 많음**(단, 표준 `.mp4`는 아님).
- 분리 트랙(DASH video+audio 별도): concat만으로는 한 파일에 못 합침 → **remux 또는 트랙별 분리 저장** 필요.

---

## 1. 컨테이너 기초

### 1.1 ISOBMFF (MP4 / fMP4) 박스 구조
```
progressive MP4               fragmented MP4 (fMP4/CMAF)
┌───────────┐                 ┌───────────┐  init segment
│ ftyp      │                 │ ftyp      │
│ moov      │ (전체 인덱스)    │ moov      │ (샘플 없음, 트랙 정의 + mvex)
│ mdat      │ (전체 미디어)    ├───────────┤  media segment 1
└───────────┘                 │ styp      │
                              │ (sidx?)   │
box = [size(4B)][type(4B)]... │ moof      │ (프래그먼트 인덱스: tfhd,trun)
                              │ mdat      │ (프래그먼트 샘플)
                              ├───────────┤  media segment 2 ...
                              │ styp/moof/mdat │
                              └───────────┘
```
- box: 빅엔디안 `size`(4B) + `type`(4B, ASCII). size=1이면 64bit largesize.
- **init segment** = `ftyp`+`moov`(mvex 포함). **media segment** = (`styp`)+(`sidx`)+`moof`+`mdat` 반복.

### 1.2 MPEG-TS (.ts)
```
188바이트 고정 패킷 × N
[0x47 sync(1B)][flags+PID(2B)][adaptation/continuity(1B)][payload...]
PID 0 = PAT → PMT PID → (PMT) → 비디오/오디오 ES PID
PES 패킷이 여러 TS 패킷에 분할되어 실림
```
- HLS `.ts` 세그먼트는 각각 PAT/PMT를 포함 → **단순 concat도 재생 가능**한 경우가 많음.
- 표준 `.mp4`가 필요하면 TS→MP4 remux 필요(디먹스 후 mp4 박스 생성).

---

## 2. 재조합 결정 트리

```
[ELIGIBLE 스트림]
   │
   ├─ 단일 progressive 파일(mp4/webm)? ── Y ─▶ 그대로 저장(Range 스트리밍)  [concat 불필요]
   │                                   N
   ├─ HLS/DASH 세그먼트?
   │     │
   │     ├─ 세그먼트 컨테이너 = fMP4? ── Y ─▶ init + media concat → .mp4(fragmented) 저장
   │     │                             N
   │     ├─ 세그먼트 = MPEG-TS?     ── Y ─▶ (a) .ts concat 저장(기본)
   │     │                                   (b) 사용자가 .mp4 원하면 → remux(ffmpeg.wasm/mux.js)
   │     │
   │     └─ 비디오/오디오 분리 트랙? ─ Y ─▶ (a) 트랙별 분리 저장(기본, 무비용)
   │                                       (b) 단일 파일 원하면 → remux(mux)
   └─ (LIVE/암호화/불명확) ───────────────▶ 저장 안 함(§04)
```

---

## 3. 무비용 경로: concat

### 3.1 fMP4 concat (권장, 유효 컨테이너)
```
async function assembleFmp4(init: SegmentRef, media: SegmentRef[], writer, signal):
    if init: await pipe(fetchSeg(init), writer)          # ftyp+moov 먼저
    for seg in media:                                    # 순서 보존 필수
        await pipe(fetchSeg(seg, seg.byteRange), writer) # styp/moof/mdat 이어붙임
    # 결과: 유효한 fragmented MP4 (대부분 플레이어·QuickTime/VLC 재생)
```
> fMP4 concat 결과는 **valid**하다(각 fragment가 self-describing). progressive로 만들려면 §4.

### 3.2 TS concat (기본, 컨테이너는 .ts 유지)
```
async function assembleTs(media: SegmentRef[], writer, signal):
    for seg in media:
        await pipe(fetchSeg(seg, seg.byteRange), writer)
    # 결과: .ts (MPEG-TS). 대부분 플레이어 재생. 표준 .mp4 아님.
```

### 3.3 바이트 무결성 규칙
- **순서 보존**(seq/타임라인 순), 누락 금지(실패 세그먼트 → 전체 폐기 또는 재시도).
- `#EXT-X-BYTERANGE`/SegmentBase는 `Range: bytes=offset-(offset+len-1)`로 부분 취득.
- `#EXT-X-DISCONTINUITY`/다중 Period 경계 → concat은 가능하나 재생 호환성 경고.

---

## 4. Remux 경로 (선택): 코덱 유지, 컨테이너 변경

재인코딩 없이 **디먹스 후 재포장**. 브라우저 내 3가지 옵션:

| 옵션 | 입력→출력 | 장점 | 단점 |
|---|---|---|---|
| **바이트 concat** | fMP4→fMP4, ts→ts | 무비용, 의존성 0 | 컨테이너 변경/트랙 병합 불가 |
| **mux.js** | TS→fMP4 | 경량(JS), TS 처리 특화 | 유지보수·코덱 범위 제한 |
| **ffmpeg.wasm** | 거의 모든 remux(ts→mp4, av 병합, frag→progressive) | 강력·범용 | 큰 wasm(수 MB), CPU/메모리, 로드 시간 |

> **권장 정책**: 기본은 concat(무비용). 사용자가 "표준 MP4/단일 파일"을 명시 요청할 때만 remux 옵트인
> (ffmpeg.wasm 지연 로드). 확장/자동화 모두 동일 코어 인터페이스.

### 4.1 ffmpeg.wasm remux 예시(개념)
```
# ts 세그먼트 → 표준 mp4 (재인코딩 없이 -c copy)
await ffmpeg.writeFile('in.ts', concat(tsSegments))
await ffmpeg.exec(['-i','in.ts','-c','copy','-movflags','+faststart','out.mp4'])
data = await ffmpeg.readFile('out.mp4')            # 코덱 유지, 컨테이너만 MP4
```
```
# DASH 분리 트랙 병합(video.mp4 + audio.mp4 → muxed.mp4, copy)
await ffmpeg.exec(['-i','v.mp4','-i','a.mp4','-c','copy','muxed.mp4'])
```

### 4.2 frag MP4 → progressive MP4
- fMP4 concat 결과를 progressive(단일 moov)로 바꾸려면 moov 재계산 필요 → ffmpeg.wasm `-c copy`가 처리.
- 대부분의 경우 fMP4 그대로도 충분하므로 **기본은 변환 안 함**.

---

## 5. 스트리밍 저장(메모리 안전) — [07](./07-performance-optimization.md) 연계

```
# 대용량은 전체 메모리 적재 금지. WritableStream(File System Access) 또는
# 확장은 blob 조립 최소화 + chrome.downloads.
async function pipe(readable, writer):
    reader = readable.getReader()
    while (chunk = await reader.read()) not done:
        await writer.write(chunk.value)     # 상수 메모리
# concat 경로는 스트리밍 가능. remux(ffmpeg.wasm)는 파일 단위라 메모리 피크 존재 → 크기 상한/경고.
```
| 경로 | 메모리 특성 | 대용량 대응 |
|---|---|---|
| concat(fMP4/ts) | 스트리밍(상수) | ✅ 안전 |
| ffmpeg.wasm remux | 입출력 파일을 wasm FS에 적재 | 크기 상한, 경고, 옵트인 |

---

## 6. 재조합 오류 처리

| 상황 | 처리 |
|---|---|
| 세그먼트 fetch 실패 | 지수 백오프 재시도 → 최종 실패 시 전체 폐기(부분 파일 저장 금지) |
| 순서/시퀀스 불일치 | seq/startTime 정렬 검증, 불일치 시 중단 |
| init 누락(fMP4인데 EXT-X-MAP 없음) | 첫 세그먼트가 init 포함인지 스니핑, 아니면 CONDITIONAL |
| 컨테이너 혼합(discontinuity) | 경고 + concat 유지 또는 remux 권고 |
| 진행 중 암호화 태그 발견 | **즉시 중단**(재확인 게이트) |

---

## 7. 공개 인터페이스 (코어)

```ts
interface Remuxer {
  // 무비용 기본 경로(스트리밍)
  assemble(plan: AssemblePlan, writer: WritableStreamDefaultWriter,
           opts: { onProgress; signal }): Promise<void>
  // 옵트인 remux (표준 mp4/트랙 병합) — ffmpeg.wasm 지연 로드
  remux(plan: AssemblePlan, target: 'mp4', opts): Promise<Uint8Array>
}
type AssemblePlan =
  | { mode:'progressive'; url:string }
  | { mode:'fmp4-concat'; init?:SegmentRef; media:SegmentRef[] }
  | { mode:'ts-concat'; media:SegmentRef[] }
  | { mode:'separate-tracks'; tracks: {kind:'video'|'audio'; init?:SegmentRef; media:SegmentRef[]}[] }
```
> 참조 구현: [`extension/src/core/remux.ts`](../../extension/src/core/remux.ts) (concat 경로 구현, remux는 옵트인 스텁).

## 8. 요약 지침
- **기본은 concat**(무손실·무비용·스트리밍): fMP4→유효 mp4, ts→ts, 분리트랙→개별 저장.
- **remux는 옵트인**: 사용자가 표준 MP4/단일 파일 요구 시에만 ffmpeg.wasm(코덱 copy).
- **transcode·복호화·우회는 하지 않는다.**
