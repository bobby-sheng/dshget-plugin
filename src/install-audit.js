import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']
const DSH_JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: value => String(value) }

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonHash(value) {
  return sha256(JSON.stringify(value))
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

async function readText(file) {
  try {
    const text = await readFile(file, 'utf8')
    return { available: true, text, sha256: sha256(text) }
  } catch (error) {
    return { available: false, error: errorText(error) }
  }
}

function parseYaml(text, label) {
  try {
    return { available: true, value: parse(text, { customTags: [DSH_JS_TAG], maxAliasCount: 100 }) }
  } catch (error) {
    return { available: false, error: `${label}: ${errorText(error)}` }
  }
}

function parseJson(text, label) {
  try {
    return { available: true, value: JSON.parse(text) }
  } catch (error) {
    return { available: false, error: `${label}: ${errorText(error)}` }
  }
}

function fileSnapshot(file, source, parser, label) {
  if (!source.available) return { available: false, path: file, error: source.error }
  const parsed = parser(source.text, label)
  if (!parsed.available) return { available: false, path: file, sha256: source.sha256, error: parsed.error }
  return { available: true, path: file, sha256: source.sha256, value: parsed.value }
}

/** Capture profile metadata and a redaction-safe representation of `--dump-config`. */
export async function captureInstallState(profileDir, dumpConfig) {
  const manifestPath = path.join(profileDir, 'package.json')
  const lockfilePath = path.join(profileDir, 'pnpm-lock.yaml')
  const workspacePath = path.join(profileDir, 'pnpm-workspace.yaml')
  const [manifestSource, lockfileSource, workspaceSource] = await Promise.all([
    readText(manifestPath),
    readText(lockfilePath),
    readText(workspacePath),
  ])
  const manifest = fileSnapshot(manifestPath, manifestSource, parseJson, 'profile package.json')
  const lockfile = fileSnapshot(lockfilePath, lockfileSource, parseYaml, 'pnpm-lock.yaml')
  const workspace = fileSnapshot(workspacePath, workspaceSource, parseYaml, 'pnpm-workspace.yaml')

  let config
  if (!dumpConfig?.available) {
    config = { available: false, error: dumpConfig?.error || 'dsh --dump-config was unavailable' }
  } else {
    const parsed = parseYaml(dumpConfig.stdout, 'dsh --dump-config')
    config = parsed.available
      ? { available: true, sha256: sha256(dumpConfig.stdout), value: parsed.value }
      : { available: false, sha256: sha256(dumpConfig.stdout), error: parsed.error }
  }
  return { capturedAt: new Date().toISOString(), manifest, lockfile, workspace, config }
}

function dependencyMap(manifest) {
  if (!manifest || typeof manifest !== 'object') return {}
  return {
    ...(manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}),
    ...(manifest.optionalDependencies && typeof manifest.optionalDependencies === 'object' ? manifest.optionalDependencies : {}),
    ...(manifest.devDependencies && typeof manifest.devDependencies === 'object' ? manifest.devDependencies : {}),
  }
}

function npmNameFromSpec(spec) {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    const version = spec.indexOf('@', slash)
    return version < 0 ? spec : spec.slice(0, version)
  }
  const version = spec.indexOf('@')
  return version < 0 ? spec : spec.slice(0, version)
}

/** Resolve the package key pnpm wrote into the profile manifest. */
export function resolveInstalledPackageName(beforeManifest, afterManifest, spec) {
  const before = dependencyMap(beforeManifest)
  const after = dependencyMap(afterManifest)
  const exact = Object.keys(after).filter(name => after[name] === spec)
  if (exact.length === 1) return exact[0]

  const changed = Object.keys(after).filter(name => before[name] !== after[name])
  if (changed.length === 1) return changed[0]

  if (!spec.startsWith('github:') && !spec.startsWith('https://')) {
    const inferred = npmNameFromSpec(spec)
    if (PACKAGE_NAME.test(inferred) && Object.hasOwn(after, inferred)) return inferred
  }
  return undefined
}

function importerDependency(lockfile, name) {
  const dependency = lockfile?.importers?.['.']?.dependencies?.[name]
    ?? lockfile?.importers?.['.']?.optionalDependencies?.[name]
    ?? lockfile?.importers?.['.']?.devDependencies?.[name]
  if (dependency && typeof dependency === 'object') return dependency.version
  return dependency
}

function withoutPeerSuffix(value) {
  return typeof value === 'string' ? value.replace(/\([^)]*\)(?:\([^)]*\))*$/, '') : value
}

function findLockPackage(lockfile, name, version, installedVersion) {
  const packages = lockfile?.packages
  if (!packages || typeof packages !== 'object') return {}
  const candidates = [version, withoutPeerSuffix(version), `/${name}@${installedVersion}`, `${name}@${installedVersion}`]
    .filter(value => typeof value === 'string')
  for (const candidate of candidates) {
    if (Object.hasOwn(packages, candidate)) return { key: candidate, value: packages[candidate] }
  }
  for (const [key, value] of Object.entries(packages)) {
    if (value?.name === name && (!installedVersion || value.version === installedVersion)) return { key, value }
  }
  return {}
}

function gitCommit(...values) {
  for (const value of values) {
    const match = String(value || '').match(/(?:^|[\/@])([a-f0-9]{40})(?=$|[\/(])/i)
    if (match) return match[1].toLowerCase()
  }
  return undefined
}

function manifestRepository(manifest) {
  if (typeof manifest?.repository === 'string') return manifest.repository
  if (typeof manifest?.repository?.url === 'string') return manifest.repository.url
  return undefined
}

function normalizeGitHubRepository(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  let url = value.trim().replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/')
  if (/^github:/i.test(url)) url = `https://github.com/${url.slice(7)}`
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== 'github.com') return url.replace(/\.git$/i, '').toLowerCase()
    const [owner, repository] = parsed.pathname.replace(/^\/+/, '').split('/')
    if (!owner || !repository) return undefined
    return `https://github.com/${owner}/${repository.replace(/\.git$/i, '')}`.toLowerCase()
  } catch {
    return url.replace(/\.git$/i, '').toLowerCase()
  }
}

function repositoryEvidence(catalogUrl, manifest) {
  const packageUrl = manifestRepository(manifest)
  const expected = normalizeGitHubRepository(catalogUrl)
  const actual = normalizeGitHubRepository(packageUrl)
  let status = 'unavailable'
  if (expected && actual) status = expected === actual ? 'match' : 'mismatch'
  return { catalog: catalogUrl || null, package: packageUrl || null, normalizedCatalog: expected || null, normalizedPackage: actual || null, status }
}

function lifecycleEvidence(manifest) {
  const scripts = {}
  for (const name of LIFECYCLE_SCRIPTS) {
    if (typeof manifest?.scripts?.[name] === 'string') scripts[name] = manifest.scripts[name]
  }
  return scripts
}

function allowBuildsEvidence(profileManifest, workspace, packageName) {
  if (workspace?.allowBuilds && typeof workspace.allowBuilds === 'object' && Object.hasOwn(workspace.allowBuilds, packageName)) {
    return { status: workspace.allowBuilds[packageName] === true ? 'allowed' : 'denied', source: `pnpm-workspace.yaml allowBuilds.${packageName}` }
  }
  const pnpm = profileManifest?.pnpm
  if (!pnpm || typeof pnpm !== 'object') return { status: 'not-declared', source: null }
  if (pnpm.allowBuilds && typeof pnpm.allowBuilds === 'object' && Object.hasOwn(pnpm.allowBuilds, packageName)) {
    return { status: pnpm.allowBuilds[packageName] === true ? 'allowed' : 'denied', source: `pnpm.allowBuilds.${packageName}` }
  }
  if (Array.isArray(pnpm.onlyBuiltDependencies) && pnpm.onlyBuiltDependencies.includes(packageName)) {
    return { status: 'allowed', source: 'pnpm.onlyBuiltDependencies' }
  }
  if (Array.isArray(pnpm.ignoredBuiltDependencies) && pnpm.ignoredBuiltDependencies.includes(packageName)) {
    return { status: 'denied', source: 'pnpm.ignoredBuiltDependencies' }
  }
  const built = profileManifest?.dependenciesMeta?.[packageName]?.built
  if (typeof built === 'boolean') return { status: built ? 'allowed' : 'denied', source: `dependenciesMeta.${packageName}.built` }
  return { status: 'not-declared', source: null }
}

function collectIds(value, target = new Map(), jsonPath = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectIds(item, target, `${jsonPath}[${index}]`))
    return target
  }
  if (!value || typeof value !== 'object') return target
  if (typeof value.id === 'string' && !target.has(value.id)) target.set(value.id, jsonPath)
  for (const [key, child] of Object.entries(value)) collectIds(child, target, `${jsonPath}.${key}`)
  return target
}

function patchRows(patch) {
  if (!Array.isArray(patch)) return []
  const rows = []
  for (const operation of patch) {
    if (!operation || typeof operation !== 'object') continue
    if (typeof operation.id === 'string') rows.push({ operation: 'override', id: operation.id })
    if (!Object.hasOwn(operation, 'insert')) continue
    const payloads = Array.isArray(operation.insert) ? operation.insert : [operation.insert]
    for (const payload of payloads) {
      const identity = typeof payload?.id === 'string' ? payload.id : typeof payload?.name === 'string' ? payload.name : null
      rows.push({ operation: 'insert', id: identity })
    }
  }
  return rows
}

async function bundleEvidence(profileDir, packageName, manifest, beforeConfig, afterConfig) {
  const declaration = manifest?.dsh?.bundle?.patch
  if (typeof declaration !== 'string') return { declared: false, path: null, rows: [] }
  const packageDir = path.join(profileDir, 'node_modules', ...packageName.split('/'))
  const patchPath = path.resolve(packageDir, declaration)
  const packageRoot = `${path.resolve(packageDir)}${path.sep}`
  if (!patchPath.startsWith(packageRoot)) {
    return { declared: true, path: declaration, rows: [], error: 'bundle patch path escapes the installed package' }
  }
  const source = await readText(patchPath)
  if (!source.available) return { declared: true, path: declaration, rows: [], error: source.error }
  const parsed = parseYaml(source.text, 'dsh.bundle.patch')
  if (!parsed.available) return { declared: true, path: declaration, sha256: source.sha256, rows: [], error: parsed.error }
  const beforeIds = beforeConfig?.available ? collectIds(beforeConfig.value) : new Map()
  const afterIds = afterConfig?.available ? collectIds(afterConfig.value) : new Map()
  const rows = patchRows(parsed.value).map(row => ({
    ...row,
    effect: !row.id
      ? 'unknown'
      : row.operation === 'override'
        ? beforeIds.has(row.id) ? 'overridden' : 'target-missing-before-install'
        : beforeIds.has(row.id) ? 'overridden' : 'added',
    presentAfter: row.id ? afterIds.has(row.id) : null,
  }))
  return { declared: true, path: declaration, sha256: source.sha256, rows }
}

function valueType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function keyedArray(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const entries = value.map(item => item && typeof item === 'object' && typeof item.id === 'string' ? [item.id, item] : undefined)
  if (entries.some(entry => entry === undefined)) return undefined
  const map = new Map(entries)
  return map.size === entries.length ? map : undefined
}

function diffConfig(before, after, limit = 500) {
  const changes = []
  let total = 0
  function add(pathname, kind, left, right) {
    total += 1
    if (changes.length >= limit) return
    changes.push({
      path: pathname,
      kind,
      beforeType: left === undefined ? null : valueType(left),
      afterType: right === undefined ? null : valueType(right),
      beforeHash: left === undefined ? null : jsonHash(left),
      afterHash: right === undefined ? null : jsonHash(right),
    })
  }
  function visit(left, right, pathname) {
    if (Object.is(left, right)) return
    if (left === undefined) return add(pathname, 'added', left, right)
    if (right === undefined) return add(pathname, 'removed', left, right)
    if (Array.isArray(left) && Array.isArray(right)) {
      const leftMap = keyedArray(left)
      const rightMap = keyedArray(right)
      if (leftMap && rightMap) {
        for (const key of new Set([...leftMap.keys(), ...rightMap.keys()])) {
          visit(leftMap.get(key), rightMap.get(key), `${pathname}[id=${JSON.stringify(key)}]`)
        }
        return
      }
      const length = Math.max(left.length, right.length)
      for (let index = 0; index < length; index += 1) visit(left[index], right[index], `${pathname}[${index}]`)
      return
    }
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], `${pathname}.${key}`)
      return
    }
    add(pathname, 'changed', left, right)
  }
  visit(before, after, '$')
  return { total, truncated: total > changes.length, changes }
}

function configEvidence(before, after) {
  if (!before?.available || !after?.available) {
    return {
      available: false,
      beforeSha256: before?.sha256 || null,
      afterSha256: after?.sha256 || null,
      error: [before?.error, after?.error].filter(Boolean).join('; ') || 'config snapshot unavailable',
    }
  }
  return {
    available: true,
    beforeSha256: before.sha256,
    afterSha256: after.sha256,
    ...diffConfig(before.value, after.value),
  }
}

function serializableSnapshot(state) {
  return {
    capturedAt: state.capturedAt,
    profileManifest: state.manifest.available ? state.manifest.value : null,
    profileManifestSha256: state.manifest.sha256 || null,
    lockfileSha256: state.lockfile.sha256 || null,
    pnpmWorkspace: state.workspace.available ? state.workspace.value : null,
    pnpmWorkspaceSha256: state.workspace.sha256 || null,
    configSha256: state.config.sha256 || null,
    errors: [state.manifest.error, state.lockfile.error, state.workspace.error, state.config.error].filter(Boolean),
  }
}

/** Build a six-section evidence record without retaining raw effective config values. */
export async function buildInstallAudit({ profile, profileDir, plugin, spec, before, after }) {
  const beforeManifest = before.manifest.available ? before.manifest.value : {}
  const afterManifest = after.manifest.available ? after.manifest.value : {}
  const packageName = resolveInstalledPackageName(beforeManifest, afterManifest, spec)
  if (!packageName || !PACKAGE_NAME.test(packageName)) {
    throw new Error('could not identify the installed package in the profile manifest')
  }

  const installedManifestPath = path.join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
  const installedSource = await readText(installedManifestPath)
  if (!installedSource.available) throw new Error(`could not read installed package metadata: ${installedSource.error}`)
  const parsedManifest = parseJson(installedSource.text, 'installed package.json')
  if (!parsedManifest.available) throw new Error(parsedManifest.error)
  const manifest = parsedManifest.value
  const lockfile = after.lockfile.available ? after.lockfile.value : {}
  const lockVersion = importerDependency(lockfile, packageName)
  const lockPackage = findLockPackage(lockfile, packageName, lockVersion, manifest.version)
  const resolution = lockPackage.value?.resolution || {}
  const commit = gitCommit(lockVersion, lockPackage.key, resolution.id, resolution.tarball)
  const scripts = lifecycleEvidence(manifest)
  const afterWorkspace = after.workspace.available ? after.workspace.value : {}
  const allowBuilds = allowBuildsEvidence(afterManifest, afterWorkspace, packageName)
  const allowBuildsRequirement = Object.keys(scripts).length === 0
    ? 'No selected-package lifecycle scripts indicate a build approval requirement.'
    : allowBuilds.status === 'allowed'
      ? 'The selected package is explicitly allowed by the recorded pnpm build policy.'
      : allowBuilds.status === 'denied'
        ? 'The selected package is explicitly denied by the recorded pnpm build policy.'
        : 'Lifecycle scripts are declared; the active pnpm version and policy determine whether allowBuilds approval is required.'
  const bundle = await bundleEvidence(profileDir, packageName, manifest, before.config, after.config)
  const removeCommand = `dsh plugin --profile ${profile} remove -w ${packageName}`

  return {
    schemaVersion: 1,
    outcome: 'installed',
    createdAt: new Date().toISOString(),
    disclaimer: 'Evidence and visibility only; catalog inclusion and this audit are not a security review or endorsement.',
    identity: {
      catalogId: `${plugin.owner}/${plugin.name}`,
      requestedSpec: spec,
      packageName,
      packageVersion: typeof manifest.version === 'string' ? manifest.version : null,
      lockfileKey: lockPackage.key || null,
      lockfileVersion: lockVersion || null,
      gitCommit: commit || null,
      tarball: resolution.tarball || null,
      registryIntegrity: resolution.integrity || null,
      packageManifestSha256: installedSource.sha256,
    },
    repository: repositoryEvidence(plugin.url, manifest),
    installRisk: {
      lifecycleScripts: scripts,
      allowBuilds,
      allowBuildsRequirement,
      lifecycleExecution: Object.keys(scripts).length === 0
        ? 'No selected-package lifecycle scripts were declared.'
        : 'Lifecycle scripts are declared; this post-install evidence does not prove whether pnpm executed them.',
      hostBoundary: 'When loaded, the Host plugin runs with the permissions of the dsh process.',
    },
    bundle,
    configDiff: configEvidence(before.config, after.config),
    removal: {
      command: removeCommand,
      restartRequired: true,
    },
    restoration: {
      knownGoodBeforeInstall: serializableSnapshot(before),
      afterInstall: serializableSnapshot(after),
      note: 'Remove the package, restore the recorded pre-install profile manifest if needed, then compare the effective config SHA-256 after restart.',
    },
  }
}

/** Write one private, atomic JSON audit record and return its path. */
export async function writeInstallAudit(auditDir, audit) {
  await mkdir(auditDir, { recursive: true, mode: 0o700 })
  await chmod(auditDir, 0o700)
  const stamp = audit.createdAt.replace(/[:.]/g, '-')
  const name = audit.identity.packageName.replace(/[^A-Za-z0-9._-]/g, '_')
  const destination = path.join(auditDir, `${stamp}-${name}-${randomUUID().slice(0, 8)}.json`)
  const temporary = path.join(auditDir, `.${name}.${randomUUID()}.tmp`)
  const record = { ...audit, auditRecord: destination }
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, destination)
    await chmod(destination, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return destination
}

function shortHash(value) {
  return value ? value.slice(0, 12) : 'unavailable'
}

/** Render the compact evidence card returned by `/dshget install`. */
export function formatInstallAudit(audit, auditPath) {
  const identity = audit.identity
  const scripts = Object.entries(audit.installRisk.lifecycleScripts)
  const rows = audit.bundle.rows || []
  const diff = audit.configDiff
  const lines = [
    'DSH Get installation audit (evidence, not a security review)',
    '',
    '1. Exact identity and integrity',
    `- Catalog: ${identity.catalogId}`,
    `- Requested: ${identity.requestedSpec}`,
    `- Installed: ${identity.packageName}@${identity.packageVersion || 'unknown'}`,
    `- Git commit: ${identity.gitCommit || 'not available (non-Git or unresolved source)'}`,
    `- Tarball: ${identity.tarball || 'not recorded separately'}`,
    `- Registry dist.integrity: ${identity.registryIntegrity || 'not available (Git sources normally have no registry integrity)'}`,
    `- Lock resolution: ${identity.lockfileKey || identity.lockfileVersion || 'unavailable'}`,
    '',
    '2. Repository metadata',
    `- Catalog: ${audit.repository.catalog || 'unavailable'}`,
    `- Package metadata: ${audit.repository.package || 'unavailable'}`,
    `- Comparison: ${audit.repository.status}`,
    '',
    '3. Install-time and Host risk',
    `- Lifecycle scripts: ${scripts.length ? scripts.map(([name, command]) => `${name}=${JSON.stringify(command)}`).join('; ') : 'none declared by the selected package'}`,
    `- pnpm build permission: ${audit.installRisk.allowBuilds.status}${audit.installRisk.allowBuilds.source ? ` via ${audit.installRisk.allowBuilds.source}` : ''}`,
    `- pnpm allowBuilds requirement: ${audit.installRisk.allowBuildsRequirement}`,
    `- ${audit.installRisk.lifecycleExecution}`,
    `- ${audit.installRisk.hostBoundary}`,
    '',
    '4. Bundle patch effects',
  ]
  if (!audit.bundle.declared) lines.push('- No dsh.bundle.patch declared.')
  else if (audit.bundle.error) lines.push(`- Could not inspect ${audit.bundle.path}: ${audit.bundle.error}`)
  else if (rows.length === 0) lines.push(`- ${audit.bundle.path}: no identifiable insert/patch/remove rows.`)
  else {
    lines.push(`- ${audit.bundle.path} (${shortHash(audit.bundle.sha256)})`)
    for (const row of rows.slice(0, 12)) lines.push(`- ${row.operation} ${row.id || '(unnamed row)'}: ${row.effect}`)
    if (rows.length > 12) lines.push(`- ...and ${rows.length - 12} more rows in the audit record.`)
  }
  lines.push('', '5. Effective config diff')
  if (!diff.available) lines.push(`- Unavailable: ${diff.error}`)
  else {
    lines.push(`- Before SHA-256: ${diff.beforeSha256}`)
    lines.push(`- After SHA-256: ${diff.afterSha256}`)
    lines.push(`- ${diff.total} redaction-safe path changes${diff.truncated ? ' (record truncated)' : ''}.`)
    for (const change of diff.changes.slice(0, 12)) lines.push(`- ${change.kind}: ${change.path}`)
    if (diff.total > 12) lines.push(`- ...and ${diff.total - 12} more changes in the audit record.`)
  }
  lines.push(
    '',
    '6. Removal and restoration',
    `- Remove: ${audit.removal.command}`,
    `- Private audit record: ${auditPath || 'could not be written'}`,
    '- The record contains pre/post profile, lockfile, and effective-config hashes; it does not store raw effective config values.',
    '- Restart DSH to load the plugin. Remove it and restart again to unload it.',
    '',
    audit.disclaimer,
  )
  return lines.join('\n')
}
