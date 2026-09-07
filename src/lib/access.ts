import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { STAFF_ACCESS_MODULE } from "../modules/staff-access"
import type StaffAccessModuleService from "../modules/staff-access/service"
import type { StaffAccessSnapshot } from "../modules/staff-access/types"
import { decodeStaffPermissions } from "../modules/staff-access/types"

export type EffectiveStaffAccess = StaffAccessSnapshot & { owner: boolean }

export async function getStaffAccess(
  container: MedusaContainer,
  userId: string,
): Promise<EffectiveStaffAccess> {
  if (typeof userId !== "string" || !userId) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "A staff account is required.")
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id"],
    filters: { id: userId },
  })
  if (!users.some((user) => user.id === userId)) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "This staff account is no longer active.")
  }
  const service = container.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
  if (service.isOwner(userId)) {
    return { user_id: userId, owner: true, administrator: true, disabled: false, permissions: [], version: 0 }
  }
  const [access] = await service.listStaffAccesses({ user_id: userId }, { take: 1 })
  return {
    user_id: userId,
    owner: false,
    administrator: access?.administrator === true && !access.disabled,
    disabled: access?.disabled ?? false,
    permissions: access?.disabled ? [] : decodeStaffPermissions(access?.permissions),
    version: access?.version ?? 0,
  }
}

export async function assertStaffAdministrator(container: MedusaContainer, actorId: string) {
  const access = await getStaffAccess(container, actorId)
  if (!access.administrator || access.disabled) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "Administrator access is required.")
  }
  return access
}
