import { z } from "@medusajs/framework/zod"
import { PERMISSION_IDS } from "../../../lib/policy"

export const UpdateStaffAccessSchema = z.object({
  administrator: z.boolean(),
  disabled: z.boolean(),
  permissions: z.array(z.string().refine((permission) => PERMISSION_IDS.includes(permission))).max(PERMISSION_IDS.length),
  expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()
export type UpdateStaffAccessBody = z.infer<typeof UpdateStaffAccessSchema>

export const ListStaffAccessSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().max(100).optional(),
}).strict()
export type ListStaffAccessQuery = z.infer<typeof ListStaffAccessSchema>
