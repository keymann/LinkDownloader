# Link Downloader

[![CI](https://github.com/keymann/LinkDownloader/actions/workflows/ci.yml/badge.svg)](https://github.com/keymann/LinkDownloader/actions/workflows/ci.yml)

Cloudflare Workers(static assets) 위에서 동작하는 동영상 다운로드 웹 클라이언트.
임의 URL 웹페이지에서 동영상 소스를 찾아 기기로 다운로드한다.

- **프론트엔드:** React + Vite (TypeScript), 빌드 산출물은 `[assets]` 로 서빙
- **백엔드:** Cloudflare Worker (`worker/`) — `/api/*` 라우팅, 그 외 정적 자산/SPA 폴백
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

# 1) Worker(정적 자산 + /api + KV)를 로컬로 실행
npm run build
npx wrangler dev --port 8787
# → http://localhost:8787 접속 (정적 자산 + Worker 통합, KV 로컬 시뮬레이션)

# 또는 프론트 핫리로드가 필요하면 두 프로세스로:
#   터미널 A: npx wrangler dev --port 8787
#   터미널 B: npm run dev   (vite, /api 는 8787 로 프록시)
```

## Cloudflare Workers 배포

> 이 프로젝트는 **Workers(static assets) 프로젝트**입니다. 배포는 `wrangler deploy` 를 사용합니다.
> Workers Builds가 자동 주입하는 토큰이 Workers 배포 권한을 가지므로 별도 `CLOUDFLARE_API_TOKEN` 이
> 필요 없습니다.

### 1) KV 네임스페이스 생성 (최초 1회)
```bash
npx wrangler kv namespace create LINKDL_KV
npx wrangler kv namespace create LINKDL_KV --preview
```
출력된 `id` / `preview_id` 를 `wrangler.toml` 의 `[[kv_namespaces]]` 에 채웁니다. (본 저장소는 반영 완료)

### 2) 대시보드에서 Git 저장소 연결 (Workers Builds)
Cloudflare 대시보드 → **Workers & Pages → Create → Workers → Connect to Git** 로 저장소를 연결하고
Build 설정을 다음과 같이 지정합니다:

| 항목 | 값 |
|---|---|
| **Build command** | `npm run build` |
| **Deploy command** | `npx wrangler deploy` |

- KV 바인딩·assets 는 `wrangler.toml` 로 자동 적용됩니다.
- ⚠️ `wrangler.toml` 에 `pages_build_output_dir` 가 있으면 Pages로 인식되어 `wrangler deploy` 가
  거부됩니다. 본 저장소는 `main` + `[assets]` 구성이라 문제 없습니다.

### 3) (대안) 로컬에서 수동 CLI 배포
```bash
npx wrangler login      # OAuth 로그인 (최초 1회)
npm run deploy          # = npm run build && wrangler deploy
```

### 4) 최초 로그인
`keymann` / `dlsghcjsxh82` 로그인 시 KV 에 계정이 부트스트랩됩니다. 이후 설정에서 비밀번호 변경을 권장합니다.

## 구조

```
worker/               # Cloudflare Worker (백엔드)
  index.ts              # fetch 진입점: /api/* 라우팅 + 인증 가드 + 초기 사용자 부트스트랩,
                        #   그 외 요청은 env.ASSETS 로 위임(정적/SPA 폴백)
  api/                  # login, logout, session, change-password, extract, proxy, hls, history
  lib/                  # auth, crypto, http(SSRF 가드), htmlparse
src/                  # React 앱
  pages/                # Login, Main, History, Settings
  components/            # Nav, Modal, DownloadDialog, DownloadList
  download/             # engine(스트리밍/진행/취소), fsAccess(저장 대상), DownloadContext
  auth/ api/ utils/
```
