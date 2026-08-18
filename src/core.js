const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_GITHUB_SPEC = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9._~:/@+=-]+)?$/
const SAFE_NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9._+^~-]*)?$/i
const SAFE_GITHUB_RELEASE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/(?:latest\/download|download\/[A-Za-z0-9._-]+)\/[A-Za-z0-9._-]+\.(?:tgz|tar\.gz)$/

/** Return the stable owner/name identity used by DSH Get. */
export function pluginId(plugin) {
  return `${plugin.owner}/${plugin.name}`
}

/** Build the canonical DSH Get detail URL, encoding names that contain # or /. */
export function pluginDetailUrl(plugin, websiteUrl = 'https://www.dshget.com') {
  const base = websiteUrl.replace(/\/+$/, '')
  return `${base}/plugins/${encodeURIComponent(plugin.owner)}/${encodeURIComponent(plugin.name)}`
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** Validate a catalog snapshot before it is used or written to cache. */
export function validateCatalog(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('catalog must be a JSON object')
  }
  if (!Array.isArray(value.plugins)) throw new Error('catalog.plugins must be an array')
  if (value.categories === null || typeof value.categories !== 'object' || Array.isArray(value.categories)) {
    throw new Error('catalog.categories must be an object')
  }
  if (value.plugins.length > 100_000) throw new Error('catalog contains too many plugins')

  const seen = new Set()
  for (const [index, plugin] of value.plugins.entries()) {
    if (plugin === null || typeof plugin !== 'object' || Array.isArray(plugin)) {
      throw new Error(`catalog.plugins[${index}] must be an object`)
    }
    if (!nonEmptyString(plugin.owner) || !nonEmptyString(plugin.name)) {
      throw new Error(`catalog.plugins[${index}] must have non-empty owner and name`)
    }
    if (!nonEmptyString(plugin.install)) {
      throw new Error(`catalog.plugins[${index}] must have a non-empty install command`)
    }
    const id = pluginId(plugin).toLowerCase()
    if (seen.has(id)) throw new Error(`catalog contains duplicate plugin ${pluginId(plugin)}`)
    seen.add(id)
  }
  return value
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function description(plugin) {
  if (plugin.description && typeof plugin.description === 'object') {
    return text(plugin.description.en) || text(plugin.description.zh)
  }
  return text(plugin.description)
}

function searchableFields(plugin) {
  return {
    id: pluginId(plugin).toLowerCase(),
    name: text(plugin.name).toLowerCase(),
    owner: text(plugin.owner).toLowerCase(),
    category: text(plugin.category).toLowerCase(),
    description: description(plugin).toLowerCase(),
    tags: Array.isArray(plugin.tags) ? plugin.tags.join(' ').toLowerCase() : '',
    sources: Array.isArray(plugin.sources) ? plugin.sources.join(' ').toLowerCase() : '',
  }
}

function scorePlugin(plugin, query, tokens) {
  const fields = searchableFields(plugin)
  const haystack = Object.values(fields).join(' ')
  if (!tokens.every(token => haystack.includes(token))) return -1

  let score = 0
  if (fields.id === query) score += 10_000
  if (fields.name === query) score += 8_000
  if (fields.name.startsWith(query)) score += 4_000
  if (fields.id.startsWith(query)) score += 3_000
  if (fields.name.includes(query)) score += 2_000
  if (fields.owner === query) score += 1_000
  if (fields.tags.includes(query)) score += 600
  if (fields.category === query) score += 400
  if (fields.description.includes(query)) score += 200
  for (const token of tokens) {
    if (fields.name.includes(token)) score += 100
    if (fields.tags.includes(token)) score += 40
    if (fields.description.includes(token)) score += 10
  }
  return score
}

/** Search the normalized catalog with deterministic relevance and star ordering. */
export function searchCatalog(catalog, options) {
  const query = text(options?.query).trim().toLowerCase()
  if (query === '') throw new Error('query must not be empty')
  const category = text(options?.category).trim().toLowerCase()
  const limit = options?.limit ?? 10
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('limit must be an integer between 1 and 50')
  }
  const tokens = query.split(/\s+/).filter(Boolean)

  const matches = []
  for (const plugin of catalog.plugins) {
    if (category && text(plugin.category).toLowerCase() !== category) continue
    if (options?.installableOnly === true && plugin.installable === false) continue
    const score = scorePlugin(plugin, query, tokens)
    if (score >= 0) matches.push({ plugin, score })
  }

  matches.sort((a, b) =>
    b.score - a.score
    || Number(b.plugin.stars ?? 0) - Number(a.plugin.stars ?? 0)
    || pluginId(a.plugin).localeCompare(pluginId(b.plugin)),
  )
  return {
    total: matches.length,
    plugins: matches.slice(0, limit).map(match => match.plugin),
  }
}

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeIdentifier(identifier) {
  let value = text(identifier).trim()
  if (value === '') return ''
  try {
    const url = new URL(value)
    const marker = '/plugins/'
    const index = url.pathname.indexOf(marker)
    if (index >= 0) value = url.pathname.slice(index + marker.length)
    else if (url.hostname === 'github.com') value = url.pathname.replace(/^\/+/, '').replace(/\/(?:tree|blob)\/.*$/, '')
  } catch {
    // Plain plugin ids are the common path.
  }
  value = value.replace(/^github:/i, '').replace(/^\/+|\/+$/g, '')
  const slash = value.indexOf('/')
  if (slash < 0) return decode(value)
  return `${decode(value.slice(0, slash))}/${decode(value.slice(slash + 1))}`
}

/** Find one plugin by owner/name, DSH Get URL, GitHub URL, or unique name. */
export function findPlugin(catalog, identifier) {
  const normalized = normalizeIdentifier(identifier).toLowerCase()
  if (normalized === '') return undefined
  const exact = catalog.plugins.find(plugin => pluginId(plugin).toLowerCase() === normalized)
  if (exact) return exact
  if (normalized.includes('/')) return undefined
  const byName = catalog.plugins.filter(plugin => text(plugin.name).toLowerCase() === normalized)
  return byName.length === 1 ? byName[0] : undefined
}

/** Extract an installable package spec without evaluating the catalog command as shell text. */
export function parseInstallSpec(command) {
  const match = /^dsh plugin(?: --profile ([A-Za-z0-9][A-Za-z0-9._-]*))? add ("[^"]+"|'[^']+'|[^\s]+)$/.exec(text(command).trim())
  if (!match) throw new Error('unsupported install command format')
  const profile = match[1]
  const rawSpec = match[2]
  const quoted = (rawSpec.startsWith('"') && rawSpec.endsWith('"')) || (rawSpec.startsWith("'") && rawSpec.endsWith("'"))
  const spec = quoted ? rawSpec.slice(1, -1) : rawSpec
  if (profile !== undefined && !SAFE_PROFILE.test(profile)) throw new Error('unsafe profile in install command')
  if (!SAFE_GITHUB_SPEC.test(spec) && !SAFE_NPM_SPEC.test(spec) && !SAFE_GITHUB_RELEASE.test(spec)) {
    throw new Error('unsupported or unsafe package spec')
  }
  return spec
}

/** Parse the human `/dshget` command into one subcommand and its remaining input. */
export function parseDshgetCommand(rawInput) {
  const trimmed = text(rawInput).trim()
  if (trimmed === '') return { action: 'help', value: '' }
  const space = trimmed.search(/\s/)
  const action = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase()
  const value = space < 0 ? '' : trimmed.slice(space).trim()
  return { action, value }
}

/** Project one catalog record into the stable result returned to users and tools. */
export function pluginResult(plugin, websiteUrl) {
  return {
    id: pluginId(plugin),
    name: plugin.name,
    owner: plugin.owner,
    description: description(plugin),
    category: text(plugin.category) || 'unknown',
    stars: Number(plugin.stars ?? 0),
    installable: plugin.installable !== false,
    installCommand: plugin.install,
    repositoryUrl: text(plugin.url),
    detailsUrl: pluginDetailUrl(plugin, websiteUrl),
  }
}
