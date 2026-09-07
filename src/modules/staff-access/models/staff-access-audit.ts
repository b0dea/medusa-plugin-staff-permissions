import { model } from "@medusajs/framework/utils"

const StaffAccessAudit = model.define("staff_access_audit", {
  id: model.id({ prefix: "staudit" }).primaryKey(),
  actor_id: model.text(),
  target_user_id: model.text(),
  before: model.json().nullable(),
  after: model.json(),
}).indexes([
  { on: ["target_user_id", "created_at"] },
])

export default StaffAccessAudit
