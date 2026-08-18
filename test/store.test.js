import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CatalogStore } from '../src/store.js'

function catalog(name = 'fixture') {
  return {
    name: 'dshget',
    categories: { dev: { en: 'Development', zh: '开发' } },
    plugins: [{
      owner: 'example',
      name,
      description: { en: 'Fixture plugin', zh: '' },
      category: 'dev',
      install: `dsh plugin --profile web add github:example/${name}`,
      url: `https://github.com/example/${name}`,
    }],
  }
}

async function temporaryStore(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshget-plugin-test-'))
  const cachePath = path.join(directory, 'cache', 'catalog.json')
  const store = new CatalogStore({
    cachePath,
    dataUrl: 'https://data.invalid/catalog.json',
    cacheTtlMs: 60_000,
    requestTimeoutMs: 1_000,
    maxCatalogBytes: 100_000,
    ...options,
  })
  return { directory, cachePath, store }
}

test('loads the embedded catalog when no cache exists', async () => {
  const context = await temporaryStore()
  try {
    const state = await context.store.load()
    assert.equal(state.source, 'embedded')
    assert.equal(state.stale, true)
    assert.ok(state.catalog.plugins.length > 2_000)
  } finally {
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('loads a valid cache and reports staleness from mtime', async () => {
  const context = await temporaryStore()
  try {
    await mkdir(path.dirname(context.cachePath), { recursive: true })
    await writeFile(context.cachePath, JSON.stringify(catalog()))
    const old = new Date(Date.now() - 120_000)
    await utimes(context.cachePath, old, old)
    const state = await context.store.load()
    assert.equal(state.source, 'cache')
    assert.equal(state.stale, true)
    assert.equal(state.catalog.plugins[0].name, 'fixture')
  } finally {
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('refreshes, validates, and atomically caches remote data', async () => {
  const remote = catalog('remote-plugin')
  const context = await temporaryStore({
    fetchImpl: async () => new Response(JSON.stringify(remote), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  try {
    const state = await context.store.refresh()
    assert.equal(state.source, 'remote')
    assert.equal(state.stale, false)
    assert.equal(state.catalog.plugins[0].name, 'remote-plugin')
    assert.deepEqual(JSON.parse(await readFile(context.cachePath, 'utf8')), remote)
  } finally {
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('does not replace the catalog with malformed remote data', async () => {
  const context = await temporaryStore({
    fetchImpl: async () => new Response(JSON.stringify({ plugins: [] }), { status: 200 }),
  })
  try {
    await assert.rejects(context.store.refresh(), /categories/)
    const fallback = await context.store.load()
    assert.equal(fallback.source, 'embedded')
  } finally {
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('enforces the remote catalog byte limit', async () => {
  const context = await temporaryStore({
    fetchImpl: async () => new Response('x', {
      status: 200,
      headers: { 'content-length': '100001' },
    }),
  })
  try {
    await assert.rejects(context.store.refresh(), /larger than/)
  } finally {
    await rm(context.directory, { recursive: true, force: true })
  }
})
