#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROUTES = {
  "/admin/staff-access": {},
  "/admin/staff-access/[id]": {},
  "/admin/staff-access/[id]/audit": {},
  "/admin/staff-access/me": {},
}

const PLUGIN_ROUTE_TREES = [
  "dist/api/admin",
  ".medusa/server/src/api/admin",
  "src/api/admin",
]

const ROUTE_FILES = new Set(["route.ts", "route.js"])
const CORE_ROUTE_FILES = new Set(["route.js"])

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function usage(message) {
  if (message) console.error(message)
  console.error(
    "usage: staff-permissions-check [--routes <json file>] [--config-json <json>] [--list]"
  )
  process.exit(1)
}

function parseArgs(argv) {
  const parsed = { list: false, routesFile: null, configJson: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--list") {
      parsed.list = true
      continue
    }
    if (arg === "--routes" || arg.startsWith("--routes=")) {
      const value = arg === "--routes" ? argv[++i] : arg.slice("--routes=".length)
      if (!value) usage("missing path for --routes")
      parsed.routesFile = value
      continue
    }
    if (arg === "--config-json" || arg.startsWith("--config-json=")) {
      const value = arg === "--config-json" ? argv[++i] : arg.slice("--config-json=".length)
      if (value === undefined) usage("missing JSON for --config-json")
      parsed.configJson = value
      continue
    }
    usage(`unknown argument: ${arg}`)
  }
  return parsed
}

function packageRootFromBin() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  if (!existsSync(join(root, "package.json"))) {
    throw new Error("Cannot locate staff-permissions package root (bin/package.json)")
  }
  return root
}

function loadCoreInventory(packageRoot) {
  const candidates = [
    join(packageRoot, "src/lib/inventory/core-2.19.json"),
    join(packageRoot, ".medusa/server/src/lib/inventory/core-2.19.json"),
  ]
  for (const file of candidates) {
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, "utf8"))
    }
  }
  throw new Error(
    "Cannot locate core-2.19.json (src/lib/inventory/core-2.19.json or .medusa/server/src/lib/inventory/core-2.19.json)"
  )
}

function parseInventoryJson(raw, source) {
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`invalid inventory JSON (${source}): ${error.message}`)
  }
  if (!isPlainObject(value)) {
    throw new Error(`invalid inventory JSON (${source}): expected an object`)
  }
  return value
}

function loadHostRoutes(cwd, parsed) {
  let host = {}
  if (parsed.routesFile) {
    const file = resolve(cwd, parsed.routesFile)
    if (!existsSync(file)) {
      throw new Error(`routes file not found: ${file}`)
    }
    host = { ...host, ...parseInventoryJson(readFileSync(file, "utf8"), file) }
  }
  if (parsed.configJson !== null) {
    host = { ...host, ...parseInventoryJson(parsed.configJson, "--config-json") }
  }
  return host
}

function mergeInventory(...parts) {
  return Object.assign({}, ...parts)
}

function templateFromAdminDir(adminRoot, directory) {
  const rel = relative(adminRoot, directory).split("\\").join("/")
  if (rel === "" || rel === ".") return "/admin"
  return `/admin/${rel}`
}

function walkRouteTemplates(adminRoot, fileNames) {
  if (!existsSync(adminRoot)) return []
  const routes = []
  function inspect(directory) {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const pathname = join(directory, entry.name)
      if (entry.isDirectory()) inspect(pathname)
      else if (fileNames.has(entry.name)) {
        routes.push(templateFromAdminDir(adminRoot, directory))
      }
    }
  }
  inspect(adminRoot)
  return routes
}

function pluginDependencyNames(cwd) {
  const file = join(cwd, "package.json")
  if (!existsSync(file)) return []
  let pkg
  try {
    pkg = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`invalid host package.json: ${error.message}`)
  }
  if (!isPlainObject(pkg)) return []
  const names = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ])
  return [...names].filter((name) => name.includes("medusa-plugin"))
}

function discoverRouteTemplates(cwd) {
  const discovered = new Set()
  function addFrom(adminRoot, fileNames) {
    for (const template of walkRouteTemplates(adminRoot, fileNames)) {
      discovered.add(template)
    }
  }
  addFrom(join(cwd, "src/api/admin"), ROUTE_FILES)
  addFrom(join(cwd, "node_modules/@medusajs/medusa/dist/api/admin"), CORE_ROUTE_FILES)
  for (const name of pluginDependencyNames(cwd)) {
    const pluginRoot = join(cwd, "node_modules", name)
    for (const tree of PLUGIN_ROUTE_TREES) {
      addFrom(join(pluginRoot, tree), ROUTE_FILES)
    }
  }
  return [...discovered].sort()
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsed = parseArgs(argv)
  const inventory = mergeInventory(
    loadCoreInventory(packageRootFromBin()),
    PACKAGE_ROUTES,
    loadHostRoutes(cwd, parsed)
  )
  if (parsed.list) {
    console.log(JSON.stringify(inventory, null, 2))
    return 0
  }
  const discovered = discoverRouteTemplates(cwd)
  const missing = discovered.filter((template) => !Object.prototype.hasOwnProperty.call(inventory, template))
  if (missing.length) {
    for (const template of missing) console.log(template)
    return 1
  }
  console.log(`staff-permissions-check: ${discovered.length} routes covered`)
  return 0
}

try {
  process.exitCode = run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

export {
  PACKAGE_ROUTES,
  discoverRouteTemplates,
  loadCoreInventory,
  mergeInventory,
  packageRootFromBin,
  run,
  walkRouteTemplates,
}
