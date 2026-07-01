import { describe, expect, it } from 'vitest'
import { assemble, assembleToWriter, planToSegments, type AssemblePlan } from '../src/core/remux'

const files: Record<string, Uint8Array> = {
  'https://cdn/init.mp4': new Uint8Array([1, 2, 3]),
  'https://cdn/s0.m4s': new Uint8Array([4, 5]),
  'https://cdn/s1.m4s': new Uint8Array([6, 7, 8, 9]),
}
const okFetch = (async (u: string) =>
  files[u] ? new Response(files[u]) : new Response('', { status: 404 })) as typeof fetch

describe('planToSegments', () => {
  it('fmp4-concat = init + media in order', () => {
    const plan: AssemblePlan = { mode: 'fmp4-concat', init: { url: 'i' }, media: [{ url: 's0' }, { url: 's1' }] }
    expect(planToSegments(plan).map((s) => s.url)).toEqual(['i', 's0', 's1'])
  })
})

describe('assembleToWriter', () => {
  it('streams segments in order (constant memory)', async () => {
    const plan: AssemblePlan = { mode: 'fmp4-concat', init: { url: 'https://cdn/init.mp4' }, media: [{ url: 'https://cdn/s0.m4s' }, { url: 'https://cdn/s1.m4s' }] }
    const out: number[] = []
    const bytes = await assembleToWriter(plan, async (c) => { out.push(...c) }, { fetchImpl: okFetch })
    expect(bytes).toBe(9)
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('aborts mid-stream and stops fetching', async () => {
    const plan: AssemblePlan = { mode: 'ts-concat', media: [{ url: 's0' }, { url: 's1' }, { url: 's2' }] }
    let fetches = 0
    const ac = new AbortController()
    const slowFetch = (async (_u: string, init?: RequestInit) => {
      fetches++
      await new Promise((r) => setTimeout(r, 30))
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(new Uint8Array([fetches]))
    }) as typeof fetch
    setTimeout(() => ac.abort(), 40)
    await expect(assembleToWriter(plan, async () => {}, { fetchImpl: slowFetch, signal: ac.signal })).rejects.toThrow()
    expect(fetches).toBeLessThan(3)
  })
})

describe('assemble (Blob)', () => {
  it('ts-concat produces concatenated blob', async () => {
    const blob = await assemble({ mode: 'ts-concat', media: [{ url: 'https://cdn/s0.m4s' }, { url: 'https://cdn/s1.m4s' }] }, { fetchImpl: okFetch })
    expect(blob.size).toBe(6)
  })
})
