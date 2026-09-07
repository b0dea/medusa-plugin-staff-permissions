import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertStaffAdministrator } from "../../../../../lib/access"
import { STAFF_ACCESS_MODULE } from "../../../../../modules/staff-access"
import type StaffAccessModuleService from "../../../../../modules/staff-access/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await assertStaffAdministrator(req.scope, req.auth_context.actor_id)
  const service = req.scope.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
  const [events, count] = await service.listAndCountStaffAccessAudits(
    { target_user_id: req.params.id },
    { take: 20, order: { created_at: "DESC" } },
  )
  res.json({ events, count })
}
