import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import type { AddressInfo } from "node:net"
import express from "express"
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access"
import StaffAccessModuleService from "../../modules/staff-access/service"
import { getStaffAccess } from "../access"
import coreInventory from "../inventory/core-2.19.json"
import { mergeInventory, PACKAGE_ROUTES, type Inventory } from "../inventory/merge"
import { enforceStaffAccess } from "../middleware"
import {
  createPolicy,
  hasStaffPermission,
  normalizeAdminPath,
  type StaffPolicyAccess,
} from "../policy"

jest.mock("../access", () => ({ getStaffAccess: jest.fn() }))

const resolved = { owner_user_ids: [], routes: {}, relations: {}, fields: [] }
const policy = createPolicy(resolved)

const catalogueReader: StaffPolicyAccess = {
  administrator: false,
  disabled: false,
  permissions: ["catalog.read"],
}

const STORE_PROJECTION = [
  "id",
  "name",
  "supported_currencies.*",
  "default_sales_channel_id",
  "default_region_id",
  "default_location_id",
]

type AccessStub = {
  user_id: string
  owner: boolean
  administrator: boolean
  permissions: string[]
  disabled: boolean
  version: number
}

function gate(input: {
  originalUrl: string
  method?: string
  auth_context?: { actor_type?: string; actor_id?: string }
  query?: Record<string, unknown>
  access?: Partial<AccessStub>
  isOwner?: boolean | ((userId: string) => boolean)
  stores?: unknown[]
}) {
  const access: AccessStub = {
    user_id: "user_staff",
    owner: false,
    administrator: false,
    permissions: ["catalog.read"],
    disabled: false,
    version: 1,
    ...input.access,
  }
  jest.mocked(getStaffAccess).mockReset().mockResolvedValue(access)
  const graph = jest.fn().mockResolvedValue({ data: input.stores ?? [] })
  const isOwner = jest.fn().mockImplementation(
    typeof input.isOwner === "function" ? input.isOwner : () => input.isOwner === true,
  )
  const getPolicy = jest.fn().mockReturnValue(policy)
  const next = jest.fn()
  const setHeader = jest.fn()
  const json = jest.fn()
  const request = {
    originalUrl: input.originalUrl,
    method: input.method ?? "GET",
    auth_context: input.auth_context,
    query: input.query ?? {},
    scope: {
      resolve: (key: string) => {
        if (key === STAFF_ACCESS_MODULE) return { isOwner, getPolicy }
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected resolve ${String(key)}`)
      },
    },
  } as unknown as MedusaRequest
  const response = { setHeader, json } as unknown as MedusaResponse
  return { request, response, next, graph, isOwner, getPolicy, setHeader, json }
}

const userAuth = { actor_type: "user", actor_id: "user_staff" }

async function expectNext(ctx: ReturnType<typeof gate>) {
  await enforceStaffAccess(ctx.request, ctx.response, ctx.next)
  expect(ctx.next).toHaveBeenCalledTimes(1)
}

async function expectForbidden(ctx: ReturnType<typeof gate>) {
  await expect(enforceStaffAccess(ctx.request, ctx.response, ctx.next)).rejects.toMatchObject({
    type: MedusaError.Types.FORBIDDEN,
    message: expect.stringMatching(/You do not have permission/),
  })
  expect(ctx.next).not.toHaveBeenCalled()
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

  it.each([
    { permissions: ["catalog.read"], method: "GET", disabled: false, allowed: true },
    { permissions: ["catalog.manage"], method: "GET", disabled: false, allowed: true },
    { permissions: ["catalog.read"], method: "HEAD", disabled: false, allowed: true },
    { permissions: ["content.manage"], method: "GET", disabled: false, allowed: false },
    { permissions: [], method: "GET", disabled: false, allowed: false },
    { permissions: ["catalog.read"], method: "GET", disabled: true, allowed: false },
    { permissions: ["catalog.manage"], method: "POST", disabled: false, allowed: false },
    { permissions: ["catalog.manage"], method: "DELETE", disabled: false, allowed: false },
  ])("enforces product-layout access for %j", async ({ permissions, method, disabled, allowed }) => {
    const ctx = gate({
      originalUrl: "/admin/layouts/product.details/configuration",
      method,
      auth_context: userAuth,
      access: { permissions, disabled },
    })
    if (allowed) {
      await expectNext(ctx)
      expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    } else {
      await expectForbidden(ctx)
    }
  })

  it("allows managers to read, but never grants disabled administrators access", () => {
    expect(hasStaffPermission({ ...catalogueReader, permissions: ["catalog.manage"] }, "catalog.read")).toBe(true)
    expect(hasStaffPermission({ ...catalogueReader, administrator: true, disabled: true }, "catalog.read")).toBe(false)
    expect(hasStaffPermission(catalogueReader, "catalog.manage")).toBe(false)
  })
})

describe("staff request canonicalization", () => {
  it("protects owners whose Medusa-generated IDs contain uppercase ULIDs", async () => {
    const ownerId = "user_01KABCDEF1234567890ABCDEFGH"
    const ctx = gate({
      originalUrl: `/admin/users/${ownerId}`,
      method: "DELETE",
      auth_context: { actor_type: "user", actor_id: "user_other_administrator" },
      access: { user_id: "user_other_administrator", owner: false, administrator: true, permissions: [] },
      isOwner: (userId) => userId === ownerId,
    })
    await expectForbidden(ctx)
    expect(ctx.isOwner).toHaveBeenCalledWith(ownerId)
  })

  it("uses the original URL after Express mounts the global admin middleware", async () => {
    const { RoutesSorter } = require(join(dirname(require.resolve("@medusajs/framework/http")), "routes-sorter.js"))
    const sorted = new RoutesSorter([
      { matcher: "/admin/products/[id]", method: "GET", name: "endpoint" },
      { matcher: "/admin", name: "staff-gate" },
    ]).sort()
    expect(sorted.map((route: { name: string }) => route.name)).toEqual(["staff-gate", "endpoint"])
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

describe("enforceStaffAccess", () => {
  it("names the missing permission when a refund is denied", async () => {
    const ctx = gate({
      originalUrl: "/admin/payments/pay_example/refund",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["orders.read"] },
    })

    await expect(enforceStaffAccess(ctx.request, ctx.response, ctx.next)).rejects.toMatchObject({
      type: MedusaError.Types.FORBIDDEN,
      code: "missing_staff_permission:orders.manage",
      message: expect.stringMatching(/You do not have permission/),
    })
    expect(ctx.next).not.toHaveBeenCalled()

    await expectNext(gate({
      originalUrl: "/admin/payments/pay_example/refund",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["orders.manage"] },
    }))
  })

  it("rejects unauthenticated admin requests as forbidden", async () => {
    const ctx = gate({ originalUrl: "/admin/products" })
    await expectForbidden(ctx)
    expect(getStaffAccess).not.toHaveBeenCalled()
  })

  it("rejects secret api-key actors as forbidden", async () => {
    const ctx = gate({
      originalUrl: "/admin/products",
      auth_context: { actor_type: "api-key", actor_id: "apk_secret" },
    })
    await expectForbidden(ctx)
    expect(getStaffAccess).not.toHaveBeenCalled()
  })

  it("rejects disabled staff even when an administrator flag is present", async () => {
    const ctx = gate({
      originalUrl: "/admin/products",
      auth_context: userAuth,
      access: { administrator: true, disabled: true, permissions: ["catalog.read"] },
    })
    await expectForbidden(ctx)
    expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  })

  it("denies unknown routes to staff and lets administrators through", async () => {
    const staff = gate({
      originalUrl: "/admin/products/new-sensitive-action",
      auth_context: userAuth,
    })
    await expectForbidden(staff)
    const administrator = gate({
      originalUrl: "/admin/products/new-sensitive-action",
      auth_context: { actor_type: "user", actor_id: "user_admin" },
      access: { user_id: "user_admin", administrator: true, permissions: [] },
    })
    await expectNext(administrator)
  })

  it("answers GET /admin/stores for staff with a projection that omits metadata", async () => {
    const stores = [{ id: "store_1", name: "Shop", metadata: { private: true } }]
    const ctx = gate({
      originalUrl: "/admin/stores",
      auth_context: userAuth,
      stores,
    })
    await enforceStaffAccess(ctx.request, ctx.response, ctx.next)
    expect(ctx.next).not.toHaveBeenCalled()
    expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(ctx.graph).toHaveBeenCalledWith({
      entity: "store",
      fields: STORE_PROJECTION,
      pagination: { take: 1 },
    })
    expect(STORE_PROJECTION).not.toContain("metadata")
    expect(ctx.json).toHaveBeenCalledWith({ stores, count: 1, offset: 0, limit: 1 })
  })

  it("keeps workflows-executions owner-only even for administrators", async () => {
    const staff = gate({
      originalUrl: "/admin/workflows-executions",
      auth_context: userAuth,
    })
    await expectForbidden(staff)
    const administrator = gate({
      originalUrl: "/admin/workflows-executions",
      auth_context: { actor_type: "user", actor_id: "user_admin" },
      access: { user_id: "user_admin", owner: false, administrator: true, permissions: [] },
    })
    await expectForbidden(administrator)
    const owner = gate({
      originalUrl: "/admin/workflows-executions/synthetic/run",
      method: "POST",
      auth_context: { actor_type: "user", actor_id: "user_owner" },
      access: { user_id: "user_owner", owner: true, administrator: true, permissions: [] },
    })
    await expectNext(owner)
  })

  it("denies non-GET on an owner user record even for administrators", async () => {
    const ownerId = "user_01owner"
    const denied = gate({
      originalUrl: `/admin/users/${ownerId}`,
      method: "POST",
      auth_context: { actor_type: "user", actor_id: "user_admin" },
      access: { user_id: "user_admin", owner: false, administrator: true, permissions: [] },
      isOwner: (userId) => userId === ownerId,
    })
    await expectForbidden(denied)
    expect(denied.isOwner).toHaveBeenCalledWith(ownerId)
    const allowedGet = gate({
      originalUrl: `/admin/users/${ownerId}`,
      method: "GET",
      auth_context: { actor_type: "user", actor_id: "user_admin" },
      access: { user_id: "user_admin", owner: false, administrator: true, permissions: [] },
      isOwner: true,
    })
    await expectNext(allowedGet)
  })

  it("allows invite accept and feature-flag bootstrap without a staff session", async () => {
    const invite = gate({
      originalUrl: "/admin/invites/accept?token=opaque",
      method: "POST",
    })
    await expectNext(invite)
    expect(getStaffAccess).not.toHaveBeenCalled()
    const flags = gate({
      originalUrl: "/admin/feature-flags",
      query: {},
    })
    await expectNext(flags)
    expect(getStaffAccess).not.toHaveBeenCalled()
  })

  it("does not bootstrap feature-flags when a query is present", async () => {
    await expectForbidden(gate({
      originalUrl: "/admin/feature-flags",
      query: { fields: "id" },
    }))
  })

  it.each(["/admin/users/me", "/admin/plugins", "/admin/staff-access/me"])(
    "allows staff GET %s without fields",
    async (originalUrl) => {
      const ctx = gate({ originalUrl, auth_context: userAuth, access: { permissions: [] } })
      await expectNext(ctx)
      expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    },
  )

  it.each(["/admin/users/me", "/admin/plugins", "/admin/staff-access/me"])(
    "denies staff GET %s when fields are requested",
    async (originalUrl) => {
      await expectForbidden(gate({
        originalUrl,
        auth_context: userAuth,
        query: { fields: "id" },
        access: { permissions: [] },
      }))
    },
  )

  it("treats upload as catalog.manage or content.manage", async () => {
    await expectForbidden(gate({
      originalUrl: "/admin/uploads",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["catalog.read"] },
    }))
    await expectNext(gate({
      originalUrl: "/admin/uploads",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["catalog.manage"] },
    }))
    await expectNext(gate({
      originalUrl: "/admin/uploads",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["content.manage"] },
    }))
  })

  it("treats reference routes as any read or manage grant", async () => {
    await expectForbidden(gate({
      originalUrl: "/admin/regions",
      auth_context: userAuth,
      access: { permissions: [] },
    }))
    await expectNext(gate({
      originalUrl: "/admin/regions",
      auth_context: userAuth,
      access: { permissions: ["catalog.read"] },
    }))
  })

  it("requires orders.read in addition to fulfillment.manage", async () => {
    await expectForbidden(gate({
      originalUrl: "/admin/orders/order_example/fulfillments",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["fulfillment.manage"] },
    }))
    const ctx = gate({
      originalUrl: "/admin/orders/order_example/fulfillments",
      method: "POST",
      auth_context: userAuth,
      access: { permissions: ["fulfillment.manage", "orders.read"] },
    })
    await expectNext(ctx)
    expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  })

  it("rejects an ambiguous admin path before authentication", async () => {
    const ctx = gate({
      originalUrl: "/admin/products/../users",
      auth_context: userAuth,
    })
    await expectForbidden(ctx)
    expect(getStaffAccess).not.toHaveBeenCalled()
  })
})

describe("StaffAccessModuleService.getPolicy", () => {
  it("memoises createPolicy from the resolved options", () => {
    const service = Object.create(StaffAccessModuleService.prototype) as StaffAccessModuleService
    Object.assign(service, {
      options_: {
        owner_user_ids: [],
        routes: { "/admin/legacy-orders": { GET: "orders.read" } },
        relations: {},
        fields: [],
      },
    })
    const first = service.getPolicy()
    const second = service.getPolicy()
    expect(first).toBe(second)
    expect(first.requiredStaffPermission("/admin/legacy-orders", "GET")).toBe("orders.read")
    expect(first.requiredStaffPermission("/admin/products", "GET")).toBe("catalog.read")
  })
})
