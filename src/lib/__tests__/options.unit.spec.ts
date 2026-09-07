import { resolveOptions } from "../../modules/staff-access/options"

describe("resolveOptions", () => {
  it("falls back to STAFF_OWNER_USER_IDS when owner_user_ids is omitted", () => {
    expect(
      resolveOptions({}, { STAFF_OWNER_USER_IDS: " user_a, user_b, " }).owner_user_ids
    ).toEqual(["user_a", "user_b"])
  })

  it("lets option owner_user_ids beat STAFF_OWNER_USER_IDS", () => {
    expect(
      resolveOptions(
        { owner_user_ids: ["user_option"] },
        { STAFF_OWNER_USER_IDS: "user_env" }
      ).owner_user_ids
    ).toEqual(["user_option"])
  })

  it("defaults owner_user_ids to an empty array when neither option nor env is set", () => {
    expect(resolveOptions({}, {}).owner_user_ids).toEqual([])
  })

  it("rejects a route key that does not start with /admin/", () => {
    expect(() =>
      resolveOptions({ routes: { "/store/products": { GET: "catalog.read" } } }, {})
    ).toThrow(expect.objectContaining({
      type: "invalid_data",
      message: expect.stringMatching(/\/admin\//),
    }))
  })

  it("rejects PATCH as a route method", () => {
    expect(() =>
      resolveOptions({ routes: { "/admin/products": { PATCH: "catalog.manage" } } }, {})
    ).toThrow(expect.objectContaining({
      type: "invalid_data",
      message: expect.stringMatching(/PATCH/),
    }))
  })

  it("rejects an unknown permission id", () => {
    expect(() =>
      resolveOptions({ routes: { "/admin/products": { GET: "products.read" } } }, {})
    ).toThrow(expect.objectContaining({
      type: "invalid_data",
      message: expect.stringMatching(/products\.read/),
    }))
  })

  it("accepts an empty-object route entry", () => {
    expect(
      resolveOptions({ routes: { "/admin/meilisearch/sync": {} } }, {}).routes
    ).toEqual({ "/admin/meilisearch/sync": {} })
  })

  it("accepts upload and reference route values", () => {
    expect(
      resolveOptions({
        routes: {
          "/admin/uploads": { POST: "upload" },
          "/admin/products": { GET: "reference" },
        },
      }, {}).routes
    ).toEqual({
      "/admin/uploads": { POST: "upload" },
      "/admin/products": { GET: "reference" },
    })
  })

  it("rejects a relation mapped to an unknown group", () => {
    expect(() =>
      resolveOptions({ relations: { product_family: "products" } }, {})
    ).toThrow(expect.objectContaining({
      type: "invalid_data",
      message: expect.stringMatching(/products/),
    }))
  })

  it("rejects a field name that contains a hyphen", () => {
    expect(() =>
      resolveOptions({ fields: ["flavour-label"] }, {})
    ).toThrow(expect.objectContaining({
      type: "invalid_data",
      message: expect.stringMatching(/flavour-label/),
    }))
  })
})
