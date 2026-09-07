import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, generateJwtToken } from "@medusajs/framework/utils"
import { createApiKeysWorkflow, createInvitesWorkflow, createStoresWorkflow, createUsersWorkflow, deleteUsersWorkflow } from "@medusajs/medusa/core-flows"

export default async function verifyStaffAccessHttp({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "")
  const base = new URL(process.env.STAFF_ACCESS_HTTP_BASE ?? "http://localhost:9015")
  assert(["localhost", "127.0.0.1"].includes(database.hostname))
  assert.equal(database.pathname, "/staff_permissions_lab")
  assert(["localhost", "127.0.0.1"].includes(base.hostname))
  assert.equal(base.protocol, "http:")
  assert.equal(process.env.STAFF_ACCESS_FIXTURE_PROOF, "true")
  assert.equal(process.env.JWT_SECRET, "staff-local-fixture")
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: fixtureStores } = await query.graph({ entity: "store", fields: ["id"] })
  if (!fixtureStores.length) {
    await createStoresWorkflow(container).run({ input: { stores: [{ name: "Staff permissions fixture", supported_currencies: [{ currency_code: "gbp", is_default: true }], metadata: { private_fixture: "must-not-be-visible" } }] } })
  }
  const ownerId = process.env.STAFF_OWNER_USER_IDS?.split(",")[0]?.trim()
  assert(ownerId, "Configure the same existing synthetic owner on the server and proof process")
  const token = (userId: string) => generateJwtToken({ actor_id: userId, actor_type: "user", auth_identity_id: `auth_fixture_${userId}` }, { secret: process.env.JWT_SECRET!, expiresIn: "15m" })
  const ownerToken = token(ownerId)
  let checks = 0
  const request = async (path: string, authentication: string | undefined, expected: number, method = "GET", body?: unknown, scheme = "Bearer") => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { "Content-Type": "application/json", ...(authentication ? { Authorization: `${scheme} ${authentication}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    assert.equal(response.status, expected, `${method} ${new URL(path, base).pathname}: ${result.message ?? response.status}`)
    checks++
    return result
  }
  const suffix = randomUUID()
  const { result: users } = await createUsersWorkflow(container).run({ input: {
    users: ["admin", "reader", "unassigned", "deleted"].map((role) => ({ email: `http-${role}-${suffix}@example.invalid` })),
  } })
  const [administrator, reader, unassigned, deleted] = users
  const adminToken = token(administrator.id)
  const readerToken = token(reader.id)
  const unassignedToken = token(unassigned.id)
  const deletedToken = token(deleted.id)
  const settings = { expected_version: 0, administrator: false, disabled: false, permissions: [] as string[] }
  await request(`/admin/staff-access/${administrator.id}`, ownerToken, 200, "POST", { ...settings, administrator: true })
  await request(`/admin/staff-access/${reader.id}`, ownerToken, 200, "POST", { ...settings, permissions: ["catalog.read"] })
  for (const authentication of [ownerToken, adminToken]) {
    await request("/admin/staff-access/me", authentication, 200)
    const listed = await request(`/admin/staff-access?q=${suffix}&limit=2`, authentication, 200)
    assert.equal(listed.users.length, 2)
    assert.equal(listed.count, 4)
    await request(`/admin/staff-access/${reader.id}`, authentication, 200)
    const audited = await request(`/admin/staff-access/${reader.id}/audit`, authentication, 200)
    assert.equal(audited.count, 1)
  }
  await request(`/admin/staff-access/${reader.id}`, adminToken, 409, "POST", settings)
  await request(`/admin/staff-access/${reader.id}`, adminToken, 400, "POST", { ...settings, permissions: ["invented.manage"] })
  await request(`/admin/staff-access/${reader.id}`, adminToken, 400, "POST", { ...settings, owner: true })
  await request(`/admin/staff-access/${administrator.id}`, adminToken, 403, "POST", { ...settings, expected_version: 1 })
  logger.info("STAFF HTTP PROOF: owner/admin listing, search/count, editor, audit, CAS and strict input validation pass")

  await request("/admin/users/me", unassignedToken, 200)
  await request("/admin/stores", unassignedToken, 200)
  const unassignedAccess = await request("/admin/staff-access/me", unassignedToken, 200)
  assert.deepEqual(unassignedAccess.access.permissions, [])
  await request("/admin/products", unassignedToken, 403)
  await request(`/admin/staff-access/${unassigned.id}`, ownerToken, 200, "POST", { ...settings, permissions: ["catalog.manage"] })
  const created = await request("/admin/products", unassignedToken, 200, "POST", {
    title: `managed-${suffix}`, handle: `managed-${suffix}`, status: "draft",
    options: [{ title: "Fixture", values: ["Default"] }],
    variants: [{ title: "Default", options: { Fixture: "Default" }, manage_inventory: false, prices: [{ currency_code: "gbp", amount: 10 }] }],
  })
  assert(created.product.id)

  const readable = await request(`/admin/products/${created.product.id}`, readerToken, 200)
  assert.equal(readable.product.title, `managed-${suffix}`)
  await request("/admin/product-categories?limit=1", readerToken, 200)
  await request("/admin/products", readerToken, 403, "POST", { title: `forbidden-${suffix}` })
  const forbiddenProducts = await query.graph({ entity: "product", fields: ["id"], filters: { title: `forbidden-${suffix}` } })
  assert.equal(forbiddenProducts.data.length, 0)
  await request("/admin/customers", readerToken, 403)
  await request("/admin/orders", readerToken, 403)
  await request("/admin/staff-access", readerToken, 403)
  await request(`/admin/staff-access/${reader.id}/audit`, readerToken, 403)
  await request("/admin/users/me", readerToken, 200)
  await request("/admin/staff-access/me", readerToken, 200)
  await request("/admin/feature-flags", readerToken, 200)
  await request("/admin/plugins", readerToken, 200)
  const stores = await request("/admin/stores?fields=*", readerToken, 200)
  assert.equal(stores.stores.length, 1)
  for (const store of stores.stores) assert(!Object.prototype.hasOwnProperty.call(store, "metadata"))
  await request("/admin/uploads", readerToken, 403, "POST", {})
  const expanded = await request(`/admin/products/${created.product.id}?fields=` + encodeURIComponent("id,title,*variants,*variants.prices"), readerToken, 200)
  assert.equal(expanded.product.id, created.product.id)
  assert.equal(expanded.product.variants.length, 1)
  await request("/admin/products?fields=" + encodeURIComponent("*"), readerToken, 200)
  await request("/admin/products?fields=" + encodeURIComponent("*variants.inventory_items.inventory"), readerToken, 403)
  await request("/admin/products?fields=" + encodeURIComponent("*unknown_relation"), readerToken, 403)
  await request("/admin/users/me?fields=" + encodeURIComponent("*roles"), readerToken, 403)
  await request("/admin/workflows-executions", readerToken, 403)
  await request("/admin/workflows-executions", adminToken, 403)
  await request("/admin/workflows-executions/synthetic/run", readerToken, 403, "POST", {})
  await request(`/admin/products/${created.product.id}`, unassignedToken, 200, "DELETE")
  const deletedProducts = await query.graph({ entity: "product", fields: ["id"], filters: { id: created.product.id } })
  assert.equal(deletedProducts.data.length, 0)
  logger.info("STAFF HTTP PROOF: catalogue manage creates/deletes a draft; reader sees it and cannot mutate")
  logger.info("STAFF HTTP PROOF: catalogue view, denied mutations/domains, bootstrap and field expansion restrictions pass")

  await request(`/admin/staff-access/${reader.id}`, adminToken, 200, "POST", { ...settings, expected_version: 1, disabled: true, permissions: ["catalog.read"] })
  await request("/admin/products", readerToken, 403)
  await request("/admin/users/me", readerToken, 403)
  await deleteUsersWorkflow(container).run({ input: { ids: [deleted.id] } })
  await request("/admin/users/me", deletedToken, 403)
  const { result: keys } = await createApiKeysWorkflow(container).run({ input: {
    api_keys: [{ title: `staff-http-${suffix}`, type: "secret", created_by: ownerId }],
  } })
  await request("/admin/products", keys[0].token, 401)
  await request("/admin/products", keys[0].token, 403, "GET", undefined, "Basic")
  logger.info("STAFF HTTP PROOF: unassigned, disabled, deleted and secret-key sessions fail closed")

  await request(`/admin/users/${ownerId}`, ownerToken, 403, "POST", { first_name: "Forbidden" })
  await request(`/admin/users/${ownerId}`, ownerToken, 403, "DELETE")
  await request(`/ADMIN/USERS/${ownerId}`, ownerToken, 403, "DELETE")
  await request(`/admin/staff-access/${ownerId}`, adminToken, 403, "POST", settings)
  await request("/admin/invites/accept?token=invalid-fixture-token", undefined, 401, "POST", { first_name: "Synthetic", last_name: "Invite" })
  logger.info("STAFF HTTP PROOF: uppercase owner ID survives native edits/deletion; invite accept reaches native authentication")

  const inviteEmail = `http-invite-${suffix}@example.invalid`
  const { result: invites } = await createInvitesWorkflow(container).run({ input: { invites: [{ email: inviteEmail }] } })
  const registered = await request("/auth/user/emailpass/register", undefined, 200, "POST", { email: inviteEmail, password: `Synthetic-${randomUUID()}` })
  const accepted = await request(`/admin/invites/accept?token=${encodeURIComponent(invites[0].token)}`, registered.token, 200, "POST", { first_name: "Synthetic", last_name: "Invite" })
  assert(accepted.user.id)
  const invitedToken = token(accepted.user.id)
  const invitedAccess = await request("/admin/staff-access/me", invitedToken, 200)
  assert.equal(invitedAccess.access.administrator, false)
  assert.deepEqual(invitedAccess.access.permissions, [])
  await request("/admin/products", invitedToken, 403)
  logger.info(`STAFF HTTP PROOF PASSED: ${checks} authenticated HTTP assertions; new invite remains unassigned`)
}
