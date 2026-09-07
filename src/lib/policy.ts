import coreInventory from "./inventory/core-2.19.json"
import { mergeInventory, PACKAGE_ROUTES, type Inventory } from "./inventory/merge"

const groups = [
  ["catalog", "Catalogue", "Products, variants, prices, categories, collections and product specifications. Manage includes bulk changes and deletion."],
  ["inventory", "Inventory", "Stock levels, reservations and locations. Manage can change available stock."],
  ["orders", "Orders and payments", "View includes customer addresses and payment history. Manage includes refunds, captures, cancellations, returns and order edits."],
  ["fulfillment", "Fulfilment", "Packing, shipments and fulfilment cancellation. View orders is also needed to open orders."],
  ["customers", "Customers", "Customer profiles, contact details and groups. Manage includes deletion. Privacy exports and age-verification overrides require an administrator."],
  ["content", "Content and media", "Pages, blogs, navigation, images and redirects. Manage includes publishing and deletion."],
  ["marketing", "Promotions", "Discounts, campaigns and merchandising offers. Manage includes bulk changes and deletion."],
  ["reports", "Reports", "Sales reports, costs, exports and personal saved definitions. Manage also creates, updates and deletes team report definitions, changes report configuration and imports costs."],
] as const

export const PERMISSION_CATALOGUE = groups.map(([id, label, description]) => ({
  id, label, description,
  permissions: [
    { id: `${id}.read`, label: "View" },
    { id: `${id}.manage`, label: "Manage" },
  ].filter((permission) => id !== "fulfillment" || permission.id.endsWith(".manage")),
}))
export const PERMISSION_IDS: string[] = PERMISSION_CATALOGUE.flatMap((group) => group.permissions.map((permission) => permission.id))

export type StaffPolicyAccess = { administrator: boolean; permissions: string[]; disabled: boolean }

export function hasStaffPermission(access: StaffPolicyAccess, permission: string): boolean {
  if (access.disabled) return false
  return access.administrator || access.permissions.includes(permission) ||
    (permission.endsWith(".read") && access.permissions.includes(permission.replace(/\.read$/, ".manage")))
}

export function normalizeAdminPath(originalUrl: string): string | null {
  const pathname = originalUrl.split("?")[0]
  if (!pathname.startsWith("/") || /[%\\\x00-\x20]/.test(pathname) || pathname.includes("//") ||
    pathname.split("/").some((segment) => segment === "." || segment === "..")) return null
  return pathname.replace(/\/$/, "").toLowerCase()
}

const CORE_RELATIONS: Record<string, string> = {
  products: "catalog", product: "catalog", variants: "catalog", variant: "catalog", options: "catalog", option: "catalog",
  values: "catalog", images: "catalog", tags: "catalog", type: "catalog", types: "catalog", categories: "catalog",
  category: "catalog", parent_category: "catalog", category_children: "catalog", collection: "catalog", collections: "catalog",
  prices: "catalog", price: "catalog", price_set: "catalog", price_sets: "catalog", price_list: "catalog", price_lists: "catalog",
  price_rules: "catalog", calculated_price: "catalog", original_price: "catalog",
  inventory_items: "inventory", inventory_item: "inventory", inventory: "inventory", location_levels: "inventory",
  inventory_levels: "inventory", stock_locations: "inventory", stock_location: "inventory", location: "inventory", reservation_items: "inventory",
  customer: "customers", customers: "customers", groups: "customers", customer_groups: "customers", addresses: "customers",
  orders: "orders", order: "orders", items: "context", item: "context", line_items: "orders", detail: "orders",
  summary: "orders", transactions: "orders", payment_collections: "orders", payment_collection: "orders", payments: "orders",
  payment: "orders", payment_sessions: "orders", captures: "orders", refunds: "orders", refund_reason: "orders",
  credit_lines: "orders", shipping_address: "orders", billing_address: "orders", shipping_methods: "orders",
  tax_lines: "context", adjustments: "context", return_items: "orders", returns: "orders", claims: "orders", exchanges: "orders",
  order_change: "orders", order_changes: "orders", actions: "orders", fulfillments: "orders", fulfillment: "orders", labels: "orders",
  promotions: "marketing", campaign: "marketing", campaigns: "marketing", budget: "marketing", rules: "context",
  buy_rules: "marketing", target_rules: "marketing", application_method: "marketing",
  sales_channels: "reference", sales_channel: "reference", region: "reference", regions: "reference", countries: "reference",
  currency: "reference", currencies: "reference", supported_currencies: "reference", payment_providers: "reference", provider: "reference",
  shipping_profile: "reference", shipping_option: "reference", shipping_options: "reference", service_zone: "reference",
  service_zones: "reference", geo_zones: "reference", fulfillment_set: "reference", fulfillment_sets: "reference",
  fulfillment_providers: "reference", address: "context", tax_region: "reference", tax_rates: "reference",
}

const CORE_SCALAR_FIELDS = new Set(`id created_at updated_at deleted_at title subtitle description handle status metadata thumbnail external_id is_giftcard discountable weight length height width origin_country hs_code mid_code material type_id collection_id shipping_profile_id sales_channel_id product_id variant_id inventory_item_id location_id sku barcode ean upc manage_inventory allow_backorder requires_shipping inventory_quantity reserved_quantity stocked_quantity incoming_quantity available_quantity required_quantity unit_price quantity currency_code amount min_quantity max_quantity price_set_id price_list_id raw_amount inventory_enabled rank order name value key first_name last_name email phone has_account company_name avatar_url customer_id order_id display_id version region_id payment_status fulfillment_status total subtotal discount_total tax_total shipping_total shipping_subtotal shipping_tax_total item_total item_subtotal item_tax_total original_total original_subtotal original_tax_total original_item_total original_item_subtotal original_item_tax_total original_shipping_total original_shipping_subtotal original_shipping_tax_total credit_line_total credit_line_subtotal credit_line_tax_total paid_total refunded_total refundable_total pending_difference completed_at canceled_at claimed_at shipping_address_id billing_address_id locale sales_channel_id country_code province city postal_code address_1 address_2 company code is_active is_internal is_default is_disabled is_automatic starts_at ends_at usage_limit used rule_type attribute operator target_type allocation application_method_id campaign_id budget_id limit offset count data url mime_type filename size alt text label content body published_at author_id blog_id parent_category_id product_category_id position sort_order type starts_on ends_on tracking_number tracking_url label_url provider_id fulfillment_set_id service_zone_id shipping_option_id shipping_option_type_id tax_region_id rate reference reference_id reference_type return_id claim_id exchange_id action_id order_change_id is_tax_inclusive is_combinable is_return is_custom requires_registration tax_code address_name raw_total raw_subtotal raw_tax_total raw_quantity raw_unit_price payment_collection_id captured_at refunded_at authorized_amount captured_amount refunded_amount raw_authorized_amount raw_captured_amount raw_refunded_amount return_reason_id note reason details raw_available_quantity raw_reserved_quantity raw_stocked_quantity raw_required_quantity raw_inventory_quantity raw_incoming_quantity requested_quantity received_quantity fulfilled_quantity shipped_quantity return_requested_quantity return_received_quantity return_dismissed_quantity written_off_quantity raw_requested_quantity raw_received_quantity raw_fulfilled_quantity raw_shipped_quantity raw_return_requested_quantity raw_return_received_quantity raw_return_dismissed_quantity raw_written_off_quantity`.split(" "))

// Not a walker path: more-specific static grant over /admin/layouts/[zone]/configuration.
const CORE_LAYOUT_STATIC: Inventory = {
  "/admin/layouts/product.details/configuration": { GET: "catalog.read" },
}

const CORE: Inventory = mergeInventory(coreInventory as Inventory, CORE_LAYOUT_STATIC)

function compileRoutes(inventory: Inventory) {
  return Object.entries(inventory).map(([path, methods]) => ({
    pattern: new RegExp(`^${path.split("/").map((segment) => segment.startsWith("[") ? (segment === "[id]" || segment.endsWith("_id]")) ? "[a-z][a-z0-9]*_[a-z0-9_-]+" : "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/")}$`),
    methods,
    specificity: path.split("/").filter((segment) => !segment.startsWith("[")).length,
  })).sort((first, second) => second.specificity - first.specificity)
}

export type StaffPolicy = {
  requiredStaffPermission(path: string, method: string): string | null
  staffFieldsAllowed(fields: unknown, access: StaffPolicyAccess, permission: string): boolean
}

export function createPolicy(resolved: {
  owner_user_ids?: string[]
  routes: Record<string, Record<string, string>>
  relations: Record<string, string>
  fields: string[]
}): StaffPolicy {
  const routes = compileRoutes(mergeInventory(mergeInventory(CORE, PACKAGE_ROUTES), resolved.routes))
  const relations = { ...CORE_RELATIONS, ...resolved.relations }
  const scalarFields = new Set([...CORE_SCALAR_FIELDS, ...resolved.fields])
  return {
    requiredStaffPermission(path: string, method: string): string | null {
      const route = routes.find((candidate) => candidate.pattern.test(path))
      return route?.methods[method === "HEAD" ? "GET" : method] ?? null
    },
    staffFieldsAllowed(fields: unknown, access: StaffPolicyAccess, permission: string): boolean {
      if (fields === undefined) return true
      if (typeof fields !== "string" || fields.length > 4096) return false
      const context = permission.split(".")[0]
      return fields.split(",").every((field) => {
        const segments = field.replace(/^[+-]/, "").split(".")
        if (segments.some((segment) => !/^(?:\*?[a-z_][a-z0-9_]*|\*)$/i.test(segment))) return false
        return segments.every((rawSegment, index) => {
          if (rawSegment === "*") return index === segments.length - 1
          const segment = rawSegment.replace(/^\*/, "")
          const group = relations[segment]
          if (!group) return !rawSegment.startsWith("*") && index === segments.length - 1 && scalarFields.has(segment)
          if (group === "reference" || group === "context") return true
          if (context === "orders" && ["customers", "catalog", "orders"].includes(group)) return true
          return hasStaffPermission(access, `${group}.read`)
        })
      })
    },
  }
}
