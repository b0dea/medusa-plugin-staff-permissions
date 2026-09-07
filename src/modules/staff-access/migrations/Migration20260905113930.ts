import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905113930 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "staff_access" drop constraint if exists "staff_access_user_id_unique";`);
    this.addSql(`create table if not exists "staff_access" ("id" text not null, "user_id" text not null, "administrator" boolean not null default false, "disabled" boolean not null default false, "permissions" jsonb not null default '{"grants":[]}', "version" integer not null default 1, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "staff_access_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_access_user_id_unique" ON "staff_access" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_access_deleted_at" ON "staff_access" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "staff_access_audit" ("id" text not null, "actor_id" text not null, "target_user_id" text not null, "before" jsonb null, "after" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "staff_access_audit_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_access_audit_deleted_at" ON "staff_access_audit" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_access_audit_target_user_id_created_at" ON "staff_access_audit" ("target_user_id", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "staff_access" cascade;`);

    this.addSql(`drop table if exists "staff_access_audit" cascade;`);
  }

}
