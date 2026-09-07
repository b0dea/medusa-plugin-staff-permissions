import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Users } from "@medusajs/icons"
import { Button, Checkbox, Container, Drawer, Heading, Input, Label, Table, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../lib/sdk"

type Access = {
  user_id: string
  owner: boolean
  administrator: boolean
  disabled: boolean
  permissions: string[]
  version: number
}

type PermissionGroup = {
  id: string
  label: string
  description: string
  permissions: { id: string; label: string }[]
}

type StaffUser = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  access: Access
}

type StaffResponse = { users: StaffUser[]; count: number; offset: number; limit: number }
type AuditEvent = { id: string; actor_id: string; created_at: string; before: Access | null; after: Access }

const pageSize = 20

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again."
}

function accessLabel(access: Access) {
  if (access.disabled) return "Disabled"
  if (access.owner) return "Owner"
  if (access.administrator) return "Administrator"
  return access.permissions.length ? `${access.permissions.length} permissions` : "No access assigned"
}

function accessMatches(first: Access, second: Access) {
  return first.administrator === second.administrator && first.disabled === second.disabled &&
    [...first.permissions].sort().join(",") === [...second.permissions].sort().join(",")
}

function describeChanges(event: AuditEvent, catalogue: PermissionGroup[]) {
  const labels = new Map(catalogue.flatMap((group) =>
    group.permissions.map((permission) => [permission.id, `${group.label}: ${permission.label}`] as const)))
  const previous = event.before?.permissions || []
  const current = event.after.permissions
  const changes: string[] = []
  if (Boolean(event.before?.administrator) !== event.after.administrator) {
    changes.push(event.after.administrator ? "Administrator access granted" : "Administrator access removed")
  }
  if (Boolean(event.before?.disabled) !== event.after.disabled) {
    changes.push(event.after.disabled ? "Account disabled" : "Account reactivated")
  }
  const added = current.filter((permission) => !previous.includes(permission))
  const removed = previous.filter((permission) => !current.includes(permission))
  if (added.length) changes.push(`Granted: ${added.map((permission) => labels.get(permission) || permission).join(", ")}`)
  if (removed.length) changes.push(`Removed: ${removed.map((permission) => labels.get(permission) || permission).join(", ")}`)
  return changes.join(". ") || "Access record created"
}

function PermissionGroups({ catalogue, access, onChange, disabled = false }: {
  catalogue: PermissionGroup[]
  access: Access
  onChange?: (permissions: string[]) => void
  disabled?: boolean
}) {
  return <div className="flex flex-col gap-6">
    {catalogue.map((group) => <div key={group.id} className="flex flex-col gap-3">
      <div>
        <Text size="small" weight="plus">{group.label}</Text>
        <Text size="small" className="text-ui-fg-subtle">{group.description}</Text>
      </div>
      {group.permissions.map((permission) => <div key={permission.id} className="flex items-center gap-2">
        <Checkbox
          id={`permission-${permission.id}`}
          aria-label={`${group.label}: ${permission.label}`}
          checked={access.administrator || access.owner || access.permissions.includes(permission.id) ||
            (permission.id === `${group.id}.read` && access.permissions.includes(`${group.id}.manage`))}
          disabled={disabled || !onChange || access.administrator || access.disabled ||
            (permission.id === `${group.id}.read` && access.permissions.includes(`${group.id}.manage`))}
          onCheckedChange={(checked) => {
            const permissions = new Set(access.permissions)
            if (checked === true) permissions.add(permission.id)
            else permissions.delete(permission.id)
            if (permission.id === `${group.id}.manage` && group.permissions.some((item) => item.id === `${group.id}.read`)) permissions.add(`${group.id}.read`)
            onChange?.([...permissions])
          }}
        />
        <Label htmlFor={`permission-${permission.id}`}>{permission.label}</Label>
      </div>)}
    </div>)}
  </div>
}

function AccessEditor({ user, catalogue, onClose }: {
  user: StaffUser
  catalogue: PermissionGroup[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [baseline, setBaseline] = useState(user.access)
  const [draft, setDraft] = useState(user.access)
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const dirty = !accessMatches(baseline, draft)
  const audit = useQuery({
    queryKey: ["staff-access", "audit", user.id],
    queryFn: () => sdk.client.fetch<{ events: AuditEvent[]; count: number }>(`/admin/staff-access/${user.id}/audit`),
  })
  const mutation = useMutation({
    mutationFn: () => sdk.client.fetch<{ access: Access }>(`/admin/staff-access/${user.id}`, {
      method: "POST",
      body: {
        administrator: draft.administrator,
        disabled: draft.disabled,
        permissions: draft.permissions,
        expected_version: baseline.version,
      },
    }),
    onSuccess: async ({ access }) => {
      queryClient.setQueriesData<StaffResponse>({ queryKey: ["staff-access", "users"] }, (current) => current && ({
        ...current,
        users: current.users.map((staffUser) => staffUser.id === user.id ? { ...staffUser, access } : staffUser),
      }))
      await queryClient.invalidateQueries({ queryKey: ["staff-access"] })
      toast.success("Staff permissions saved")
      onClose()
    },
  })
  const conflict = (mutation.error as { status?: number } | null)?.status === 409
  const pending = mutation.isPending || reloading

  useEffect(() => {
    if (!dirty && !pending) return
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", preventUnload)
    return () => window.removeEventListener("beforeunload", preventUnload)
  }, [dirty, pending])

  function close() {
    if (pending) return
    if (!dirty || window.confirm("Discard your unsaved permission changes?")) onClose()
  }

  async function reload() {
    if (dirty && !window.confirm("Discard your changes and load this account’s latest permissions?")) return
    setReloading(true)
    setReloadError(null)
    try {
      const latest = await sdk.client.fetch<{ access: Access }>(`/admin/staff-access/${user.id}`)
      setBaseline(latest.access)
      setDraft(latest.access)
      mutation.reset()
      void queryClient.invalidateQueries({ queryKey: ["staff-access"] })
    } catch (error) {
      setReloadError(errorMessage(error))
    } finally {
      setReloading(false)
    }
  }

  return <Drawer open onOpenChange={(open) => { if (!open) close() }}>
    <Drawer.Content>
      <Drawer.Header>
        <Drawer.Title>Edit staff permissions</Drawer.Title>
        <Drawer.Description>{user.email}</Drawer.Description>
      </Drawer.Header>
      <Drawer.Body className="flex flex-1 flex-col gap-6 overflow-auto px-6 py-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="staff-administrator" checked={draft.administrator} disabled={pending}
              onCheckedChange={(checked) => setDraft({ ...draft, administrator: checked === true })} />
            <Label htmlFor="staff-administrator">Full administrator</Label>
          </div>
          <Text size="small" className="text-ui-fg-subtle">Grants every permission, including managing staff, security settings and future features. Only assign to trusted administrators.</Text>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="staff-disabled" checked={draft.disabled} disabled={pending}
              onCheckedChange={(checked) => setDraft({ ...draft, disabled: checked === true })} />
            <Label htmlFor="staff-disabled">Disable account</Label>
          </div>
          <Text size="small" className="text-ui-fg-subtle">Blocks access immediately, including existing sessions. Saved permissions are retained for reactivation.</Text>
        </div>
        <Text size="small" className="text-ui-fg-subtle">Select only the permissions this person needs. Unchecked permissions are denied. Changes take effect when saved.</Text>
        <PermissionGroups catalogue={catalogue} access={draft} disabled={pending}
          onChange={(permissions) => setDraft({ ...draft, permissions })} />
        {mutation.isError && <div role="alert" className="flex flex-col gap-2">
          <Text size="small" className="text-ui-fg-error">{conflict
            ? "This account changed since you opened it. Reload the latest permissions, review your changes and save again."
            : errorMessage(mutation.error)}</Text>
          {conflict && <Button size="small" variant="secondary" disabled={pending} isLoading={reloading} onClick={reload}>Reload latest permissions</Button>}
        </div>}
        {reloadError && <Text size="small" role="alert" className="text-ui-fg-error">{reloadError}</Text>}
        <div className="flex flex-col gap-3 border-t border-ui-border-base pt-4">
          <Text size="small" weight="plus">Recent permission changes</Text>
          {audit.isPending && <Text size="small" role="status">Loading history…</Text>}
          {audit.isError && <div role="alert">
            <Text size="small" className="text-ui-fg-error">Could not load history. {errorMessage(audit.error)}</Text>
            <Button size="small" variant="secondary" disabled={audit.isFetching} onClick={() => void audit.refetch()}>Retry history</Button>
          </div>}
          {audit.data?.events.length === 0 && <Text size="small" className="text-ui-fg-subtle">No permission changes recorded.</Text>}
          {audit.data?.events.map((event) => <div key={event.id}>
            <Text size="small">{new Date(event.created_at).toLocaleString()} · {accessLabel(event.after)}</Text>
            <Text size="small">{describeChanges(event, catalogue)}</Text>
            <Text size="small" className="text-ui-fg-subtle">Changed by {event.actor_id}</Text>
          </div>)}
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button size="small" variant="secondary" disabled={pending} onClick={close}>Cancel</Button>
        <Button size="small" disabled={pending || !dirty || conflict} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>Save permissions</Button>
      </Drawer.Footer>
    </Drawer.Content>
  </Drawer>
}

function StaffList({ viewer, catalogue }: { viewer: Access; catalogue: PermissionGroup[] }) {
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null)
  useEffect(() => {
    const timeout = window.setTimeout(() => { setQuery(search.trim()); setOffset(0) }, 300)
    return () => window.clearTimeout(timeout)
  }, [search])
  const staff = useQuery({
    queryKey: ["staff-access", "users", offset, query],
    queryFn: () => sdk.client.fetch<StaffResponse>("/admin/staff-access", { query: { offset, limit: pageSize, q: query } }),
  })

  return <>
    <div className="flex flex-col gap-3 px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">Invite staff in user settings. After they accept, assign their permissions here. New accounts start with no access.</Text>
      <Button size="small" variant="secondary" asChild><Link to="/settings/users">Invite staff</Link></Button>
      <Label htmlFor="staff-search">Search staff</Label>
      <Input id="staff-search" placeholder="Search by email" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {staff.isPending && <Text className="px-6 py-4" role="status">Loading staff…</Text>}
    {staff.isError && <div className="flex flex-col gap-2 px-6 py-4" role="alert">
      <Text className="text-ui-fg-error">Could not load staff. {errorMessage(staff.error)}</Text>
      <Button size="small" variant="secondary" disabled={staff.isFetching} onClick={() => void staff.refetch()}>Retry</Button>
    </div>}
    {staff.isSuccess && <>
      <div className="overflow-x-auto" role="region" aria-label="Staff accounts" tabIndex={0}>
        <Table className="min-w-[640px]">
          <Table.Header><Table.Row><Table.HeaderCell>Staff member</Table.HeaderCell><Table.HeaderCell>Access</Table.HeaderCell><Table.HeaderCell>Actions</Table.HeaderCell></Table.Row></Table.Header>
          <Table.Body>
            {staff.data.users.map((user) => <Table.Row key={user.id}>
              <Table.Cell className="max-w-[240px]"><Text size="small" weight="plus" className="truncate" title={user.email}>{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}</Text>{(user.first_name || user.last_name) && <Text size="small" className="truncate text-ui-fg-subtle">{user.email}</Text>}</Table.Cell>
              <Table.Cell className="whitespace-nowrap">{accessLabel(user.access)}</Table.Cell>
              <Table.Cell>{user.access.owner ? <Text size="small" className="text-ui-fg-subtle">Protected owner</Text>
                : user.id === viewer.user_id ? <Text size="small" className="text-ui-fg-subtle">Your account</Text>
                  : <Button size="small" variant="secondary" onClick={() => setSelectedUser(user)} aria-label={`Edit permissions for ${user.email}`}>Edit permissions</Button>}</Table.Cell>
            </Table.Row>)}
          </Table.Body>
        </Table>
      </div>
      {!staff.data.users.length && <Text className="px-6 py-4">No staff found.</Text>}
      <div className="flex items-center justify-between gap-2 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">{staff.data.count} staff members · Page {Math.floor(offset / pageSize) + 1}</Text>
        <div className="flex gap-2">
          <Button size="small" variant="secondary" disabled={offset === 0 || staff.isFetching} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
          <Button size="small" variant="secondary" disabled={offset + pageSize >= staff.data.count || staff.isFetching} onClick={() => setOffset(offset + pageSize)}>Next</Button>
        </div>
      </div>
    </>}
    {selectedUser && <AccessEditor key={selectedUser.id} user={selectedUser} catalogue={catalogue} onClose={() => setSelectedUser(null)} />}
  </>
}

const StaffPermissionsPage = () => {
  const me = useQuery({
    queryKey: ["staff-access", "me"],
    queryFn: () => sdk.client.fetch<{ access: Access; catalogue: PermissionGroup[] }>("/admin/staff-access/me"),
  })
  return <Container className="divide-y p-0">
    <div className="px-6 py-4"><Heading level="h1">Staff permissions</Heading><Text size="small" className="text-ui-fg-subtle">Control who can view and change your store.</Text></div>
    {me.isPending && <Text className="px-6 py-4" role="status">Loading permissions…</Text>}
    {me.isError && <div className="flex flex-col gap-2 px-6 py-4" role="alert">
      <Text className="text-ui-fg-error">Could not load your permissions. {errorMessage(me.error)}</Text>
      <Button size="small" variant="secondary" disabled={me.isFetching} onClick={() => void me.refetch()}>Retry</Button>
    </div>}
    {me.isSuccess && (me.data.access.owner || me.data.access.administrator) && !me.data.access.disabled
      ? <StaffList viewer={me.data.access} catalogue={me.data.catalogue} />
      : me.isSuccess && <div className="flex flex-col gap-6 px-6 py-4">
        <Text size="small">Your account: {accessLabel(me.data.access)}. Contact your administrator to change your permissions.</Text>
        <PermissionGroups catalogue={me.data.catalogue} access={me.data.access} disabled />
      </div>}
  </Container>
}

export const config = defineRouteConfig({ label: "Staff permissions", icon: Users })
export default StaffPermissionsPage
