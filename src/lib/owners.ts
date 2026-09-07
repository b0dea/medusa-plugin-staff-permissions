import type { MedusaContainer } from "@medusajs/framework/types"
import { STAFF_ACCESS_MODULE } from "../modules/staff-access"
import type StaffAccessModuleService from "../modules/staff-access/service"

export function isStaffOwner(container: MedusaContainer, userId: string): boolean {
  const service = container.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
  return service.isOwner(userId)
}
