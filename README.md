# @hollowpoint-io/medusa-plugin-staff-permissions

## Middleware order

Medusa registers global middlewares core → plugins → app, so this plugin's `/admin` gate runs **after** core admin authentication and **before** any host global middleware. Hosts must not add another `/admin` global middleware that answers requests before this one unless they intend to bypass the gate.

Documented at https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares#how-are-middlewares-ordered-and-applied.
