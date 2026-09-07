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
