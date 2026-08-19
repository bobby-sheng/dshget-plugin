import { readFile } from 'node:fs/promises'
import { parseInstallSpec, pluginId, validateCatalog } from '../src/core.js'

const catalogUrl = new URL('../data/catalog.json', import.meta.url)
const catalog = validateCatalog(JSON.parse(await readFile(catalogUrl, 'utf8')))
const categories = new Set(Object.keys(catalog.categories))
const problems = []
let installable = 0

for (const plugin of catalog.plugins) {
  const id = pluginId(plugin)
  if (!categories.has(plugin.category)) problems.push(`${id}: unknown category ${plugin.category}`)
  if (plugin.installable === false) continue
  installable += 1
  try {
    parseInstallSpec(plugin.install)
  } catch (error) {
    problems.push(`${id}: ${error.message}`)
  }
}

if (problems.length > 0) {
  throw new Error(`embedded catalog validation failed:\n${problems.slice(0, 20).join('\n')}${problems.length > 20 ? `\n...and ${problems.length - 20} more` : ''}`)
}

console.log(`Verified ${catalog.plugins.length} catalog entries (${installable} installable) across ${categories.size} categories.`)
