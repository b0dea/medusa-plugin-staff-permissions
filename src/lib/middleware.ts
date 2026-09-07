import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { STAFF_ACCESS_MODULE } from "../modules/staff-access"
import type StaffAccessModuleService from "../modules/staff-access/service"
import { getStaffAccess } from "./access"
import { hasStaffPermission, normalizeAdminPath } from "./policy"

export async function enforceStaffAccess(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const deny = () => { throw new MedusaError(MedusaError.Types.FORBIDDEN, "You do not have permission to perform this action. Ask an administrator to update your staff permissions.") }
  const path = normalizeAdminPath(req.originalUrl)
  if (!path) return deny()
  if (path === "/admin/invites/accept" && req.method === "POST") return next()
  if (path === "/admin/feature-flags" && ["GET", "HEAD"].includes(req.method) && Object.keys(req.query).length === 0) return next()
  const authentication = (req as AuthenticatedMedusaRequest).auth_context
  if (authentication?.actor_type !== "user" || !authentication.actor_id) return deny()
  const access = await getStaffAccess(req.scope, authentication.actor_id)
  res.setHeader("Cache-Control", "no-store")
  if (access.disabled) return deny()
  const service = req.scope.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
  const userRoute = req.originalUrl.split("?")[0].match(/^\/admin\/users\/([^/]+)\/?$/i)
  if (userRoute && !["GET", "HEAD"].includes(req.method) && service.isOwner(userRoute[1])) return deny()
  if (path.startsWith("/admin/workflows-executions") && !access.owner) return deny()
  if (access.administrator) return next()
  if (path === "/admin/stores" && ["GET", "HEAD"].includes(req.method)) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["id", "name", "supported_currencies.*", "default_sales_channel_id", "default_region_id", "default_location_id"],
      pagination: { take: 1 },
    })
    res.json({ stores, count: stores.length, offset: 0, limit: 1 })
    return
  }
  if (["GET", "HEAD"].includes(req.method) &&
    ["/admin/users/me", "/admin/plugins", "/admin/staff-access/me"].includes(path)) {
    if (req.query.fields !== undefined) return deny()
    return next()
  }
  const policy = service.getPolicy()
  const permission = policy.requiredStaffPermission(path, req.method)
  if (!permission) return deny()
  if (permission === "upload") {
    if (!hasStaffPermission(access, "catalog.manage") && !hasStaffPermission(access, "content.manage")) return deny()
    return next()
  }
  if (permission === "reference") {
    if (!access.permissions.some((grant) => /\.(read|manage)$/.test(grant))) return deny()
  } else if (!hasStaffPermission(access, permission)) return deny()
  if (permission.startsWith("fulfillment.") && !hasStaffPermission(access, "orders.read")) return deny()
  if (!policy.staffFieldsAllowed(req.query.fields, access, permission)) return deny()
  return next()
}
