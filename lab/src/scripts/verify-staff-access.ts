import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createUsersWorkflow } from "@medusajs/medusa/core-flows"
import { getStaffAccess } from "@hollowpoint-io/medusa-plugin-staff-permissions/lib/access"
import { PERMISSION_IDS } from "@hollowpoint-io/medusa-plugin-staff-permissions/lib/policy"
import { STAFF_ACCESS_MODULE } from "@hollowpoint-io/medusa-plugin-staff-permissions/modules/staff-access"
import { updateStaffAccessWorkflow } from "@hollowpoint-io/medusa-plugin-staff-permissions/workflows"

type StaffAccessModuleService = {
  listStaffAccesses: (
    selector: { user_id: string },
    config?: { take?: number },
  ) => Promise<Array<{ version?: number }>>
  listStaffAccessAudits: (selector: { target_user_id: string }) => Promise<unknown[]>
  saveStaffAccess: (input: {
    actor_id: string
    user_id: string
    expected_version: number
    administrator: boolean
    disabled: boolean
    permissions: string[]
  }) => Promise<unknown>
}

export default async function verifyStaffAccess({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "")
  assert(["localhost", "127.0.0.1"].includes(database.hostname))
  assert.equal(database.pathname, "/staff_permissions_lab")
  assert.equal(process.env.STAFF_ACCESS_FIXTURE_PROOF, "true")
  const ownerId = process.env.STAFF_OWNER_USER_IDS?.split(",")[0]?.trim()
  assert(ownerId, "STAFF_OWNER_USER_IDS must be set to an existing user before this proof")
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const connection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const service = container.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
  const ownerAccess = await getStaffAccess(container, ownerId)
  assert.equal(ownerAccess.owner, true)
  const suffix = randomUUID()
  const { result: users } = await createUsersWorkflow(container).run({ input: {
    users: ["admin", "target"].map((role) => ({ email: `staff-${role}-${suffix}@example.invalid` })),
  } })
  const [administrator, target] = users
  const owner = { id: ownerId }
  const base = {
    actor_id: owner.id,
    user_id: target.id,
    expected_version: 0,
    administrator: false,
    disabled: false,
    permissions: [PERMISSION_IDS[0]],
  }
  const update = (input: typeof base) => updateStaffAccessWorkflow(container).run({ input })
  await assert.rejects(update({ ...base, user_id: `user_missing_${suffix}` }))
  const missing = await service.listStaffAccesses({ user_id: `user_missing_${suffix}` })
  assert.equal(missing.length, 0)
  logger.info("STAFF PROOF: missing target rejected without grant")

  const creations = await Promise.allSettled([
    update(base),
    update({ ...base, permissions: [] }),
  ])
  assert.equal(creations.filter((result) => result.status === "fulfilled").length, 1)
  const conflict = creations.find((result) => result.status === "rejected") as PromiseRejectedResult
  assert.equal(conflict.reason.type, "conflict")
  let access = await getStaffAccess(container, target.id)
  assert.equal(access.version, 1)
  let audits = await service.listStaffAccessAudits({ target_user_id: target.id })
  assert.equal(audits.length, 1)
  logger.info("STAFF PROOF: concurrent first grants produce one winner, one conflict, one audit")

  const edits = await Promise.allSettled([
    update({ ...base, expected_version: 1, disabled: true }),
    update({ ...base, expected_version: 1, permissions: [] }),
  ])
  assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1)
  access = await getStaffAccess(container, target.id)
  assert.equal(access.version, 2)
  audits = await service.listStaffAccessAudits({ target_user_id: target.id })
  assert.equal(audits.length, 2)
  logger.info("STAFF PROOF: concurrent edits preserve optimistic concurrency")

  await update({ ...base, user_id: administrator.id, administrator: true })
  const blocker = await connection.transaction()
  await blocker.raw("select pg_advisory_xact_lock(?, ?)", [1937006963, 1])
  const pending = service.saveStaffAccess({ ...base, actor_id: administrator.id, expected_version: 2 })
  const pendingResult = Promise.allSettled([pending])
  let waiting = false
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const lockResult = await connection.raw("select count(*)::integer as count from pg_locks where locktype = 'advisory' and classid = ? and objid = ? and granted = false", [1937006963, 1])
      if (lockResult.rows[0].count > 0) {
        waiting = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert(waiting, "grant request must be waiting inside its transaction")
    await blocker("staff_access").where({ user_id: administrator.id }).update({ administrator: false })
    await blocker.commit()
  } catch (error) {
    await blocker.rollback()
    throw error
  }
  const [revokedResult] = await pendingResult
  assert.equal(revokedResult.status, "rejected")
  if (revokedResult.status === "rejected") assert.match(revokedResult.reason.message, /Administrator access is required/)
  assert.equal((await getStaffAccess(container, target.id)).version, 2)
  logger.info("STAFF PROOF: administrator revoked while waiting cannot commit a grant")

  await connection.raw("create or replace function staff_fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end; $$")
  await connection.raw("create trigger staff_fixture_reject_audit before insert on staff_access_audit for each row execute function staff_fixture_reject_audit()")
  const beforeFailure = await service.listStaffAccesses({ user_id: target.id })
  try {
    await assert.rejects(update({ ...base, expected_version: 2, administrator: true }), (error: { message: string }) => error.message.includes("synthetic audit failure"))
  } finally {
    await connection.raw("drop trigger if exists staff_fixture_reject_audit on staff_access_audit")
    await connection.raw("drop function if exists staff_fixture_reject_audit()")
  }
  const afterFailure = await service.listStaffAccesses({ user_id: target.id })
  assert.deepEqual(afterFailure, beforeFailure)
  assert.equal((await service.listStaffAccessAudits({ target_user_id: target.id })).length, 2)
  logger.info("STAFF PROOF: database audit failure rolls back grant and version atomically")

  await assert.rejects(update({ ...base, user_id: owner.id }))
  await assert.rejects(update({ ...base, actor_id: administrator.id, user_id: administrator.id, expected_version: 1 }))
  logger.info("STAFF PROOF: protected owner and revoked actor rejected")
  logger.info("STAFF PROOF PASSED: synthetic isolated PostgreSQL only")
}
