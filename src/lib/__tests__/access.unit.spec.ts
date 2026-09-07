import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access"
import { assertStaffAdministrator, getStaffAccess } from "../access"
import { isStaffOwner } from "../owners"

describe("effective staff access", () => {
  const graph = jest.fn()
  const isOwner = jest.fn()
  const listStaffAccesses = jest.fn()
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === STAFF_ACCESS_MODULE) return { isOwner, listStaffAccesses }
      throw new Error(`unexpected resolve ${String(key)}`)
    }),
  } as unknown as MedusaContainer

  beforeEach(() => {
    graph.mockReset().mockResolvedValue({ data: [{ id: "user_staff" }] })
    isOwner.mockReset().mockReturnValue(false)
    listStaffAccesses.mockReset().mockResolvedValue([])
  })

  it("gives an existing unassigned staff member no permissions", async () => {
    await expect(getStaffAccess(container, "user_staff")).resolves.toEqual({
      user_id: "user_staff", owner: false, administrator: false, disabled: false,
      permissions: [], version: 0,
    })
    await expect(assertStaffAdministrator(container, "user_staff")).rejects.toThrow("Administrator access is required")
  })

  it("reads current grants each time so an existing session observes revocation", async () => {
    listStaffAccesses.mockResolvedValueOnce([{ administrator: true, disabled: false, permissions: { grants: ["catalog.read"] }, version: 1 }])
    listStaffAccesses.mockResolvedValueOnce([{ administrator: false, disabled: false, permissions: { grants: [] }, version: 2 }])
    await expect(assertStaffAdministrator(container, "user_staff")).resolves.toMatchObject({ administrator: true })
    await expect(assertStaffAdministrator(container, "user_staff")).rejects.toThrow("Administrator access is required")
    expect(listStaffAccesses).toHaveBeenCalledTimes(2)
  })

  it("disabled accounts lose administrator and checkbox permissions", async () => {
    listStaffAccesses.mockResolvedValue([{ administrator: true, disabled: true, permissions: { grants: ["catalog.read"] }, version: 3 }])
    await expect(getStaffAccess(container, "user_staff")).resolves.toMatchObject({
      administrator: false, disabled: true, permissions: [], version: 3,
    })
  })

  it("requires a recovery owner to still be an existing Medusa user", async () => {
    isOwner.mockReturnValue(true)
    graph.mockResolvedValue({ data: [] })
    await expect(getStaffAccess(container, "user_staff")).rejects.toThrow("no longer active")
    expect(listStaffAccesses).not.toHaveBeenCalled()
  })

  it("uses the service owner check and ignores their editable record", async () => {
    isOwner.mockImplementation((userId: string) => userId === "user_staff")
    listStaffAccesses.mockResolvedValue([{ administrator: false, disabled: true, permissions: { grants: [] }, version: 9 }])
    await expect(getStaffAccess(container, "user_staff")).resolves.toMatchObject({
      owner: true, administrator: true, disabled: false, version: 0,
    })
    expect(listStaffAccesses).not.toHaveBeenCalled()
    expect(isOwner).toHaveBeenCalledWith("user_staff")
    graph.mockResolvedValue({ data: [{ id: "user_sta" }] })
    isOwner.mockReturnValue(false)
    await expect(getStaffAccess(container, "user_sta")).resolves.toMatchObject({ owner: false, administrator: false })
  })

  it("rejects a missing actor ID before any potentially unfiltered query", async () => {
    await expect(getStaffAccess(container, undefined as unknown as string)).rejects.toThrow("A staff account is required")
    expect(graph).not.toHaveBeenCalled()
    expect(listStaffAccesses).not.toHaveBeenCalled()
    expect(isOwner).not.toHaveBeenCalled()
  })

  it("does not derive privileges from user metadata", async () => {
    graph.mockResolvedValue({ data: [{ id: "user_staff", metadata: { role: "admin", administrator: true } }] })
    await expect(getStaffAccess(container, "user_staff")).resolves.toMatchObject({ administrator: false, permissions: [] })
    expect(graph).toHaveBeenCalledWith({ entity: "user", fields: ["id"], filters: { id: "user_staff" } })
  })

  it.each([null, ["catalog.read"], { grants: "catalog.read" }, { grants: ["catalog.read", 123] }])("denies malformed stored grants %j", async (permissions) => {
    listStaffAccesses.mockResolvedValue([{ administrator: false, disabled: false, permissions, version: 1 }])
    await expect(getStaffAccess(container, "user_staff")).resolves.toMatchObject({ permissions: [] })
  })

  it("decodes valid object grants into the public checkbox array", async () => {
    listStaffAccesses.mockResolvedValue([{ administrator: false, disabled: false, permissions: { grants: ["catalog.read"] }, version: 1 }])
    await expect(getStaffAccess(container, "user_staff")).resolves.toMatchObject({ permissions: ["catalog.read"] })
  })

  it("wraps the service owner check for middleware use", () => {
    isOwner.mockReturnValue(true)
    expect(isStaffOwner(container, "user_staff")).toBe(true)
    expect(isOwner).toHaveBeenCalledWith("user_staff")
  })
})
