import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9015",
      authCors: process.env.AUTH_CORS || "http://localhost:9015",
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  admin: {
    disable: true,
  },
  plugins: [
    {
      resolve: "@hollowpoint-io/medusa-plugin-staff-permissions",
      options: {
        routes: {},
        relations: {},
        fields: [],
      },
    },
  ],
})
