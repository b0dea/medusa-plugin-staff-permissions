import { writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createUsersWorkflow } from "@medusajs/medusa/core-flows"

export default async function bootstrapOwner({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const configured = process.env.STAFF_OWNER_USER_IDS?.split(",")[0]?.trim()
  if (configured) {
    const { data: users } = await query.graph({
      entity: "user",
      fields: ["id"],
      filters: { id: configured },
    })
    if (!users.some((user) => user.id === configured)) {
      throw new Error(`STAFF_OWNER_USER_IDS=${configured} does not match an existing user`)
    }
    writeFileSync("staff-owner-id", configured)
    return
  }
  const { result: users } = await createUsersWorkflow(container).run({
    input: {
      users: [{ email: `staff-lab-owner-${randomUUID()}@example.invalid` }],
    },
  })
  writeFileSync("staff-owner-id", users[0].id)
}
