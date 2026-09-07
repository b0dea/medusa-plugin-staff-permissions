#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ADMIN_REL = join("node_modules", "@medusajs", "medusa", "dist", "api", "admin")

function findAdminRoot() {
  const starts = [
    process.cwd(),
    dirname(fileURLToPath(import.meta.url)),
    join(dirname(fileURLToPath(import.meta.url)), ".."),
  ]
  for (const start of starts) {
    let searchRoot = resolve(start)
    while (true) {
      const candidate = join(searchRoot, ADMIN_REL)
      if (existsSync(candidate)) return candidate
      const parent = dirname(searchRoot)
      if (parent === searchRoot) break
      searchRoot = parent
    }
  }
  throw new Error("Cannot locate @medusajs/medusa dist/api/admin")
}

export function listCoreRoutes(adminRoot = findAdminRoot()) {
  const routes = []
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const pathname = join(directory, entry.name)
      if (entry.isDirectory()) inspect(pathname)
      else if (entry.name === "route.js") {
        const rel = relative(adminRoot, directory).split("\\").join("/")
        routes.push(rel === "" ? "/admin" : `/admin/${rel}`)
      }
    }
  }
  inspect(adminRoot)
  return [...new Set(routes)].sort()
}

function diffKeys(walker, keys) {
  const walkerSet = new Set(walker)
  const keySet = new Set(keys)
  return [...walker.filter((path) => !keySet.has(path)), ...keys.filter((path) => !walkerSet.has(path))].sort()
}

function isMain() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

if (isMain()) {
  const args = process.argv.slice(2)
  const diffIndex = args.indexOf("--diff")
  const walker = listCoreRoutes()

  if (diffIndex >= 0) {
    const file = args[diffIndex + 1]
    if (!file) {
      console.error("usage: list-core-routes.mjs --diff <file>")
      process.exit(1)
    }
    const inventory = JSON.parse(readFileSync(resolve(file), "utf8"))
    if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
      console.error(`invalid inventory JSON: ${file}`)
      process.exit(1)
    }
    const xor = diffKeys(walker, Object.keys(inventory))
    if (xor.length) {
      for (const path of xor) console.log(path)
      process.exit(1)
    }
    process.exit(0)
  }

  for (const path of walker) console.log(path)
}
