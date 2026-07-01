// 크로스브라우저 런타임 추상화 — docs/research/05, 10 §10.
// - Firefox는 promise 기반 `browser.*`, Chrome은 MV3에서 promise를 지원하는 `chrome.*`.
//   `api`를 통해 양쪽에서 동일하게 promise API를 쓴다. (타입은 @types/chrome의 chrome 네임스페이스 사용)
// - DOM 가용성/offscreen 지원 여부로 DASH 파싱·세그먼트 재조합의 실행 위치를 결정한다.

declare const browser: typeof chrome | undefined

// Firefox: globalThis.browser(promise). Chrome: globalThis.chrome(MV3 promise).
export const api: typeof chrome =
  (typeof browser !== 'undefined' ? browser : undefined) ?? chrome

// 현재 컨텍스트에 DOMParser/createObjectURL이 있는가?
// - Chrome background = service worker → 없음(→ offscreen 필요)
// - Firefox background = event page → 있음(→ 직접 처리 가능)
export const HAS_DOM =
  typeof DOMParser !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function'

// chrome.offscreen 지원(Chrome 계열 전용)
export const HAS_OFFSCREEN = typeof (api as { offscreen?: unknown }).offscreen !== 'undefined'
