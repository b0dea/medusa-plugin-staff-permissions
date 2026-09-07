import Medusa from "@medusajs/js-sdk"

declare const __BACKEND_URL__: string | undefined

export const sdk = new Medusa({
  baseUrl: typeof __BACKEND_URL__ !== "undefined" ? __BACKEND_URL__ : "/",
  debug: import.meta.env.DEV,
  auth: {
    // Admin authenticates via the session cookie (connect.sid). Default to
    // "session" so custom pages' sdk.client.fetch sends that cookie; with
    // "jwt" those requests are unauthenticated and the page renders empty.
    type: (import.meta.env.VITE_ADMIN_AUTH_TYPE || "session") as
      | "jwt"
      | "session",
  },
})
