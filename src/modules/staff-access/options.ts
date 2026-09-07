import { MedusaError } from "@medusajs/framework/utils"
import { PERMISSION_CATALOGUE, PERMISSION_IDS } from "../../lib/policy"

export type StaffPermissionsOptions = {
  owner_user_ids?: string[]
  routes?: Record<string, Record<string, string> | Record<string, never>>
  relations?: Record<string, string>
  fields?: string[]
}

export type ResolvedStaffPermissionsOptions = {
  owner_user_ids: string[]
  routes: Record<string, Record<string, string>>
  relations: Record<string, string>
  fields: string[]
}

const ROUTE_METHODS = new Set(["GET", "POST", "DELETE"])
const PERMISSION_VALUES = new Set([...PERMISSION_IDS, "upload", "reference"])
const RELATION_VALUES = new Set<string>([
  ...PERMISSION_CATALOGUE.map((group) => group.id),
  "reference",
  "context",
])
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/

function invalidData(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function resolveOwnerUserIds(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): string[] {
  const option = raw.owner_user_ids
  if (option == null) {
    return (env.STAFF_OWNER_USER_IDS ?? "")
      .split(",")
      .map((ownerId) => ownerId.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(option) || option.some((ownerId) => typeof ownerId !== "string" || ownerId.length === 0)) {
    invalidData("owner_user_ids must be an array of non-empty strings")
  }
  return option as string[]
}

function resolveRoutes(value: unknown): Record<string, Record<string, string>> {
  if (value == null) {
    return {}
  }
  if (!isPlainObject(value)) {
    invalidData("routes must be an object")
  }
  const routes: Record<string, Record<string, string>> = {}
  for (const [path, methods] of Object.entries(value)) {
    if (!path.startsWith("/admin/")) {
      invalidData(`routes key "${path}" must start with /admin/`)
    }
    if (!isPlainObject(methods)) {
      invalidData(`routes["${path}"] must be an object`)
    }
    const resolved: Record<string, string> = {}
    for (const [method, permission] of Object.entries(methods)) {
      if (!ROUTE_METHODS.has(method)) {
        invalidData(`routes["${path}"] has unsupported method "${method}"`)
      }
      if (typeof permission !== "string" || !PERMISSION_VALUES.has(permission)) {
        invalidData(`routes["${path}"]["${method}"] value "${String(permission)}" is not a known permission id, "upload", or "reference"`)
      }
      resolved[method] = permission
    }
    routes[path] = resolved
  }
  return routes
}

function resolveRelations(value: unknown): Record<string, string> {
  if (value == null) {
    return {}
  }
  if (!isPlainObject(value)) {
    invalidData("relations must be an object")
  }
  const relations: Record<string, string> = {}
  for (const [name, group] of Object.entries(value)) {
    if (typeof group !== "string" || !RELATION_VALUES.has(group)) {
      invalidData(`relations["${name}"] value "${String(group)}" is not a known group id, "reference", or "context"`)
    }
    relations[name] = group
  }
  return relations
}

function resolveFields(value: unknown): string[] {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value) || value.some((field) => typeof field !== "string" || !FIELD_NAME.test(field))) {
    const invalid = Array.isArray(value)
      ? value.find((field) => typeof field !== "string" || !FIELD_NAME.test(field))
      : value
    invalidData(`fields value "${String(invalid)}" is invalid`)
  }
  return [...value]
}

export function resolveOptions(raw: unknown, env: NodeJS.ProcessEnv): ResolvedStaffPermissionsOptions {
  if (raw == null) {
    raw = {}
  }
  if (!isPlainObject(raw)) {
    invalidData("plugin options must be an object")
  }
  return {
    owner_user_ids: resolveOwnerUserIds(raw, env),
    routes: resolveRoutes(raw.routes),
    relations: resolveRelations(raw.relations),
    fields: resolveFields(raw.fields),
  }
}
