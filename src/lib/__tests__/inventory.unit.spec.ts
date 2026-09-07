import { createPolicy, type StaffPolicyAccess } from "../policy"
import { mergeInventory, PACKAGE_ROUTES, type Inventory } from "../inventory/merge"
import { validateInventory } from "../inventory/validate"
import coreInventory from "../inventory/core-2.19.json"

const catalogueReader: StaffPolicyAccess = {
  administrator: false,
  disabled: false,
  permissions: ["catalog.read"],
}

describe("mergeInventory", () => {
  it("lets a host key replace the core key wholesale", () => {
    const core: Inventory = { "/admin/products": { GET: "catalog.read", POST: "catalog.manage" } }
    const host: Inventory = { "/admin/products": { GET: "catalog.read" } }
    expect(mergeInventory(core, host)["/admin/products"]).toEqual({ GET: "catalog.read" })
  })

  it("keeps core keys that the host does not mention", () => {
    const core: Inventory = { "/admin/products": { GET: "catalog.read" } }
    const host: Inventory = { "/admin/legacy-orders": { GET: "orders.read" } }
    expect(mergeInventory(core, host)).toEqual({
      "/admin/products": { GET: "catalog.read" },
      "/admin/legacy-orders": { GET: "orders.read" },
    })
  })
})

describe("host inventory", () => {
  it("treats a host administrator-only route as denied to staff", () => {
    const policy = createPolicy({
      owner_user_ids: [],
      routes: { "/admin/legacy-orders/import": {} },
      relations: {},
      fields: [],
    })
    expect(policy.requiredStaffPermission("/admin/legacy-orders/import", "POST")).toBeNull()
    expect(policy.requiredStaffPermission("/admin/legacy-orders/import", "GET")).toBeNull()
  })

  it("grants a host route from options.routes", () => {
    const policy = createPolicy({
      owner_user_ids: [],
      routes: { "/admin/legacy-orders": { GET: "orders.read" } },
      relations: {},
      fields: [],
    })
    expect(policy.requiredStaffPermission("/admin/legacy-orders", "GET")).toBe("orders.read")
  })

  it("extends field policy with host relations and fields", () => {
    const policy = createPolicy({
      owner_user_ids: [],
      routes: {},
      relations: { product_family: "catalog" },
      fields: ["flavour_label"],
    })
    expect(policy.staffFieldsAllowed("product_family,flavour_label", catalogueReader, "catalog.read")).toBe(true)
  })
})

describe("core inventory", () => {
  it("does not ship starter-only or package routes in the walker inventory", () => {
    const keys = Object.keys(coreInventory)
    expect(keys.filter((path) =>
      path.includes("/staff-access") ||
      path.includes("legacy-orders") ||
      path.includes("merchant-") ||
      path.includes("meilisearch")
    )).toEqual([])
  })

  it("covers package staff-access routes in the merged inventory", () => {
    const inventory = mergeInventory(coreInventory as Inventory, PACKAGE_ROUTES)
    expect(inventory["/admin/staff-access"]).toEqual({})
    expect(inventory["/admin/staff-access/[id]"]).toEqual({})
    expect(inventory["/admin/staff-access/[id]/audit"]).toEqual({})
    expect(inventory["/admin/staff-access/me"]).toEqual({})
  })
})

describe("validateInventory", () => {
  it("accepts an empty-object route entry", () => {
    expect(validateInventory({ "/admin/legacy-orders/import": {} })).toEqual({
      "/admin/legacy-orders/import": {},
    })
  })

  it("rejects a route key that does not start with /admin/", () => {
    expect(() => validateInventory({ "/store/products": { GET: "catalog.read" } })).toThrow(
      expect.objectContaining({
        type: "invalid_data",
        message: expect.stringMatching(/\/admin\//),
      })
    )
  })

  it("rejects PATCH as a route method", () => {
    expect(() => validateInventory({ "/admin/products": { PATCH: "catalog.manage" } })).toThrow(
      expect.objectContaining({
        type: "invalid_data",
        message: expect.stringMatching(/PATCH/),
      })
    )
  })

  it("accepts upload and reference route values", () => {
    expect(validateInventory({
      "/admin/uploads": { POST: "upload" },
      "/admin/products": { GET: "reference" },
    })).toEqual({
      "/admin/uploads": { POST: "upload" },
      "/admin/products": { GET: "reference" },
    })
  })
})
