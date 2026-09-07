import { MedusaError } from "@medusajs/framework/utils"
import { PERMISSION_IDS } from "../policy"
import type { Inventory } from "./merge"

const ROUTE_METHODS = new Set(["GET", "POST", "DELETE"])
const PERMISSION_VALUES = new Set([...PERMISSION_IDS, "upload", "reference"])

function invalidData(message: string): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function validateInventory(value: unknown): Inventory {
  if (!isPlainObject(value)) {
    invalidData("routes must be an object")
  }
  const routes: Inventory = {}
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
