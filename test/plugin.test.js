import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../src/index.js'

function outputReader(text) {
  return { readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }) }
}

function harness() {
  const tools = []
  const commands = []
  const spawns = []
  const services = {
    tools: { register(definition) { tools.push(definition); return () => {} } },
    commands: { register(definition) { commands.push(definition); return () => {} } },
    subprocess: {
      async resolveExecutable(command) {
        assert.equal(command, 'dsh')
        return '/usr/local/bin/dsh'
      },
      spawn(spec) {
        spawns.push(spec)
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: outputReader('installed\n'),
            stderr: outputReader(''),
          },
        }
      },
    },
  }
  const context = {
    ...services,
    logger() { return { warn() {} } },
    inject(names, callback) {
      assert.ok(names.every(name => services[name] !== undefined))
      callback({ ...this, ...services })
    },
  }
  return { context, tools, commands, spawns }
}

function invocation(rawInput) {
  return {
    rawInput,
    signal: new AbortController().signal,
    agent: {},
  }
}

test('registers one human command and two read-only model tools', () => {
  const runtime = harness()
  apply(runtime.context)
  assert.deepEqual(runtime.commands.map(command => command.name), ['dshget'])
  assert.deepEqual(runtime.tools.map(tool => tool.name), ['dshget_search', 'dshget_plugin_info'])
})

test('human search and info commands use the embedded catalog', async () => {
  const runtime = harness()
  apply(runtime.context, { maxResults: 3 })
  const command = runtime.commands[0]

  const search = await command.handler(invocation('search memory'))
  assert.equal(search.kind, 'success')
  assert.match(search.text, /DSH Get search: memory/)
  assert.match(search.text, /Catalog: embedded/)

  const info = await command.handler(invocation('info volcengine/OpenViking#examples/dsh-memory-plugin'))
  assert.equal(info.kind, 'success')
  assert.match(info.text, /OpenViking#examples\/dsh-memory-plugin/)
  assert.match(info.text, /https:\/\/www\.dshget\.com\/plugins\/volcengine\/OpenViking%23examples%2Fdsh-memory-plugin/)
})

test('human install command executes a fixed argv without a shell', async () => {
  const runtime = harness()
  apply(runtime.context, { profile: 'web', dshHome: path.join(os.tmpdir(), 'dshget-plugin-test-missing-home') })
  const result = await runtime.commands[0].handler(invocation('install volcengine/OpenViking#examples/dsh-memory-plugin'))

  assert.equal(result.kind, 'success')
  assert.match(result.text, /Restart DSH/)
  assert.equal(runtime.spawns.length, 3)
  const install = runtime.spawns.find(spawn => spawn.argv.includes('add'))
  assert.deepEqual(install.argv, [
    '/usr/local/bin/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    '-w',
    'github:volcengine/OpenViking#path:/examples/dsh-memory-plugin',
  ])
  assert.equal(install.stdio.stdin, 'ignore')
  assert.deepEqual(runtime.spawns.filter(spawn => spawn.argv.includes('--dump-config')).map(spawn => spawn.argv), [
    ['/usr/local/bin/dsh', '--profile', 'web', '--dump-config'],
    ['/usr/local/bin/dsh', '--profile', 'web', '--dump-config'],
  ])
})

test('installation can be disabled without affecting search', async () => {
  const runtime = harness()
  apply(runtime.context, { allowInstall: false })
  const result = await runtime.commands[0].handler(invocation('install volcengine/OpenViking#examples/dsh-memory-plugin'))
  assert.equal(result.kind, 'error')
  assert.match(result.text, /disabled/)
  assert.equal(runtime.spawns.length, 0)
})

test('model tools return structured read-only records', async () => {
  const runtime = harness()
  apply(runtime.context)
  const searchTool = runtime.tools.find(tool => tool.name === 'dshget_search')
  const infoTool = runtime.tools.find(tool => tool.name === 'dshget_plugin_info')

  const search = await searchTool.execute({ query: 'better sidebar', limit: 2 }, {})
  assert.equal(search.query, 'better sidebar')
  assert.ok(search.total >= 1)
  assert.ok(search.results.length <= 2)
  assert.ok(search.results.every(item => item.detailsUrl.startsWith('https://www.dshget.com/plugins/')))

  const info = await infoTool.execute({ plugin: search.results[0].id }, {})
  assert.equal(info.id, search.results[0].id)
  assert.match(info.installCommand, /^dsh plugin /)
})
