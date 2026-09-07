import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { assertStaffAdministrator } from "../lib/access"
import { PERMISSION_IDS } from "../lib/policy"
import { STAFF_ACCESS_MODULE } from "../modules/staff-access"
import type StaffAccessModuleService from "../modules/staff-access/service"
import type { UpdateStaffAccessInput } from "../modules/staff-access/types"

export type { UpdateStaffAccessInput } from "../modules/staff-access/types"

export const updateStaffAccessStep = createStep(
  "update-staff-access",
  async (input: UpdateStaffAccessInput, { container }) => {
    await assertStaffAdministrator(container, input.actor_id)
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 0 ||
      typeof input.administrator !== "boolean" || typeof input.disabled !== "boolean" ||
      !Array.isArray(input.permissions) || input.permissions.some((permission) => !PERMISSION_IDS.includes(permission))) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid staff access settings.")
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: users } = await query.graph({
      entity: "user",
      fields: ["id"],
      filters: { id: input.user_id },
    }, { throwIfKeyNotFound: true })
    if (!users.some((user) => user.id === input.user_id)) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Staff account not found.")
    }
    const service = container.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE)
    const access = await service.saveStaffAccess(input)
    return new StepResponse(access)
  },
)

export const updateStaffAccessWorkflow = createWorkflow(
  "update-staff-access",
  function (input: UpdateStaffAccessInput) {
    const access = updateStaffAccessStep(input)
    return new WorkflowResponse(access)
  },
)
