# Link Downloader

Cloudflare Pages 위에서 동작하는 동영상 다운로드 웹 클라이언트.
임의 URL 웹페이지에서 동영상 소스를 찾아 기기로 다운로드한다.

- **프론트엔드:** React + Vite (TypeScript)
- **백엔드:** Cloudflare Pages Functions (`functions/`)
- **저장소:** Cloudflare KV (계정 · 세션 · 히스토리)

## 기능

- 반응형 UI (모바일 하단 탭 / 태블릿 사이드 레일 / PC 사이드바)
- 로그인 (초기 계정 `keymann` / `dlsghcjsxh82` — 최초 접근 시 자동 등록)
- 세션 쿠키로 로그아웃 전까지 로그인 유지
- 메인 / 히스토리 / 설정 구성
- URL 분석 → 동영상 소스 탐지 → 썸네일·용량·예상시간 표시 → 다운로드 확인 팝업
- File System Access API 지원 환경에서 저장 위치 선택 (미지원 시 기본 폴더 fallback)
- 다운로드 진행률(%) · 경과/남은 시간 · 취소
- HLS(.m3u8) 세그먼트 재조합 다운로드
- 히스토리 날짜별 그룹화 · 재다운로드 · 삭제
- 설정: 비밀번호 변경 · 배포 시각(버전) 표기

## 동영상 추출 범위 (기술적 한계)

브라우저 환경에서 가능한 fallback 케이스만 지원한다:
직접 파일 링크(.mp4/.webm 등), HTML5 `<video>`/`<source>`, `og:video`·`twitter:player`,
JSON-LD `VideoObject`, HLS(.m3u8)/DASH(.mpd).

> YouTube · Instagram · TikTok 등 보호된 플랫폼은 yt-dlp 급 추출 로직과 ToS 문제로 **지원하지 않는다.**
> HLS 는 세그먼트 연결만 하며 트랜스코딩은 하지 않는다(.ts 로 저장).

## 로컬 개발

```bash
npm install

# 1) 백엔드(Functions + KV)를 로컬로 실행
npm run build
npx wrangler pages dev dist --port 8788 --kv LINKDL_KV
# → http://localhost:8788 접속 (정적 + Functions 통합)

# 또는 프론트 핫리로드가 필요하면 두 프로세스로:
#   터미널 A: npx wrangler pages dev dist --port 8788 --kv LINKDL_KV
#   터미널 B: npm run dev   (vite, /api 는 8788 로 프록시)
```

## Cloudflare Pages 배포

> ✅ **권장: 네이티브 Pages Git 자동 배포** — 커스텀 배포 명령/`CLOUDFLARE_API_TOKEN` 없이
> Cloudflare 가 빌드 산출물과 `functions/` 를 자체 자격증명으로 자동 배포합니다. 배포 관련 오류
> (Workers 명령 오류, `Authentication error [code: 10000]`)가 근본적으로 발생하지 않습니다.

### 1) 프로덕션 KV 네임스페이스 생성 (최초 1회)
```bash
npx wrangler kv namespace create LINKDL_KV
npx wrangler kv namespace create LINKDL_KV --preview
```
출력된 `id` / `preview_id` 를 `wrangler.toml` 의 `[[kv_namespaces]]` 에 채웁니다. (본 저장소는 반영 완료)

### 2) 대시보드에서 Git 저장소 연결 (네이티브 Pages)
Cloudflare 대시보드 → **Workers & Pages → Create → Pages → Connect to Git** 로 저장소를 연결하고
Build configuration 을 다음과 같이 설정합니다:

| 항목 | 값 |
|---|---|
| Framework preset | `Vite` (또는 None) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Deploy command** | **(설정하지 않음 — 비워둠)** |
| 환경변수 `CLOUDFLARE_API_TOKEN` | **(불필요 — 있으면 제거)** |

- ⚠️ **Deploy command 를 넣지 마세요.** 커스텀 배포 명령(`wrangler deploy` / `wrangler pages deploy`)은
  커스텀 API 토큰을 요구하며, 토큰에 `Pages: Edit` 권한이 없으면 `Authentication error [code: 10000]`
  이 발생합니다. 네이티브 자동 배포는 토큰이 필요 없습니다.
- KV 바인딩은 `wrangler.toml` 의 `[[kv_namespaces]]` 로 자동 적용됩니다. (원하면 대시보드
  Settings → **Bindings** 에서 `LINKDL_KV` 를 직접 연결해도 됩니다.)

### 3) (대안) 로컬에서 수동 CLI 배포
CI 없이 로컬에서 배포하려면 `wrangler login`(OAuth) 후:
```bash
npm run deploy        # = npm run build && wrangler pages deploy
```
> CI 환경에서 `wrangler pages deploy` 를 쓰려면 `CLOUDFLARE_API_TOKEN` 에 **Account → Cloudflare Pages: Edit**
> (+ Workers KV Storage: Edit, Account Settings: Read, User Details: Read) 권한이 있어야 합니다.
> 커스텀 토큰은 사용자의 "Super Administrator" 역할과 무관하게 **명시된 스코프만** 가집니다.

### 4) 최초 로그인
`keymann` / `dlsghcjsxh82` 로그인 시 KV 에 계정이 부트스트랩됩니다. 이후 설정에서 비밀번호 변경을 권장합니다.

## 구조

```
functions/            # Cloudflare Pages Functions (백엔드)
  _middleware.ts        # /api/* 인증 가드 + 초기 사용자 부트스트랩
  api/                  # login, logout, session, change-password, extract, proxy, hls, history
  lib/                  # auth, crypto, http(SSRF 가드), htmlparse
src/                  # React 앱
  pages/                # Login, Main, History, Settings
  components/            # Nav, Modal, DownloadDialog, DownloadList
  download/             # engine(스트리밍/진행/취소), fsAccess(저장 대상), DownloadContext
  auth/ api/ utils/
```
