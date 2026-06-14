import { describe, it, expect, afterEach } from 'vitest'
import * as fs   from 'fs'
import * as path from 'path'
import { writeManifest } from '../src/generator'
import type { Manifest } from '../src/types'

const TMP_PATH = path.join(process.cwd(), 'tmp-test-manifest.json')

const minimalManifest: Manifest = {
  schemaVersion: '1.0.0',
  version:       '0.0.0',
  app:           'test-app',
  generatedAt:   '2024-01-01T00:00:00.000Z',
  capabilities:  [
    {
      id:          'get_widget',
      name:        'Get Widget',
      description: 'Retrieve a widget by ID.',
      examples:    ['Get widget', 'Show widget'],
      params:      [],
      returns:     ['widget'],
      resolver:    { type: 'api', endpoints: [{ method: 'GET', path: '/widgets/{id}' }] },
      privacy:     { level: 'public' },
    },
  ],
}

afterEach(() => {
  for (const p of [TMP_PATH, `${TMP_PATH}.tmp`]) {
    try { fs.unlinkSync(p) } catch {}
  }
})

describe('writeManifest()', () => {
  it('returns { path, bytes } — not a plain string', () => {
    const result = writeManifest(minimalManifest, TMP_PATH)

    expect(typeof result).toBe('object')
    expect(typeof result.path).toBe('string')
    expect(typeof result.bytes).toBe('number')
  })

  it('path is the absolute resolved output path', () => {
    const result = writeManifest(minimalManifest, TMP_PATH)
    expect(result.path).toBe(TMP_PATH)
    expect(path.isAbsolute(result.path)).toBe(true)
  })

  it('bytes matches the actual file size on disk', () => {
    const result = writeManifest(minimalManifest, TMP_PATH)
    const stat   = fs.statSync(TMP_PATH)
    expect(result.bytes).toBe(stat.size)
  })

  it('bytes is non-zero', () => {
    const result = writeManifest(minimalManifest, TMP_PATH)
    expect(result.bytes).toBeGreaterThan(0)
  })

  it('file exists at the returned path after write', () => {
    const result = writeManifest(minimalManifest, TMP_PATH)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  it('no stale .tmp file left behind after successful write', () => {
    writeManifest(minimalManifest, TMP_PATH)
    expect(fs.existsSync(`${TMP_PATH}.tmp`)).toBe(false)
  })

  it('written file is valid JSON matching the input manifest', () => {
    writeManifest(minimalManifest, TMP_PATH)
    const raw    = fs.readFileSync(TMP_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.app).toBe(minimalManifest.app)
    expect(parsed.capabilities).toHaveLength(1)
    expect(parsed.capabilities[0].id).toBe('get_widget')
  })

  it('larger manifest produces proportionally larger byte count', () => {
    const small = writeManifest(minimalManifest, TMP_PATH)

    const bigManifest: Manifest = {
      ...minimalManifest,
      capabilities: Array.from({ length: 50 }, (_, i) => ({
        ...minimalManifest.capabilities[0],
        id:   `get_widget_${i}`,
        name: `Get Widget ${i}`,
      })),
    }
    const big = writeManifest(bigManifest, TMP_PATH)

    expect(big.bytes).toBeGreaterThan(small.bytes)
  })

  it('rejects path traversal outside cwd', () => {
    expect(() => writeManifest(minimalManifest, '../outside.json'))
      .toThrow('resolves outside the working directory')
  })
})
