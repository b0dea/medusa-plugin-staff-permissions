import {
  createPolicy,
  hasStaffPermission,
  normalizeAdminPath,
  type StaffPolicyAccess,
} from "../policy"
import { existsSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { mergeInventory, PACKAGE_ROUTES, type Inventory } from "../inventory/merge"
import coreInventory from "../inventory/core-2.19.json"
import express from "express"
import type { AddressInfo } from "node:net"

const resolved = { owner_user_ids: [], routes: {}, relations: {}, fields: [] }
const policy = createPolicy(resolved)

const catalogueReader: StaffPolicyAccess = {
  administrator: false,
  disabled: false,
  permissions: ["catalog.read"],
}

describe("staff route policy", () => {
  it("records every package admin endpoint, including deliberately denied routes", () => {
    const inventory = mergeInventory(mergeInventory(coreInventory as Inventory, PACKAGE_ROUTES), {})
    const missing = new Set<string>()
    const root = resolve("src/api/admin")
    function inspectRoutes(directory: string) {
      if (!existsSync(directory)) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const pathname = join(directory, entry.name)
        if (entry.isDirectory()) inspectRoutes(pathname)
        else if (entry.name === "route.ts") {
          const route = `/admin/${relative(root, directory).split("\\").join("/")}`.replace(/\/$/, "")
          if (!Object.prototype.hasOwnProperty.call(inventory, route)) missing.add(route)
        }
      }
    }
    inspectRoutes(root)
    expect([...missing].sort()).toEqual([])
  })

  it.each([
    ["/admin/products/prod_example", "GET", "catalog.read"],
    ["/admin/products/prod_example", "HEAD", "catalog.read"],
    ["/admin/layouts/product.details/configuration", "GET", "catalog.read"],
    ["/admin/layouts/product.details/configuration", "HEAD", "catalog.read"],
    ["/admin/products/batch", "POST", "catalog.manage"],
    ["/admin/products/prod_example/variants/batch", "POST", "catalog.manage"],
    ["/admin/payments/pay_example/refund", "POST", "orders.manage"],
    ["/admin/payment-collections/paycol_example/mark-as-paid", "POST", "orders.manage"],
    ["/admin/orders/order_example/cancel", "POST", "orders.manage"],
    ["/admin/orders/order_example/fulfillments", "POST", "fulfillment.manage"],
  ])("requires the intended permission for %s %s", (path, method, permission) => {
    expect(policy.requiredStaffPermission(path, method)).toBe(permission)
  })

  it.each([
    ["/admin/products/new-sensitive-action", "POST"],
    ["/admin/products/new-sensitive-action", "GET"],
    ["/admin/workflows-executions/create-api-keys/run", "POST"],
    ["/admin/api-keys", "POST"],
    ["/admin/notifications", "GET"],
    ["/admin/uploads/file_example", "GET"],
    ["/admin/products/batch", "GET"],
    ["/admin/products", "PATCH"],
    ["/admin/layouts/product.details/configuration", "POST"],
    ["/admin/layouts/product.details/configuration", "DELETE"],
    ["/admin/layouts/product.details/configuration", "PATCH"],
    ["/admin/layouts/product_category.details/configuration", "GET"],
    ["/admin/layouts/orders.details/configuration", "GET"],
    ["/admin/layouts/sidebar/configuration", "GET"],
    ["/admin/layouts/unknown/configuration", "GET"],
    ["/admin/layouts/configurations", "GET"],
  ])("does not inherit a grant for %s %s", (path, method) => {
    expect(policy.requiredStaffPermission(path, method)).toBeNull()
  })

  it("grants only product-layout reads without opening writes or other layout endpoints", () => {
    expect(coreInventory["/admin/layouts/[zone]/configuration"]).toEqual({})
    expect(coreInventory["/admin/layouts/configurations"]).toEqual({})
    expect(policy.requiredStaffPermission("/admin/layouts/product.details/configuration", "GET")).toBe("catalog.read")
    expect(policy.requiredStaffPermission("/admin/layouts/product.details/configuration", "POST")).toBeNull()
  })

  it("allows managers to read, but never grants disabled administrators access", () => {
    expect(hasStaffPermission({ ...catalogueReader, permissions: ["catalog.manage"] }, "catalog.read")).toBe(true)
    expect(hasStaffPermission({ ...catalogueReader, administrator: true, disabled: true }, "catalog.read")).toBe(false)
    expect(hasStaffPermission(catalogueReader, "catalog.manage")).toBe(false)
  })
})

describe("staff request canonicalization", () => {
  it("uses the original URL after Express mounts the global admin middleware", async () => {
    const application = express()
    application.use("/admin", (request, response) => {
      response.json({
        mountedPath: request.path,
        canonicalPath: normalizeAdminPath(request.originalUrl),
      })
    })
    const server = application.listen(0, "127.0.0.1")
    try {
      await new Promise<void>((resolveListening, rejectListening) => {
        server.once("listening", resolveListening)
        server.once("error", rejectListening)
      })
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/ADMIN/products/prod_example/?fields=id`)
      expect(await response.json()).toEqual({
        mountedPath: "/products/prod_example/",
        canonicalPath: "/admin/products/prod_example",
      })
    } finally {
      await new Promise<void>((resolveClosed, rejectClosed) => {
        server.close((error) => error ? rejectClosed(error) : resolveClosed())
        server.closeAllConnections()
      })
    }
  })

  it.each([
    ["/ADMIN/Products/prod_example/", "/admin/products/prod_example"],
    ["/admin/invites/accept?token=opaque%2Ftoken", "/admin/invites/accept"],
    ["/admin/invites/accept-extra", "/admin/invites/accept-extra"],
  ])("canonicalizes %s", (path, expected) => {
    expect(normalizeAdminPath(path)).toBe(expected)
  })

  it.each([
    "/admin/%69nvites/accept",
    "/admin/products/prod_example%2Fvariants",
    "/admin/products/prod_example%252Fvariants",
    "/admin/products/../users",
    "/admin//products",
    "/admin/products\\prod_example",
    "/admin/products/%",
  ])("rejects ambiguous path %s", (path) => {
    expect(normalizeAdminPath(path)).toBeNull()
  })
})

describe("staff relation policy", () => {
  it.each([
    "id,title,metadata",
    "*variants",
    "+*variants.prices",
    "variants.prices.*",
    "*collection,*categories",
  ])("accepts normal catalogue field selection %s", (fields) => {
    expect(policy.staffFieldsAllowed(fields, catalogueReader, "catalog.read")).toBe(true)
  })

  it.each([
    "customer.email",
    "*customers",
    "+*variants.inventory_items",
    "variants.product.orders.*",
    "sales_channels.orders.*",
    "*auth_identity",
    "*rbac_roles",
    "*new_private_relation",
    "private_relation",
    "variants.private_relation",
    "auth_identity",
    "rbac_roles",
    "variants.*.customer",
    "product_family",
    "members",
    "content_blocks",
    "faqs",
    "blog",
    "articles",
  ])("rejects unauthorized or unknown relation selection %s", (fields) => {
    expect(policy.staffFieldsAllowed(fields, catalogueReader, "catalog.read")).toBe(false)
  })

  it("accepts explicitly granted inventory relations", () => {
    expect(policy.staffFieldsAllowed("+*variants.inventory_items", {
      ...catalogueReader,
      permissions: ["catalog.read", "inventory.read"],
    }, "catalog.read")).toBe(true)
  })

  it("rejects non-scalar query syntax", () => {
    expect(policy.staffFieldsAllowed(["id", "customer.email"], catalogueReader, "catalog.read")).toBe(false)
    expect(policy.staffFieldsAllowed({ fields: "customer.email" }, catalogueReader, "catalog.read")).toBe(false)
  })
})
