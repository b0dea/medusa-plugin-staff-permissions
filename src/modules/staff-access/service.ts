import type { Context } from "@medusajs/framework/types"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import StaffAccess from "./models/staff-access"
import StaffAccessAudit from "./models/staff-access-audit"
import { createPolicy, type StaffPolicy } from "../../lib/policy"
import { resolveOptions } from "./options"
import type { ResolvedStaffPermissionsOptions, StaffPermissionsOptions } from "./options"
import type { StaffAccessSnapshot, UpdateStaffAccessInput } from "./types"
import { decodeStaffPermissions } from "./types"

class StaffAccessModuleService extends MedusaService({ StaffAccess, StaffAccessAudit }) {
  protected options_: ResolvedStaffPermissionsOptions
  protected policy_?: StaffPolicy

  constructor(container: Record<string, unknown>, options?: StaffPermissionsOptions) {
    super(...arguments)
    this.options_ = resolveOptions(options, process.env)
  }

  /* eslint-disable @medusajs/service-methods-must-be-async -- sync accessors, not I/O */
  getOptions(): ResolvedStaffPermissionsOptions {
    return this.options_
  }

  isOwner(userId: string): boolean {
    return !!userId && this.options_.owner_user_ids.includes(userId)
  }

  getPolicy(): StaffPolicy {
    return this.policy_ ??= createPolicy(this.options_)
  }
  /* eslint-enable @medusajs/service-methods-must-be-async */

  @InjectManager()
  async saveStaffAccess(
    input: UpdateStaffAccessInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<StaffAccessSnapshot> {
    return this.saveStaffAccess_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async saveStaffAccess_(
    input: UpdateStaffAccessInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<StaffAccessSnapshot> {
    const manager = sharedContext.transactionManager as {
      execute: (sql: string, parameters: unknown[]) => Promise<unknown>
    }
    await manager.execute("select pg_advisory_xact_lock(?, ?)", [1937006963, 1])

    if (input.actor_id === input.user_id || this.isOwner(input.user_id)) {
      throw new MedusaError(MedusaError.Types.FORBIDDEN, "You cannot change your own access or a recovery owner's access.")
    }

    if (!this.isOwner(input.actor_id)) {
      const [actor] = await this.listStaffAccesses(
        { user_id: input.actor_id },
        { take: 1 },
        sharedContext,
      )
      if (!actor?.administrator || actor.disabled) {
        throw new MedusaError(MedusaError.Types.FORBIDDEN, "Administrator access is required.")
      }
    }

    const [previous] = await this.listStaffAccesses(
      { user_id: input.user_id },
      { take: 1 },
      sharedContext,
    )
    if ((previous?.version ?? 0) !== input.expected_version) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Staff access changed. Reload before saving again.")
    }

    const before: StaffAccessSnapshot | null = previous ? {
      user_id: previous.user_id,
      administrator: previous.administrator,
      disabled: previous.disabled,
      permissions: decodeStaffPermissions(previous.permissions),
      version: previous.version,
    } : null
    const after: StaffAccessSnapshot = {
      user_id: input.user_id,
      administrator: input.administrator,
      disabled: input.disabled,
      permissions: [...new Set(input.permissions)].sort(),
      version: input.expected_version + 1,
    }
    if (previous) {
      await this.updateStaffAccesses({ id: previous.id, ...after, permissions: { grants: after.permissions } }, sharedContext)
    } else {
      await this.createStaffAccesses({ ...after, permissions: { grants: after.permissions } }, sharedContext)
    }
    await this.createStaffAccessAudits({
      actor_id: input.actor_id,
      target_user_id: input.user_id,
      before,
      after,
    }, sharedContext)
    return after
  }
}

export default StaffAccessModuleService
