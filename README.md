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

1. 프로덕션 KV 네임스페이스 생성:
   ```bash
   npx wrangler kv namespace create LINKDL_KV
   ```
   출력된 `id` 를 `wrangler.toml` 의 `kv_namespaces` 항목에 채운다.

2. 배포:
   ```bash
   npm run deploy        # = build 후 wrangler pages deploy dist
   ```
   또는 Cloudflare 대시보드에서 Git 연동 시 — Build command: `npm run build`, Output: `dist`,
   그리고 Settings → Functions → KV bindings 에 `LINKDL_KV` 를 연결한다.

3. 최초 로그인(`keymann` / `dlsghcjsxh82`) 시 KV 에 계정이 부트스트랩된다. 이후 설정에서 비밀번호 변경 권장.

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
