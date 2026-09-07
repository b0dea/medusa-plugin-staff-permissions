# @hollowpoint-io/medusa-plugin-staff-permissions

Server-enforced staff permissions for Medusa v2 — eight business areas, View/Manage grants, immutable recovery owners, atomic audit trail, fail-closed route inventory.

## Install

```bash
npm install @hollowpoint-io/medusa-plugin-staff-permissions
```

```ts
// medusa-config.ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@hollowpoint-io/medusa-plugin-staff-permissions",
      options: {
        // Exact existing Medusa user ids. Immutable recovery owners.
        // Optional if STAFF_OWNER_USER_IDS is set. Option wins.
        owner_user_ids: ["user_01J..."],
        // Host extension routes. Same shape as the core inventory.
        // Overrides core entries with the same path. `{}` = administrator-only.
        routes: {
          "/admin/merchant-redirects/preview": { POST: "content.manage" },
          "/admin/meilisearch/sync": {},
        },
        // Extra ?fields= relation names, mapped to a group, "reference", or "context".
        relations: { product_family: "catalog", faqs: "content" },
        // Extra scalar field names allowed in ?fields=.
        fields: ["flavour_label"],
      },
    },
  ],
})
```

Then run migrations:

```bash
npx medusa db:migrate
```

Built and tested against Medusa `>=2.17 <3`. The core route inventory is pinned to Medusa 2.19.

## Activation and recovery

1. Keep Admin access limited to trusted operators during rollout. Identify at least one existing owner by exact Medusa user ID. Do not guess from an email or make every existing staff member an administrator.
2. Set runtime `STAFF_OWNER_USER_IDS` to those comma-separated IDs on every backend server/worker. This is configuration, not a user-editable field. Owners must exist in the User module. Missing configuration does not enable a fallback administrator. `options.owner_user_ids` wins over `STAFF_OWNER_USER_IDS` when both are set (the env var name is unchanged so Cloud deployments keep working).
3. Deploy the plugin and additive migration with the middleware. On a fresh Medusa project, create the initial Medusa user using the normal CLI, obtain its ID, and set the runtime owner configuration before inviting staff.
4. Verify the owner can open `/app/staff-permissions`. Assign each approved staff account its permissions. In a second browser session, prove an allowed action succeeds and a prohibited action returns 403. Verify owner editing/deletion fails and another owner's login works if configured.
5. For recovery, a trusted deployment operator changes the runtime owner IDs to another verified existing account and restarts all backend instances. Do not remove the last usable recovery owner before verifying its replacement.

User metadata and JWT claims never grant permissions. Secret API keys are rejected by this staff gate; existing integrations using Admin secret keys must be inventoried before activation and given a separately reviewed integration access design. Storefront publishable keys and vendor callbacks outside `/admin` are unaffected.

## Permission model

Open **Staff permissions** in Admin, select a user, then **Edit permissions**. View grants access to the whole record; Manage includes creating, editing, deleting and bulk operations. Manage implies View. Fulfilment also needs Orders → View. Orders → Manage includes refunds, captures, cancellations and returns. Administrator grants full Admin access, including staff management; assign it sparingly.

New and invited accounts have no business access until an administrator assigns permissions. Invite through Settings → Users, let the user accept, then assign their access. A disabled account cannot use Admin APIs even with a previously valid session. Permission changes are checked on each request; requests already running may complete.

Saving records an audit entry in the same database transaction. Conflicting edits return 409 and require reloading. You cannot change your own access or edit a protected owner.

| Group | Id | View (`*.read`) | Manage (`*.manage`) |
|---|---|---|---|
| Catalogue | `catalog` | Products, variants, prices, categories, collections and product specifications | Bulk changes and deletion |
| Inventory | `inventory` | Stock levels, reservations and locations | Change available stock |
| Orders and payments | `orders` | Customer addresses and payment history | Refunds, captures, cancellations, returns and order edits |
| Fulfilment | `fulfillment` | — (manage only) | Packing, shipments and fulfilment cancellation. Also needs Orders → View |
| Customers | `customers` | Customer profiles, contact details and groups | Deletion. Privacy exports and age-verification overrides require an administrator |
| Content and media | `content` | Pages, blogs, navigation, images and redirects | Publishing and deletion |
| Promotions | `marketing` | Discounts, campaigns and merchandising offers | Bulk changes and deletion |
| Reports | `reports` | Sales reports, costs, exports and personal saved definitions | Team report definitions, report configuration and cost imports |

Permission ids are `<group>.read` and `<group>.manage`. Fulfilment exposes `fulfillment.manage` only.

**Administrator** grants full Admin access, including staff management and unmapped routes. It is not a recovery owner.

**Owner** is a recovery identity from configuration (`options.owner_user_ids` / `STAFF_OWNER_USER_IDS`), not a grant you can tick in Admin. Owners must exist in the User module. They can manage staff and run `/admin/workflows-executions*`. Nobody — including other administrators and owners — may edit or delete an owner's user record.

## How enforcement works

Medusa registers global middlewares core → plugins → app, so this plugin's `/admin` gate runs **after** core admin authentication and **before** any host global middleware. Hosts must not add another `/admin` global middleware that answers requests before this one unless they intend to bypass the gate.

Documented at https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares#how-are-middlewares-ordered-and-applied.

The gate fails closed. Unknown routes are denied to everyone except administrators. An inventory entry of `{}` is administrator-only. Unauthenticated requests and non-`user` actors — including Admin secret API keys — are rejected. Disabled accounts are denied even with a previously valid session or an administrator flag. `Cache-Control: no-store` is set on gated responses. The database is authoritative on every request; there is no permission cache. User metadata and JWT claims never grant permissions. The native sidebar remains visible; attempting an unauthorized action returns 403, including direct API requests.

Reserved static entries take precedence over ID patterns. `[id]` and `*_id]` segments match Medusa-generated IDs with prefixes and underscores (`^[a-z][a-z0-9]*_[a-z0-9_-]+$`); other bracket segments match one path segment. Custom IDs outside that format need an explicit reviewed rule. `HEAD` is evaluated as `GET`. `PUT` / `PATCH` never match.

Bootstrap allowances (always):

- `POST /admin/invites/accept`
- `GET /admin/feature-flags` with no query
- `GET /admin/users/me`, `GET /admin/plugins`, `GET /admin/staff-access/me` without `?fields=`
- `GET /admin/stores` is answered by the middleware for non-administrators with a fixed projection (`id`, `name`, `supported_currencies.*`, `default_sales_channel_id`, `default_region_id`, `default_location_id`) and no store metadata

Other specials: `"upload"` requires `catalog.manage` or `content.manage`; `"reference"` requires any `*.read` / `*.manage` grant; `fulfillment.*` additionally requires `orders.read`; `/admin/workflows-executions*` requires an owner (not merely administrator); non-GET on `/admin/users/:id` where `:id` is an owner is denied to everyone.

## Extending the inventory

The package ships a core inventory of native Medusa 2.19 admin routes. Host extension routes, extra relations, and extra scalar fields are supplied via plugin options. New endpoints never inherit grants — add a plugin or a host `src/api/admin` route and the gate denies it until you map it.

- `options.routes` — path template → method map (`GET` / `POST` / `DELETE` → a known permission id, `"upload"`, or `"reference"`). `{}` is administrator-only. Host keys override core keys wholesale. Keys must start with `/admin/`.
- `options.relations` — extra `?fields=` relation names mapped to a group id, `"reference"` (any read grant), or `"context"` (always allowed). Unknown relations and fields are denied.
- `options.fields` — extra scalar field names allowed in `?fields=` (`^[a-z_][a-z0-9_]*$`).

Prove coverage from the host app root with the CLI (does not load `medusa-config`):

```bash
npx staff-permissions-check --routes staff-routes.json
```

`staff-routes.json` is the same shape as `options.routes`. `--config-json '{...}'` is the inline equivalent. `--list` prints the merged inventory. The checker walks host `src/api/admin`, `@medusajs/medusa` core admin routes, and every dependency whose name contains `medusa-plugin`. Missing templates are printed and the process exits 1.

Add to CI: `npx staff-permissions-check --routes staff-routes.json`

## Upgrading Medusa

The core inventory is pinned per Medusa minor (`src/lib/inventory/core-2.19.json` for the 2.19 pin this package was audited against). After bumping `@medusajs/medusa`:

```bash
npm run inventory:diff
```

That XOR-compares walker paths under `node_modules/@medusajs/medusa/dist/api/admin` with the pinned JSON keys. Empty output and exit 0 means the pin still matches. When it drifts:

1. Run `npm run inventory:list` and compare with the current JSON.
2. Add new core templates with an explicit method → permission map. New endpoints never inherit grants — default them to `{}` (administrator-only) until reviewed.
3. Remove JSON keys that no longer exist in core.
4. Re-run `npm run inventory:diff` until it is clean, then ship the updated pin. Hosts must keep `staff-permissions-check` in CI so their own extension routes stay covered.

Host-only routes stay in `options.routes`; do not add them to the core JSON.

## What it is not

- **Not row-level access.** A View grant covers the whole record of that business area, not a subset of customers, orders or products.
- **Not field-level confidentiality.** This does not hide prices or other fields inside a permitted record. Related-data selection is a reviewed allowlist, not a redaction layer. Do not place secrets in record metadata.
- **Not a roles editor.** Grants are per user (View/Manage per area, plus administrator). There is no named-role catalogue you edit separately from the user.
- **Not Medusa Enterprise RBAC.** This plugin does not enable, import or wrap Medusa Enterprise RBAC.

## Rollback

Prefer fixing grants or rolling forward. Reverting to a pre-plugin build restores unrestricted staff access: block staff access at the gateway before any such rollback and verify the block first. Keep the additive tables (`staff_access`, `staff_access_audit`) and audit history; do not run a down migration as an access recovery procedure.

## Provenance

Independent implementation on Medusa's public framework. The [RSC Labs RBAC](https://github.com/RSC-Labs/medusa-rbac-public) reference is commercial documentation; its code is not incorporated. Medusa's [native Enterprise RBAC](https://github.com/medusajs/medusa/blob/v2.19.0/ENTERPRISE-LICENSE.md) is neither enabled nor imported.

## Licence

MIT. See [LICENSE](./LICENSE).
