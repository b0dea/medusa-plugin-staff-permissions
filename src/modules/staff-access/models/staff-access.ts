import { model } from "@medusajs/framework/utils"

const StaffAccess = model.define("staff_access", {
  id: model.id({ prefix: "stacc" }).primaryKey(),
  user_id: model.text().unique(),
  administrator: model.boolean().default(false),
  disabled: model.boolean().default(false),
  permissions: model.json().default({ grants: [] }),
  version: model.number().default(1),
})

export default StaffAccess
