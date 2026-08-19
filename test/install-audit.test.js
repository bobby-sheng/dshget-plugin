import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildInstallAudit,
  captureInstallState,
  formatInstallAudit,
  resolveInstalledPackageName,
  writeInstallAudit,
} from '../src/install-audit.js'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const SPEC = 'github:example/example-plugin'

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

test('resolves package names from exact specs, manifest changes, and npm specs', () => {
  assert.equal(resolveInstalledPackageName({}, { dependencies: { fixture: SPEC } }, SPEC), 'fixture')
  assert.equal(resolveInstalledPackageName({}, { dependencies: { '@scope/fixture': '^1.0.0' } }, '@scope/fixture@^1.0.0'), '@scope/fixture')
  assert.equal(resolveInstalledPackageName({ dependencies: { fixture: '1.0.0' } }, { dependencies: { fixture: '2.0.0' } }, 'github:other/repo'), 'fixture')
})

test('builds and privately stores the six-section installation audit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshget-install-audit-'))
  const profileDir = path.join(directory, 'profiles', 'web')
  const auditDir = path.join(directory, 'cache', 'dshget', 'install-audits')
  const beforeManifest = { name: 'profile', private: true, dependencies: {} }
  const afterManifest = {
    name: 'profile',
    private: true,
    dependencies: { 'example-plugin': SPEC },
    pnpm: { allowBuilds: { 'example-plugin': true } },
  }
  try {
    await writeJson(path.join(profileDir, 'package.json'), beforeManifest)
    await writeFile(path.join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '6.0'\nimporters:\n  .: {}\npackages: {}\n")
    await writeFile(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const before = await captureInstallState(profileDir, {
      available: true,
      stdout: '- id: base\n  config:\n    apiKey: secret-before-value\n    expression: !!js process.exit(99)\n',
    })
    assert.equal(before.config.value[0].config.expression, 'process.exit(99)')

    await writeJson(path.join(profileDir, 'package.json'), afterManifest)
    await writeFile(path.join(profileDir, 'pnpm-workspace.yaml'), "packages:\n  - .\nallowBuilds:\n  example-plugin: true\n")
    await writeFile(path.join(profileDir, 'pnpm-lock.yaml'), [
      "lockfileVersion: '6.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      example-plugin:',
      `        specifier: ${SPEC}`,
      `        version: github.com/example/example-plugin/${COMMIT}`,
      'packages:',
      `  github.com/example/example-plugin/${COMMIT}:`,
      `    resolution: {tarball: https://codeload.github.com/example/example-plugin/tar.gz/${COMMIT}}`,
      '    name: example-plugin',
      '    version: 1.2.3',
      '',
    ].join('\n'))
    const packageDir = path.join(profileDir, 'node_modules', 'example-plugin')
    await writeJson(path.join(packageDir, 'package.json'), {
      name: 'example-plugin',
      version: '1.2.3',
      repository: { type: 'git', url: 'git+https://github.com/example/example-plugin.git' },
      scripts: { postinstall: 'node setup.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    await writeFile(path.join(packageDir, 'cordis.patch.yml'), '- id: base\n  config:\n    mode: audited\n- insert:\n    - id: example-plugin\n      name: example-plugin\n')
    const after = await captureInstallState(profileDir, {
      available: true,
      stdout: '- id: base\n  config:\n    apiKey: secret-after-value\n    expression: !!js process.exit(99)\n- id: example-plugin\n  name: example-plugin\n',
    })

    const audit = await buildInstallAudit({
      profile: 'web',
      profileDir,
      plugin: { owner: 'example', name: 'example-plugin', url: 'https://github.com/example/example-plugin/tree/main' },
      spec: SPEC,
      before,
      after,
    })

    assert.equal(audit.identity.packageName, 'example-plugin')
    assert.equal(audit.identity.packageVersion, '1.2.3')
    assert.equal(audit.identity.gitCommit, COMMIT)
    assert.equal(audit.identity.registryIntegrity, null)
    assert.equal(audit.repository.status, 'match')
    assert.deepEqual(audit.installRisk.lifecycleScripts, { postinstall: 'node setup.js' })
    assert.equal(audit.installRisk.allowBuilds.status, 'allowed')
    assert.match(audit.installRisk.allowBuilds.source, /pnpm-workspace\.yaml/)
    assert.deepEqual(audit.bundle.rows.map(row => [row.operation, row.id, row.effect]), [
      ['override', 'base', 'overridden'],
      ['insert', 'example-plugin', 'added'],
    ])
    assert.ok(audit.bundle.rows.every(row => row.presentAfter === true))
    assert.equal(audit.configDiff.available, true)
    assert.ok(audit.configDiff.total >= 2)
    assert.equal(audit.removal.command, 'dsh plugin --profile web remove -w example-plugin')

    const auditPath = await writeInstallAudit(auditDir, audit)
    assert.equal((await stat(auditPath)).mode & 0o777, 0o600)
    const stored = await readFile(auditPath, 'utf8')
    assert.doesNotMatch(stored, /secret-before-value|secret-after-value/)
    assert.match(stored, /knownGoodBeforeInstall/)
    assert.match(formatInstallAudit(audit, auditPath), /DSH Get installation audit/)
    assert.match(formatInstallAudit(audit, auditPath), /evidence, not a security review/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reports npm registry integrity when pnpm records it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshget-npm-audit-'))
  const profileDir = path.join(directory, 'profiles', 'web')
  try {
    await writeJson(path.join(profileDir, 'package.json'), { dependencies: {} })
    await writeFile(path.join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '6.0'\nimporters:\n  .: {}\npackages: {}\n")
    await writeFile(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const before = await captureInstallState(profileDir, { available: true, stdout: '[]\n' })
    await writeJson(path.join(profileDir, 'package.json'), { dependencies: { 'example-plugin': '1.2.3' } })
    await writeFile(path.join(profileDir, 'pnpm-lock.yaml'), [
      "lockfileVersion: '6.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      example-plugin:',
      '        specifier: 1.2.3',
      '        version: 1.2.3',
      'packages:',
      '  /example-plugin@1.2.3:',
      '    resolution: {integrity: sha512-fixture}',
      '    name: example-plugin',
      '    version: 1.2.3',
      '',
    ].join('\n'))
    await writeJson(path.join(profileDir, 'node_modules', 'example-plugin', 'package.json'), {
      name: 'example-plugin',
      version: '1.2.3',
      repository: 'https://github.com/example/example-plugin',
    })
    const after = await captureInstallState(profileDir, { available: true, stdout: '[]\n' })
    const audit = await buildInstallAudit({
      profile: 'web',
      profileDir,
      plugin: { owner: 'example', name: 'example-plugin', url: 'https://github.com/example/example-plugin' },
      spec: 'example-plugin@1.2.3',
      before,
      after,
    })
    assert.equal(audit.identity.registryIntegrity, 'sha512-fixture')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
