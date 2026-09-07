import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const bin = resolve("bin/staff-permissions-check.mjs")

const COVERING_ROUTES = {
  "/admin/foo": {},
  "/admin/bar": {},
}

function writeFile(pathname: string, contents: string) {
  mkdirSync(dirname(pathname), { recursive: true })
  writeFileSync(pathname, contents)
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "staff-permissions-check-"))
  writeFile(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "check-fixture",
      private: true,
      dependencies: { "medusa-plugin-x": "1.0.0" },
    }, null, 2)}\n`
  )
  writeFile(join(dir, "src/api/admin/foo/route.ts"), "export const GET = () => undefined\n")
  writeFile(
    join(dir, "node_modules/medusa-plugin-x/.medusa/server/src/api/admin/bar/route.js"),
    "module.exports = {}\n"
  )
  writeFile(
    join(dir, "node_modules/@medusajs/medusa/dist/api/admin/products/route.js"),
    "module.exports = {}\n"
  )
  return dir
}

function run(cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 10 * 1024 * 1024,
  })
}

describe("staff-permissions-check", () => {
  const fixtures: string[] = []

  afterEach(() => {
    for (const dir of fixtures.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("exits 1 listing host and plugin routes absent from the merged inventory", () => {
    const dir = makeFixture()
    fixtures.push(dir)
    const result = run(dir)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("/admin/foo")
    expect(result.stdout).toContain("/admin/bar")
    expect(result.stdout).not.toContain("/admin/products")
    expect(result.stdout).not.toMatch(/medusa-config/)
  })

  it("exits 0 when --routes covers discovered host and plugin templates", () => {
    const dir = makeFixture()
    fixtures.push(dir)
    writeFile(join(dir, "staff-routes.json"), `${JSON.stringify(COVERING_ROUTES, null, 2)}\n`)
    const result = run(dir, ["--routes", "staff-routes.json"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/staff-permissions-check: \d+ routes covered/)
    expect(result.stdout).toMatch(/staff-permissions-check: 3 routes covered/)
  })

  it("exits 0 when --config-json covers discovered host and plugin templates", () => {
    const dir = makeFixture()
    fixtures.push(dir)
    const result = run(dir, ["--config-json", JSON.stringify(COVERING_ROUTES)])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/staff-permissions-check: \d+ routes covered/)
  })

  it("prints the merged inventory with --list and exits 0", () => {
    const dir = makeFixture()
    fixtures.push(dir)
    writeFile(join(dir, "staff-routes.json"), `${JSON.stringify(COVERING_ROUTES, null, 2)}\n`)
    const result = run(dir, ["--list", "--routes", "staff-routes.json"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const inventory = JSON.parse(result.stdout)
    expect(inventory["/admin/staff-access"]).toEqual({})
    expect(inventory["/admin/staff-access/[id]"]).toEqual({})
    expect(inventory["/admin/staff-access/[id]/audit"]).toEqual({})
    expect(inventory["/admin/staff-access/me"]).toEqual({})
    expect(inventory["/admin/foo"]).toEqual({})
    expect(inventory["/admin/bar"]).toEqual({})
    expect(inventory["/admin/products"]).toEqual(
      expect.objectContaining({ GET: "catalog.read" })
    )
  })

  it("runs when invoked through a .bin symlink like npx", () => {
    const dir = makeFixture()
    fixtures.push(dir)
    const linkDir = join(dir, "node_modules", ".bin")
    mkdirSync(linkDir, { recursive: true })
    const link = join(linkDir, "staff-permissions-check")
    symlinkSync(bin, link)
    const uncovered = spawnSync(process.execPath, [link], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    })
    expect(uncovered.error).toBeUndefined()
    expect(uncovered.status).toBe(1)
    expect(uncovered.stdout).toContain("/admin/foo")
    expect(uncovered.stdout).toContain("/admin/bar")
    writeFile(join(dir, "staff-routes.json"), `${JSON.stringify(COVERING_ROUTES, null, 2)}\n`)
    const covered = spawnSync(process.execPath, [link, "--routes", "staff-routes.json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    })
    expect(covered.error).toBeUndefined()
    expect(covered.status).toBe(0)
    expect(covered.stdout).toMatch(/staff-permissions-check: \d+ routes covered/)
  })

  it("treats a missing medusa core tree as zero core routes rather than crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "staff-permissions-check-"))
    fixtures.push(dir)
    writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "check-fixture-no-core",
        private: true,
        dependencies: { "medusa-plugin-x": "1.0.0" },
      }, null, 2)}\n`
    )
    writeFile(join(dir, "src/api/admin/foo/route.ts"), "export const GET = () => undefined\n")
    writeFile(
      join(dir, "node_modules/medusa-plugin-x/.medusa/server/src/api/admin/bar/route.js"),
      "module.exports = {}\n"
    )
    writeFile(join(dir, "staff-routes.json"), `${JSON.stringify(COVERING_ROUTES, null, 2)}\n`)
    const result = run(dir, ["--routes", "staff-routes.json"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/staff-permissions-check: 2 routes covered/)
  })
})
