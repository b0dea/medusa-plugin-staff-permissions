import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertStaffAdministrator, getStaffAccess } from "../../../../lib/access"
import { updateStaffAccessWorkflow } from "../../../../workflows/update-staff-access"
import type { UpdateStaffAccessBody } from "../validators"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await assertStaffAdministrator(req.scope, req.auth_context.actor_id)
  res.json({ access: await getStaffAccess(req.scope, req.params.id) })
}

export async function POST(req: AuthenticatedMedusaRequest<UpdateStaffAccessBody>, res: MedusaResponse) {
  const { result } = await updateStaffAccessWorkflow(req.scope).run({
    input: { ...req.validatedBody, actor_id: req.auth_context.actor_id, user_id: req.params.id },
  })
  res.json({ access: { ...result, owner: false } })
}
