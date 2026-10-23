/**
 * The Counter role: staff who count parcels in the warehouse app (Count tab) and nothing else.
 *
 * Writes to the User Service's database (the Roles / Permissions / RolePermissions tables the admin
 * panel's roles use) and its Redis role cache (user:roles:<id>), which this service reads to check a
 * role's permissions. Both come from the User Service's .env (--env, default
 * ../Jalat-User-Service/.env), so it seeds whatever database and Redis that file points at.
 *
 *   yarn role:seed                                        preview only (rolled back)
 *   yarn role:seed --apply                                write it
 *   yarn role:seed --apply --phones=+85515555666,+855…    + make these accounts Counters: the phone's
 *                                                           Mobile Warehouse and Operation accounts
 *   yarn role:seed --apply --phones=… --type=OPERATION    only that kind (MOBILE_WAREHOUSE or OPERATION)
 *   yarn role:seed --apply --codes=READ,COUNT             another set of codes for the role
 *   yarn role:seed --clean --apply                        undo: accounts back to no role, role deleted
 *
 * Permission codes (created when missing, shown in the admin panel's role editor):
 *   COUNTING:READ     cameras, counts, history, live view, photo records
 *   COUNTING:COUNT    count photos, count by hand (QR / tap)
 *   COUNTING:CONTROL  start, stop, reset a camera; count with the phone's camera
 *   COUNTING:SETTING  add, edit, delete cameras and their counting line / area
 * The Counter role gets READ, COUNT and CONTROL by default (setting cameras up stays with Operation).
 *
 * A Mobile Warehouse Counter sees its own warehouse's cameras, an Operation Counter every camera (as
 * the two account types do without a role).
 *
 * An account's role is in its sign-in token: a Counter signs in again after --phones (or --clean).
 */
import { readFileSync } from 'fs';
import Redis from 'ioredis';
import { resolve } from 'path';
import { Client } from 'pg';

const ROLE_NAME = 'Counter';
const ROLE_DESCRIPTION = 'Counts parcels in the warehouse app (Count tab) only';
const TAG = 'SEED-COUNTER-ROLE';
const PERMISSIONS: Record<string, string> = {
  'COUNTING:READ': 'Parcel counting: see cameras, counts, history, live view and photo records',
  'COUNTING:COUNT': 'Parcel counting: count photos and count by hand (QR / tap)',
  'COUNTING:CONTROL': 'Parcel counting: start, stop and reset cameras; count with the phone camera',
  'COUNTING:SETTING': 'Parcel counting: add, edit and delete cameras and their counting line / area'
};
const DEFAULT_CODES = ['COUNTING:READ', 'COUNTING:COUNT', 'COUNTING:CONTROL'];
// The warehouse app's accounts: the only ones that can use the Count pages.
const COUNTER_TYPES = ['MOBILE_WAREHOUSE', 'OPERATION'];

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) =>
  argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? undefined;
const list = (value?: string) =>
  (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

/** KEY=value lines of a .env file (quotes removed); enough for the User Service's. */
function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** +85515555666, 015 555 666 and 85515555666 all mean +85515555666. */
const phone = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return `+855${digits.replace(/^855/, '').replace(/^0/, '')}`;
};

async function main() {
  const apply = flag('apply');
  const clean = flag('clean');
  const envPath = resolve(option('env') ?? '../Jalat-User-Service/.env');
  const env = readEnv(envPath);
  const codes = list(option('codes')).map(c => (c.includes(':') ? c : `COUNTING:${c}`));
  const roleCodes = codes.length ? codes : DEFAULT_CODES;
  const unknown = roleCodes.filter(c => !PERMISSIONS[c]);
  if (unknown.length) throw new Error(`Unknown codes: ${unknown.join(', ')}`);
  const phones = list(option('phones')).map(phone);
  const types = list(option('type')?.toUpperCase());
  const badTypes = types.filter(type => !COUNTER_TYPES.includes(type));
  if (badTypes.length)
    throw new Error(`--type must be ${COUNTER_TYPES.join(' or ')} (not ${badTypes.join(', ')})`);
  const counterTypes = types.length ? types : COUNTER_TYPES;

  const db = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    // The User Service's DB_SCHEMA is the database's name (jalat_db_uat).
    database: env.DB_SCHEMA ?? env.DB_DATABASE
  });
  await db.connect();
  console.log(`${apply ? 'WRITING' : 'PREVIEW (nothing is saved; add --apply)'}  ${envPath}`);
  console.log(
    `Database ${env.DB_HOST}/${env.DB_SCHEMA}, Redis ${env.REDIS_HOST}:${env.REDIS_PORT}\n`
  );

  let cache: { key: string; value: string | null } | null = null;
  try {
    await db.query('BEGIN');
    const found = await db.query(`SELECT id, status FROM "Roles" WHERE name = $1`, [ROLE_NAME]);
    let roleId: number | undefined = found.rows[0]?.id;

    if (clean) {
      if (!roleId) {
        console.log(`No "${ROLE_NAME}" role: nothing to undo.`);
      } else {
        const users = await db.query(
          `UPDATE "Users" SET "roleId" = NULL WHERE "roleId" = $1
           RETURNING "phoneNumber", "fullName", "userType"`,
          [roleId]
        );
        users.rows.forEach(u =>
          console.log(`account  ${u.phoneNumber} ${u.userType} ${u.fullName}: no role`)
        );
        await db.query(`DELETE FROM "RolePermissions" WHERE "roleId" = $1`, [roleId]);
        await db.query(
          `UPDATE "Roles" SET status = 'DELETED', "updatedBy" = $2, "updatedAt" = now() WHERE id = $1`,
          [roleId, TAG]
        );
        console.log(
          `role     ${roleId} "${ROLE_NAME}": deleted (as the admin panel deletes a role)`
        );
        cache = { key: `user:roles:${roleId}`, value: null };
      }
      // The COUNTING:* codes stay: other roles may use them, and they cost nothing.
    } else {
      for (const [name, description] of Object.entries(PERMISSIONS)) {
        const res = await db.query(
          `INSERT INTO "Permissions" (name, description, "createdBy")
           SELECT $1::varchar, $2::varchar, $3::varchar WHERE NOT EXISTS (SELECT 1 FROM "Permissions" WHERE name = $1)
           RETURNING id`,
          [name, description, TAG]
        );
        console.log(`permission ${name}: ${res.rowCount ? 'created' : 'already there'}`);
      }

      if (!roleId) {
        const res = await db.query(
          `INSERT INTO "Roles" (name, description, "isFullAuthorized", "createdBy")
           VALUES ($1, $2, false, $3) RETURNING id`,
          [ROLE_NAME, ROLE_DESCRIPTION, TAG]
        );
        roleId = res.rows[0].id as number;
        console.log(`role     ${roleId} "${ROLE_NAME}": created`);
      } else {
        await db.query(
          `UPDATE "Roles" SET status = 'ACTIVE', description = $2, "isFullAuthorized" = false,
             "updatedBy" = $3, "updatedAt" = now() WHERE id = $1`,
          [roleId, ROLE_DESCRIPTION, TAG]
        );
        console.log(
          `role     ${roleId} "${ROLE_NAME}": already there (${found.rows[0].status}), updated`
        );
      }

      await db.query(`DELETE FROM "RolePermissions" WHERE "roleId" = $1`, [roleId]);
      for (const code of roleCodes)
        await db.query(
          `INSERT INTO "RolePermissions" ("roleId", "permissionCode") VALUES ($1, $2)`,
          [roleId, code]
        );
      console.log(`codes    ${roleCodes.join(', ')}`);

      for (const p of phones) {
        const res = await db.query(
          `SELECT id, "userType", "roleId", "fullName", status FROM "Users" WHERE "phoneNumber" = $1`,
          [p]
        );
        // One phone can have a Mobile Warehouse and an Operation account: each one becomes a Counter.
        const accounts = res.rows.filter(u => counterTypes.includes(u.userType));
        if (!accounts.length) {
          const found = res.rows.map(u => u.userType).join(', ') || 'no account';
          console.log(
            `account  ${p}: skipped (${found}; Counters are ${counterTypes.join(' / ')})`
          );
          continue;
        }
        for (const user of accounts) {
          const who = `${p} ${user.userType} ${user.fullName}`;
          if (user.roleId && user.roleId !== roleId) {
            console.log(`account  ${who}: skipped (already has role ${user.roleId})`);
            continue;
          }
          await db.query(`UPDATE "Users" SET "roleId" = $1 WHERE id = $2`, [roleId, user.id]);
          console.log(`account  ${who} (${user.status}): Counter — sign in again`);
        }
      }

      // The shape the User Service's role service caches (addPermissionsToRedis).
      cache = {
        key: `user:roles:${roleId}`,
        value: JSON.stringify({ isFullAuthorized: false, permissions: roleCodes, id: roleId })
      };
    }

    if (!apply) {
      await db.query('ROLLBACK');
      if (cache)
        console.log(`redis    ${cache.key}: ${cache.value ? 'would be set' : 'would be removed'}`);
      console.log('\nPreview only: run again with --apply to save it.');
      return;
    }

    if (cache) {
      const redis = new Redis({
        host: env.REDIS_HOST,
        port: Number(env.REDIS_PORT ?? 6379),
        password: env.REDIS_AUTH_PASS || undefined,
        lazyConnect: true
      });
      await redis.connect();
      // Redis first: if it fails, the database is rolled back and the two stay alike.
      if (cache.value) await redis.set(cache.key, cache.value);
      else await redis.del(cache.key);
      redis.disconnect();
      console.log(`redis    ${cache.key}: ${cache.value ? 'set' : 'removed'}`);
    }
    await db.query('COMMIT');
    console.log('\nSaved.');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
