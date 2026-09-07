import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertStaffAdministrator, getStaffAccess } from "../../../lib/access"
import type { ListStaffAccessQuery } from "./validators"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await assertStaffAdministrator(req.scope, req.auth_context.actor_id)
  const { q, offset, limit } = req.validatedQuery as ListStaffAccessQuery
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data, metadata } = await query.graph({
    entity: "user",
    fields: ["id", "email", "first_name", "last_name"],
    filters: q ? { email: { $ilike: `%${q.replace(/[%_\\]/g, "\\$&")}%` } } : {},
    pagination: { take: limit, skip: offset, order: { email: "ASC" } },
  })
  const users = await Promise.all(data.map(async (user) => ({
    ...user,
    access: await getStaffAccess(req.scope, user.id),
  })))
  res.json({ users, count: metadata?.count ?? users.length, offset, limit })
}
