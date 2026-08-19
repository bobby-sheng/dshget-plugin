import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  findPlugin,
  parseDshgetCommand,
  parseInstallSpec,
  pluginResult,
  searchCatalog,
} from './core.js'
import { CatalogStore } from './store.js'

export const name = 'dshget-plugin'

const DEFAULT_DATA_URL = 'https://raw.githubusercontent.com/bobby-sheng/dshget-data/main/catalog.json'
const DEFAULT_WEBSITE_URL = 'https://www.dshget.com'

export const Config = Schema.object({
  dataUrl: Schema.string().default(DEFAULT_DATA_URL),
  websiteUrl: Schema.string().default(DEFAULT_WEBSITE_URL),
  profile: Schema.string().default('web'),
  dshCommand: Schema.string().default('dsh'),
  cachePath: Schema.string(),
  cacheTtlHours: Schema.number().default(24),
  requestTimeoutMs: Schema.number().default(15_000),
  maxCatalogBytes: Schema.number().default(20_000_000),
  maxResults: Schema.number().default(10),
  allowInstall: Schema.boolean().default(true),
})

function resolveConfig(config) {
  const resolved = {
    dataUrl: config.dataUrl ?? DEFAULT_DATA_URL,
    websiteUrl: config.websiteUrl ?? DEFAULT_WEBSITE_URL,
    profile: config.profile ?? 'web',
    dshCommand: config.dshCommand ?? 'dsh',
    cachePath: config.cachePath ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'cache', 'dshget', 'catalog.json'),
    cacheTtlHours: config.cacheTtlHours ?? 24,
    requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
    maxCatalogBytes: config.maxCatalogBytes ?? 20_000_000,
    maxResults: config.maxResults ?? 10,
    allowInstall: config.allowInstall ?? true,
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(resolved.profile)) throw new Error('dshget-plugin: profile must be a safe profile name')
  if (!/^[A-Za-z0-9._/-]+$/.test(resolved.dshCommand)) throw new Error('dshget-plugin: dshCommand must be a bare name or absolute path')
  if (!Number.isFinite(resolved.cacheTtlHours) || resolved.cacheTtlHours < 0) throw new Error('dshget-plugin: cacheTtlHours must be non-negative')
  if (!Number.isFinite(resolved.requestTimeoutMs) || resolved.requestTimeoutMs <= 0) throw new Error('dshget-plugin: requestTimeoutMs must be positive')
  if (!Number.isSafeInteger(resolved.maxCatalogBytes) || resolved.maxCatalogBytes < 100_000) throw new Error('dshget-plugin: maxCatalogBytes must be an integer of at least 100000')
  if (!Number.isSafeInteger(resolved.maxResults) || resolved.maxResults < 1 || resolved.maxResults > 50) throw new Error('dshget-plugin: maxResults must be an integer between 1 and 50')
  return resolved
}

function formatSearch(query, state, result, websiteUrl) {
  const lines = [
    `DSH Get search: ${query}`,
    `${result.total} matches; showing ${result.plugins.length}. Catalog: ${state.source}${state.stale ? ' (stale snapshot)' : ''}.`,
  ]
  for (const plugin of result.plugins) {
    const item = pluginResult(plugin, websiteUrl)
    lines.push(`- ${item.id} [${item.category}, ★${item.stars}]`)
    if (item.description) lines.push(`  ${item.description}`)
    lines.push(`  ${item.detailsUrl}`)
  }
  return lines.join('\n')
}

function formatInfo(plugin, websiteUrl) {
  const item = pluginResult(plugin, websiteUrl)
  return [
    `${item.id}`,
    item.description,
    `Category: ${item.category}`,
    `Stars: ${item.stars}`,
    `Installable: ${item.installable ? 'yes' : 'no'}`,
    `Install: ${item.installCommand}`,
    `Repository: ${item.repositoryUrl}`,
    `DSH Get: ${item.detailsUrl}`,
  ].filter(Boolean).join('\n')
}

async function installPlugin(ctx, config, plugin, signal) {
  if (!config.allowInstall) throw new Error('installation is disabled by dshget-plugin configuration')
  if (plugin.installable === false) throw new Error(`${plugin.owner}/${plugin.name} is not marked installable`)
  const spec = parseInstallSpec(plugin.install)
  const executable = await ctx.subprocess.resolveExecutable(config.dshCommand, undefined, signal)
  const handle = ctx.subprocess.spawn({
    argv: [executable, 'plugin', '--profile', config.profile, 'add', '-w', spec],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs: 5_000,
    signal,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text.trim() ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
  if (signal.aborted) throw new Error('installation cancelled')
  if (outcome.exitCode !== 0) {
    const detail = [stderr, stdout].filter(Boolean).join('\n').slice(-8_000)
    throw new Error(`dsh plugin add failed${outcome.exitCode === null ? '' : ` with exit code ${outcome.exitCode}`}${detail ? `:\n${detail}` : ''}`)
  }
  return [
    `Installed ${plugin.owner}/${plugin.name} into profile ${config.profile}.`,
    `Package: ${spec}`,
    'Restart DSH to load the newly installed plugin.',
    stdout,
  ].filter(Boolean).join('\n')
}

async function handleCommand(ctx, config, store, invocation) {
  const { action, value } = parseDshgetCommand(invocation.rawInput)
  if (action === 'help') {
    return {
      kind: 'success',
      text: [
        'DSH Get plugin directory',
        '/dshget search <query>',
        '/dshget info <owner/name>',
        '/dshget install <owner/name>',
        '/dshget update',
        '/dshget status',
        'Browse: https://www.dshget.com/',
      ].join('\n'),
    }
  }

  try {
    if (action === 'update') {
      const state = await store.refresh(invocation.signal)
      return { kind: 'success', text: `DSH Get catalog updated: ${state.catalog.plugins.length} plugins.` }
    }
    const state = await store.load()
    if (action === 'status') {
      return {
        kind: 'success',
        text: `DSH Get catalog: ${state.catalog.plugins.length} plugins; source ${state.source}${state.stale ? '; snapshot is older than the configured TTL' : ''}.`,
      }
    }
    if (action === 'search') {
      if (!value) return { kind: 'error', text: 'Usage: /dshget search <query>' }
      const result = searchCatalog(state.catalog, { query: value, limit: config.maxResults })
      return { kind: 'success', text: formatSearch(value, state, result, config.websiteUrl) }
    }
    if (action === 'info') {
      if (!value) return { kind: 'error', text: 'Usage: /dshget info <owner/name>' }
      const plugin = findPlugin(state.catalog, value)
      if (!plugin) return { kind: 'error', text: `Plugin not found or name is ambiguous: ${value}` }
      return { kind: 'success', text: formatInfo(plugin, config.websiteUrl) }
    }
    if (action === 'install') {
      if (!value) return { kind: 'error', text: 'Usage: /dshget install <owner/name>' }
      const plugin = findPlugin(state.catalog, value)
      if (!plugin) return { kind: 'error', text: `Plugin not found or name is ambiguous: ${value}` }
      return { kind: 'success', text: await installPlugin(ctx, config, plugin, invocation.signal) }
    }
    return { kind: 'error', text: `Unknown subcommand: ${action}. Run /dshget for help.` }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

const PLUGIN_RESULT_PROPERTIES = {
  id: { type: 'string', required: true },
  name: { type: 'string', required: true },
  owner: { type: 'string', required: true },
  description: { type: 'string', required: true },
  category: { type: 'string', required: true },
  stars: { type: 'number', required: true },
  installable: { type: 'boolean', required: true },
  installCommand: { type: 'string', required: true },
  repositoryUrl: { type: 'string', required: true },
  detailsUrl: { type: 'string', required: true },
}

function registerTools(ctx, config, store) {
  ctx.tools.register(defineTool({
    name: 'dshget_search',
    description: 'Search the DSH Get catalog for DeepSeek Harness plugins by name, author, category, tag, or description.',
    parameters: {
      query: { type: 'string', required: true, description: 'Plugin name, author, category, tag, or capability.' },
      category: { type: 'string', description: 'Optional exact DSH Get category key.' },
      limit: { type: 'number', description: 'Maximum results, from 1 to 50. Defaults to the plugin configuration.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          total: { type: 'number', required: true },
          source: { type: 'string', required: true },
          stale: { type: 'boolean', required: true },
          results: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: false, properties: PLUGIN_RESULT_PROPERTIES },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const state = await store.load()
      const limit = args.limit ?? config.maxResults
      const result = searchCatalog(state.catalog, {
        query: args.query,
        category: args.category,
        limit,
      })
      return {
        query: args.query,
        total: result.total,
        source: state.source,
        stale: state.stale,
        results: result.plugins.map(plugin => pluginResult(plugin, config.websiteUrl)),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Search DSH Get', kind: 'search', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'dshget_plugin_info',
    description: 'Read one DeepSeek Harness plugin record from DSH Get. Use owner/name when available.',
    parameters: {
      plugin: { type: 'string', required: true, description: 'owner/name, plugin name, DSH Get URL, or GitHub URL.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: PLUGIN_RESULT_PROPERTIES },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const state = await store.load()
      const plugin = findPlugin(state.catalog, args.plugin)
      if (!plugin) throw new Error(`Plugin not found or name is ambiguous: ${args.plugin}`)
      return pluginResult(plugin, config.websiteUrl)
    },
    presentCall: args => ({ card: 'generic', title: 'Read DSH Get plugin', kind: 'read', rawInput: args.plugin }),
  }))
}

/** Register DSH Get commands and model tools on the services available in this profile. */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('dshget-plugin')
  const store = new CatalogStore({
    cachePath: resolved.cachePath,
    dataUrl: resolved.dataUrl,
    cacheTtlMs: resolved.cacheTtlHours * 60 * 60 * 1000,
    requestTimeoutMs: resolved.requestTimeoutMs,
    maxCatalogBytes: resolved.maxCatalogBytes,
    logger,
  })

  ctx.inject(['tools'], toolCtx => registerTools(toolCtx, resolved, store))
  ctx.inject(['commands', 'subprocess'], commandCtx => {
    commandCtx.commands.register({
      name: 'dshget',
      description: 'Search and install DeepSeek Harness plugins with DSH Get',
      input: { hint: '[search|info|install|update|status] [query|owner/name]' },
      handler: invocation => handleCommand(commandCtx, resolved, store, invocation),
    })
  })
}
