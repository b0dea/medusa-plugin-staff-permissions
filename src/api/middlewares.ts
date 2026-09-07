import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { enforceStaffAccess } from "../lib/middleware"
import { ListStaffAccessSchema, UpdateStaffAccessSchema } from "./admin/staff-access/validators"
export default defineMiddlewares({
  routes: [
    { matcher: "/admin", middlewares: [enforceStaffAccess] },
    { matcher: "/admin/staff-access", method: "GET", middlewares: [validateAndTransformQuery(ListStaffAccessSchema, {})] },
    { matcher: "/admin/staff-access/:id", method: "POST", middlewares: [validateAndTransformBody(UpdateStaffAccessSchema)] },
  ],
})
