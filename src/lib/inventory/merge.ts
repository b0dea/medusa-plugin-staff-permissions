export type Inventory = Record<string, Record<string, string>>

export const PACKAGE_ROUTES: Inventory = {
  "/admin/staff-access": {},
  "/admin/staff-access/[id]": {},
  "/admin/staff-access/[id]/audit": {},
  "/admin/staff-access/me": {},
}

export function mergeInventory(core: Inventory, host: Inventory): Inventory {
  return { ...core, ...host }
}
