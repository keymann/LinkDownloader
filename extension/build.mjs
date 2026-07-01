// esbuild 번들러 — src/*.ts → dist/*.js + 정적 파일 복사. MV3 로드는 dist/ 폴더 사용.
import * as esbuild from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
const outdir = 'dist'

await rm(outdir, { recursive: true, force: true })
await mkdir(`${outdir}/popup`, { recursive: true })
await mkdir(`${outdir}/icons`, { recursive: true })

/** @type {import('esbuild').BuildOptions} */
const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'info', legalComments: 'none' }

const ctx = await esbuild.context({
  ...common,
  entryPoints: {
    background: 'src/background.ts',
    'content-iso': 'src/content-iso.ts',
    'hook-main': 'src/hook-main.ts',
    offscreen: 'src/offscreen.ts',
    'popup/popup': 'src/popup/popup.ts',
  },
  outdir,
})

async function copyStatic() {
  await cp('manifest.json', `${outdir}/manifest.json`)
  await cp('src/offscreen.html', `${outdir}/offscreen.html`)
  await cp('src/popup/popup.html', `${outdir}/popup/popup.html`)
  await cp('icons', `${outdir}/icons`, { recursive: true }).catch(() => {})
}

if (watch) {
  await ctx.rebuild()
  await copyStatic()
  await ctx.watch()
  console.log('watching…')
} else {
  await ctx.rebuild()
  await copyStatic()
  await ctx.dispose()
  console.log('built → dist/')
}
