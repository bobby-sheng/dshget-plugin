import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalog } from './core.js'

const EMBEDDED_CATALOG = fileURLToPath(new URL('../data/catalog.json', import.meta.url))

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Embedded-snapshot catalog store with an optional validated remote cache. */
export class CatalogStore {
  constructor(options) {
    this.cachePath = options.cachePath
    this.dataUrl = options.dataUrl
    this.cacheTtlMs = options.cacheTtlMs
    this.requestTimeoutMs = options.requestTimeoutMs
    this.maxCatalogBytes = options.maxCatalogBytes
    this.fetch = options.fetchImpl ?? globalThis.fetch
    this.logger = options.logger ?? { warn() {} }
    this.current = undefined
  }

  async load() {
    if (this.current !== undefined) return this.current
    try {
      const [catalog, metadata] = await Promise.all([readJson(this.cachePath), stat(this.cachePath)])
      this.current = {
        catalog: validateCatalog(catalog),
        source: 'cache',
        stale: Date.now() - metadata.mtimeMs > this.cacheTtlMs,
      }
      return this.current
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger.warn(`Ignoring invalid DSH Get cache: ${error.message}`)
    }

    const catalog = validateCatalog(await readJson(EMBEDDED_CATALOG))
    this.current = { catalog, source: 'embedded', stale: true }
    return this.current
  }

  async refresh(signal) {
    if (typeof this.fetch !== 'function') throw new Error('fetch is not available in this Node.js runtime')
    const signals = [AbortSignal.timeout(this.requestTimeoutMs)]
    if (signal) signals.push(signal)
    const response = await this.fetch(this.dataUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'dshget-plugin/0.1.0',
      },
      signal: AbortSignal.any(signals),
    })
    if (!response.ok) throw new Error(`catalog update failed with HTTP ${response.status}`)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > this.maxCatalogBytes) throw new Error('catalog update is larger than the configured limit')
    const body = await response.text()
    if (Buffer.byteLength(body) > this.maxCatalogBytes) throw new Error('catalog update is larger than the configured limit')
    const catalog = validateCatalog(JSON.parse(body))

    await mkdir(dirname(this.cachePath), { recursive: true })
    const temporary = `${this.cachePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(catalog)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.cachePath)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
    this.current = { catalog, source: 'remote', stale: false }
    return this.current
  }
}
