export type StaffAccessSnapshot = {
  user_id: string
  administrator: boolean
  disabled: boolean
  permissions: string[]
  version: number
}

export type UpdateStaffAccessInput = {
  actor_id: string
  user_id: string
  expected_version: number
  administrator: boolean
  disabled: boolean
  permissions: string[]
}

export function decodeStaffPermissions(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const grants = (value as Record<string, unknown>).grants
  if (!Array.isArray(grants) || grants.some((grant) => typeof grant !== "string")) return []
  return [...grants]
}
