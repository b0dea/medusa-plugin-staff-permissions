import StaffAccessModuleService from "../../modules/staff-access/service"
import type { UpdateStaffAccessInput } from "../../modules/staff-access/types"

describe("transactional staff access updates", () => {
  const manager = { execute: jest.fn().mockResolvedValue([]) }
  const service = Object.create(StaffAccessModuleService.prototype) as StaffAccessModuleService
  const listStaffAccesses = jest.fn()
  const createStaffAccesses = jest.fn().mockResolvedValue({})
  const updateStaffAccesses = jest.fn().mockResolvedValue({})
  const createStaffAccessAudits = jest.fn().mockResolvedValue({})
  const input: UpdateStaffAccessInput = {
    actor_id: "user_admin", user_id: "user_staff", expected_version: 0,
    administrator: false, disabled: false, permissions: ["products.read"],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(service, {
      options_: { owner_user_ids: ["user_owner"], routes: {}, relations: {}, fields: [] },
      baseRepository_: { getFreshManager: () => manager, transaction: (callback: (transaction: typeof manager) => Promise<unknown>) => callback(manager) },
      listStaffAccesses, createStaffAccesses, updateStaffAccesses, createStaffAccessAudits,
    })
    listStaffAccesses.mockReset().mockImplementation(async (filter) => filter.user_id === "user_admin"
      ? [{ user_id: "user_admin", administrator: true, disabled: false }]
      : [])
  })

  it("serializes writes before rechecking the actor and shares the transaction with grant and audit writes", async () => {
    await expect(service.saveStaffAccess(input)).resolves.toMatchObject({ version: 1, permissions: ["products.read"] })
    expect(manager.execute).toHaveBeenCalledWith("select pg_advisory_xact_lock(?, ?)", [1937006963, 1])
    expect(manager.execute.mock.invocationCallOrder[0]).toBeLessThan(listStaffAccesses.mock.invocationCallOrder[0])
    const context = createStaffAccesses.mock.calls[0][1]
    expect(createStaffAccesses.mock.calls[0][0].permissions).toEqual({ grants: ["products.read"] })
    expect(context.transactionManager).toBe(manager)
    expect(createStaffAccessAudits.mock.calls[0][1]).toBe(context)
    expect(createStaffAccessAudits.mock.calls[0][0]).toMatchObject({ actor_id: "user_admin", target_user_id: "user_staff", before: null, after: { version: 1 } })
  })

  it("rejects an administrator revoked before the write transaction", async () => {
    listStaffAccesses.mockResolvedValue([{ administrator: false, disabled: false }])
    await expect(service.saveStaffAccess(input)).rejects.toThrow("Administrator access is required")
    expect(createStaffAccesses).not.toHaveBeenCalled()
    expect(createStaffAccessAudits).not.toHaveBeenCalled()
  })

  it("rejects stale versions without overwriting or auditing", async () => {
    listStaffAccesses.mockImplementation(async (filter) => filter.user_id === "user_admin"
      ? [{ administrator: true, disabled: false }]
      : [{ version: 2 }])
    await expect(service.saveStaffAccess({ ...input, expected_version: 1 })).rejects.toMatchObject({ type: "conflict" })
    expect(updateStaffAccesses).not.toHaveBeenCalled()
    expect(createStaffAccessAudits).not.toHaveBeenCalled()
  })

  it.each(["user_admin", "user_owner"])("forbids editing self or recovery owner %s", async (userId) => {
    await expect(service.saveStaffAccess({ ...input, user_id: userId })).rejects.toThrow("cannot change your own access")
    expect(listStaffAccesses).not.toHaveBeenCalled()
  })

  it("propagates an audit failure to the transaction instead of reporting a saved grant", async () => {
    createStaffAccessAudits.mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(service.saveStaffAccess(input)).rejects.toThrow("audit unavailable")
  })
})
