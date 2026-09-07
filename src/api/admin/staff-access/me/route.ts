import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getStaffAccess } from "../../../../lib/access"
import { PERMISSION_CATALOGUE } from "../../../../lib/policy"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ access: await getStaffAccess(req.scope, req.auth_context.actor_id), catalogue: PERMISSION_CATALOGUE })
}
