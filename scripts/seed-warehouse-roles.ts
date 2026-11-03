/**
 * The warehouse app's roles: what a Mobile Warehouse or Operation account may do there.
 *
 *   Counter                 any warehouse app account   the Count tab only: count, add and run cameras
 *   Mobile Warehouse Staff  MOBILE_WAREHOUSE accounts   every tab; counting without camera setup
 *   Operation Staff         OPERATION accounts          every tab; counting with camera setup; the team
 *
 * An account with no role keeps everything (as before roles). The app makes an account a Counter
 * when every code of its role is COUNTING:*, so the two staff roles carry WAREHOUSE_APP:USE as well.
 *
 * Writes to the User Service's database (the Roles / Permissions / RolePermissions tables the admin
 * panel's roles use) and its Redis role cache (user:roles:<id>), which this service reads to check a
 * role's permissions. Both come from the User Service's .env (--env, default
 * ../Jalat-User-Service/.env), so it seeds whatever database and Redis that file points at.
 *
 *   yarn role:seed                                           preview the three roles (rolled back)
 *   yarn role:seed --apply                                   write them
 *   yarn role:seed --list                                    the roles, their codes and accounts
 *   yarn role:seed --apply --role=counter --phones=+855…     + these accounts get that role (one role)
 *   yarn role:seed --apply --role=counter --phones=… --type=OPERATION   only that account type
 *   yarn role:seed --apply --role=counter --codes=READ,COUNT another set of codes for that role
 *   yarn role:seed --apply --phones=… --unassign             these accounts back to no role
 *   yarn role:seed --clean --apply [--role=…]                undo: accounts back to no role, roles deleted
 *   yarn role:seed --cache --apply                           every active role's cache, from the database
 *
 * --cache reads the database only. Use it when a role's accounts get "Your role may not do this"
 * although the role has the codes: its cache is missing from that Redis (a local Redis never has
 * it; the admin panel writes the cache only to the server's Redis when a role is saved).
 *
 * --role takes counter, warehouse, operation (comma-separated; all three when left out).
 *
 * Permission codes (created when missing, shown in the admin panel's role editor):
 *   WAREHOUSE_APP:USE  the warehouse app's tabs (Home, Pickup, Deliveries, Returns / COD)
 *   WAREHOUSE_TEAM:MANAGE  Profile → Team: add Counters, rename, reset password, turn off (Operation)
 *   COUNTING:READ      cameras, counts, history, live view, photo records
 *   COUNTING:COUNT     count photos, count by hand (QR / tap)
 *   COUNTING:CONTROL   start, stop, reset a camera; count with the phone's camera
 *   COUNTING:SETTING   add, edit, delete cameras and their counting line / area
 *
 * A Mobile Warehouse account sees its own warehouse's cameras, an Operation account every camera,
 * whatever its role. Roles this script did not create (same name, made in the admin panel) are left
 * alone. An account's role is in its sign-in token: it signs in again after a change.
 */
import { readFileSync } from 'fs';
import Redis from 'ioredis';
import { resolve } from 'path';
import { Client } from 'pg';

const TAG = 'SEED-WAREHOUSE-ROLES';
/** Roles made by this script before it seeded all three (the Counter role only). */
const OWN_TAGS = [TAG, 'SEED-COUNTER-ROLE'];
const APP_CODE = 'WAREHOUSE_APP:USE';
const TEAM_CODE = 'WAREHOUSE_TEAM:MANAGE';
const PERMISSIONS: Record<string, string> = {
  [APP_CODE]:
    'Warehouse app: Home, Pickup, Deliveries, Returns / COD (without it a counting role is a Counter)',
  [TEAM_CODE]:
    'Warehouse app team: add Counters, rename them, reset their password, turn them off (Operation)',
  'COUNTING:READ': 'Parcel counting: see cameras, counts, history, live view and photo records',
  'COUNTING:COUNT': 'Parcel counting: count photos and count by hand (QR / tap)',
  'COUNTING:CONTROL': 'Parcel counting: start, stop and reset cameras; count with the phone camera',
  'COUNTING:SETTING': 'Parcel counting: add, edit and delete cameras and their counting line / area'
};
const COUNTING_RUN = ['COUNTING:READ', 'COUNTING:COUNT', 'COUNTING:CONTROL'];

type RoleKey = 'counter' | 'warehouse' | 'operation';
interface RoleSpec {
  name: string;
  description: string;
  /** The account types that may have this role. */
  types: string[];
  codes: string[];
}
const ROLES: Record<RoleKey, RoleSpec> = {
  counter: {
    name: 'Counter',
    description: 'Counts parcels in the warehouse app (Count tab) only; adds and runs the cameras',
    types: ['MOBILE_WAREHOUSE', 'OPERATION'],
    // Camera setup too: a Counter adds the network and phone cameras it counts with.
    codes: [...COUNTING_RUN, 'COUNTING:SETTING']
  },
  warehouse: {
    name: 'Mobile Warehouse Staff',
    description: 'Warehouse app, every tab; counts parcels and runs the cameras (no camera setup)',
    types: ['MOBILE_WAREHOUSE'],
    codes: [APP_CODE, ...COUNTING_RUN]
  },
  operation: {
    name: 'Operation Staff',
    description: 'Warehouse app, every tab; counts parcels, sets the cameras up, manages the team',
    types: ['OPERATION'],
    codes: [APP_CODE, ...COUNTING_RUN, 'COUNTING:SETTING', TEAM_CODE]
  }
};
const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

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

/** The command line, checked before anything is opened. */
function readOptions() {
  const keys = list(option('role')?.toLowerCase());
  const badKeys = keys.filter(k => !ROLE_KEYS.includes(k as RoleKey));
  if (badKeys.length)
    throw new Error(`--role must be ${ROLE_KEYS.join(', ')} (not ${badKeys.join(', ')})`);
  const roles = (keys.length ? keys : ROLE_KEYS) as RoleKey[];

  const phones = list(option('phones')).map(phone);
  const unassign = flag('unassign');
  if (unassign && !phones.length) throw new Error('--unassign needs --phones');
  if (phones.length && !unassign && roles.length !== 1)
    throw new Error(`--phones needs one --role (${ROLE_KEYS.join(', ')})`);

  const types = list(option('type')?.toUpperCase());
  if (types.length && roles.length !== 1) throw new Error('--type needs one --role');
  const badTypes = types.filter(t => !ROLES[roles[0]].types.includes(t));
  if (badTypes.length)
    throw new Error(
      `--type for ${ROLES[roles[0]].name} must be ${ROLES[roles[0]].types.join(
        ' or '
      )} (not ${badTypes.join(', ')})`
    );

  const codes = list(option('codes')).map(c => (c.includes(':') ? c : `COUNTING:${c}`));
  if (codes.length && roles.length !== 1) throw new Error('--codes needs one --role');
  const unknown = codes.filter(c => !PERMISSIONS[c]);
  if (unknown.length) throw new Error(`Unknown codes: ${unknown.join(', ')}`);
  if (codes.length) {
    // A Counter is only COUNTING codes; a staff role keeps the app's tabs whatever counting it gets.
    const notCounting = codes.filter(c => !c.startsWith('COUNTING:'));
    if (roles[0] === 'counter' && notCounting.length)
      throw new Error(`A Counter has COUNTING codes only (not ${notCounting.join(', ')})`);
    if (roles[0] !== 'counter' && !codes.includes(APP_CODE)) codes.unshift(APP_CODE);
  }

  return {
    apply: flag('apply'),
    clean: flag('clean'),
    show: flag('list'),
    cacheOnly: flag('cache'),
    adopt: flag('adopt'),
    envPath: resolve(option('env') ?? '../Jalat-User-Service/.env'),
    roles,
    phones,
    unassign,
    types,
    codes
  };
}

async function main() {
  const o = readOptions();
  const env = readEnv(o.envPath);
  const db = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    // The User Service's DB_SCHEMA is the database's name (jalat_db_uat).
    database: env.DB_SCHEMA ?? env.DB_DATABASE
  });
  await db.connect();
  const mode = o.show ? 'LIST' : o.apply ? 'WRITING' : 'PREVIEW (nothing is saved; add --apply)';
  console.log(`${mode}  ${o.envPath}`);
  console.log(
    `Database ${env.DB_HOST}/${env.DB_SCHEMA}, Redis ${env.REDIS_HOST}:${env.REDIS_PORT}\n`
  );

  /** Redis keys to set (a role's cache) or remove (null), written just before COMMIT. */
  const cache = new Map<string, string | null>();
  try {
    await db.query('BEGIN');
    // Each role by name: ours (made by this script), someone else's, or none yet.
    const found = new Map<RoleKey, { id: number; status: string; createdBy: string | null }>();
    for (const key of ROLE_KEYS) {
      const res = await db.query(
        `SELECT id, status, "createdBy" FROM "Roles" WHERE name = $1 ORDER BY id DESC LIMIT 1`,
        [ROLES[key].name]
      );
      if (res.rows[0]) found.set(key, res.rows[0]);
    }
    const isOurs = (key: RoleKey) => o.adopt || OWN_TAGS.includes(found.get(key)?.createdBy ?? '');
    const ourRoleIds = ROLE_KEYS.filter(k => found.has(k) && isOurs(k)).map(k => found.get(k)!.id);

    if (o.show) {
      await listRoles(db, found);
      return;
    }

    if (o.cacheOnly) {
      // Every active role, as the User Service's permission guard reads it on a cache miss.
      const res = await db.query(
        `SELECT r.id, r.name, r."isFullAuthorized",
                COALESCE(array_agg(rp."permissionCode") FILTER (WHERE rp."permissionCode" IS NOT NULL), '{}') AS permissions
         FROM "Roles" r
         LEFT JOIN "RolePermissions" rp ON rp."roleId" = r.id
         WHERE r.status = 'ACTIVE'
         GROUP BY r.id
         ORDER BY r.id`
      );
      for (const role of res.rows) {
        const counting = (role.permissions as string[]).filter(c => c.startsWith('COUNTING:'));
        console.log(
          `role     ${role.id} "${role.name}": ${
            role.isFullAuthorized ? 'full' : counting.join(', ') || 'no COUNTING codes'
          }`
        );
        cache.set(
          `user:roles:${role.id}`,
          JSON.stringify({
            isFullAuthorized: role.isFullAuthorized,
            permissions: role.permissions,
            id: role.id
          })
        );
      }
    } else if (o.unassign) {
      await unassign(db, o.phones, ourRoleIds);
    } else if (o.clean) {
      for (const key of o.roles) {
        const role = found.get(key);
        const { name } = ROLES[key];
        if (!role || role.status === 'DELETED') {
          console.log(`role     "${name}": none to undo`);
          continue;
        }
        if (!isOurs(key)) {
          console.log(
            `role     ${role.id} "${name}": skipped (made by ${
              role.createdBy ?? 'the admin panel'
            }, not this script)`
          );
          continue;
        }
        const users = await db.query(
          `UPDATE "Users" SET "roleId" = NULL WHERE "roleId" = $1
           RETURNING "phoneNumber", "fullName", "userType"`,
          [role.id]
        );
        users.rows.forEach(u =>
          console.log(`account  ${u.phoneNumber} ${u.userType} ${u.fullName}: no role`)
        );
        await db.query(`DELETE FROM "RolePermissions" WHERE "roleId" = $1`, [role.id]);
        await db.query(
          `UPDATE "Roles" SET status = 'DELETED', "updatedBy" = $2, "updatedAt" = now() WHERE id = $1`,
          [role.id, TAG]
        );
        console.log(`role     ${role.id} "${name}": deleted (as the admin panel deletes a role)`);
        cache.set(`user:roles:${role.id}`, null);
      }
      // The permission codes stay: other roles may use them, and they cost nothing.
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
      console.log('');

      for (const key of o.roles) {
        const spec = ROLES[key];
        const codes = o.codes.length ? o.codes : spec.codes;
        let role = found.get(key);
        if (role && !isOurs(key)) {
          throw new Error(
            `A role "${spec.name}" (${role.id}, ${role.status}) was made by ${
              role.createdBy ?? 'the admin panel'
            }, ` + `not this script: rename it, or run with --adopt to take it over`
          );
        }
        if (!role) {
          const res = await db.query(
            `INSERT INTO "Roles" (name, description, "isFullAuthorized", "createdBy")
             VALUES ($1, $2, false, $3) RETURNING id`,
            [spec.name, spec.description, TAG]
          );
          role = { id: res.rows[0].id as number, status: 'ACTIVE', createdBy: TAG };
          found.set(key, role);
          console.log(`role     ${role.id} "${spec.name}": created`);
        } else {
          await db.query(
            `UPDATE "Roles" SET status = 'ACTIVE', description = $2, "isFullAuthorized" = false,
               "updatedBy" = $3, "updatedAt" = now() WHERE id = $1`,
            [role.id, spec.description, TAG]
          );
          console.log(
            `role     ${role.id} "${spec.name}": already there (${role.status}), updated`
          );
        }

        await db.query(`DELETE FROM "RolePermissions" WHERE "roleId" = $1`, [role.id]);
        for (const code of codes)
          await db.query(
            `INSERT INTO "RolePermissions" ("roleId", "permissionCode") VALUES ($1, $2)`,
            [role.id, code]
          );
        console.log(`         codes ${codes.join(', ')}`);
        // The shape the User Service's role service caches (addPermissionsToRedis).
        cache.set(
          `user:roles:${role.id}`,
          JSON.stringify({ isFullAuthorized: false, permissions: codes, id: role.id })
        );
      }

      if (o.phones.length) {
        const key = o.roles[0];
        const ids = ROLE_KEYS.filter(k => found.has(k) && isOurs(k)).map(k => found.get(k)!.id);
        await assign(db, o.phones, key, found.get(key)!.id, o.types, ids);
      }
    }

    if (!o.apply) {
      await db.query('ROLLBACK');
      for (const [key, value] of cache)
        console.log(`redis    ${key}: ${value ? 'would be set' : 'would be removed'}`);
      console.log('\nPreview only: run again with --apply to save it.');
      return;
    }

    if (cache.size) {
      const redis = new Redis({
        host: env.REDIS_HOST,
        port: Number(env.REDIS_PORT ?? 6379),
        password: env.REDIS_AUTH_PASS || undefined,
        lazyConnect: true
      });
      await redis.connect();
      // Redis first: if it fails, the database is rolled back and the two stay alike.
      try {
        for (const [key, value] of cache) {
          if (value) await redis.set(key, value);
          else await redis.del(key);
          console.log(`redis    ${key}: ${value ? 'set' : 'removed'}`);
        }
      } finally {
        redis.disconnect();
      }
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

/** Each of the three roles: its id, status, codes and the accounts that have it. */
async function listRoles(
  db: Client,
  found: Map<RoleKey, { id: number; status: string; createdBy: string | null }>
) {
  for (const key of ROLE_KEYS) {
    const spec = ROLES[key];
    const role = found.get(key);
    if (!role) {
      console.log(`${spec.name}: not created yet (yarn role:seed --apply)\n`);
      continue;
    }
    const codes = await db.query(
      `SELECT "permissionCode" FROM "RolePermissions" WHERE "roleId" = $1 ORDER BY 1`,
      [role.id]
    );
    const users = await db.query(
      `SELECT "phoneNumber", "userType", "fullName", status FROM "Users" WHERE "roleId" = $1 ORDER BY "userType", "phoneNumber"`,
      [role.id]
    );
    const owner = OWN_TAGS.includes(role.createdBy ?? '')
      ? ''
      : ` · made by ${role.createdBy ?? 'the admin panel'}`;
    console.log(
      `${spec.name} (role ${role.id}, ${role.status}${owner}) — for ${spec.types.join(' / ')}`
    );
    console.log(`  codes    ${codes.rows.map(r => r.permissionCode).join(', ') || 'none'}`);
    if (!users.rows.length) console.log('  accounts none');
    users.rows.forEach(u =>
      console.log(`  account  ${u.phoneNumber} ${u.userType} ${u.fullName} (${u.status})`)
    );
    console.log('');
  }
}

/**
 * The phones' accounts of the role's types get the role. One phone can have a Mobile Warehouse and
 * an Operation account: each one of a fitting type gets it. An account with one of this script's
 * roles moves to the new one; an account with another role is left alone.
 */
async function assign(
  db: Client,
  phones: string[],
  key: RoleKey,
  roleId: number,
  types: string[],
  ourIds: number[]
) {
  const spec = ROLES[key];
  const fitting = types.length ? types : spec.types;
  for (const p of phones) {
    const res = await db.query(
      `SELECT id, "userType", "roleId", "fullName", status FROM "Users" WHERE "phoneNumber" = $1`,
      [p]
    );
    const accounts = res.rows.filter(u => fitting.includes(u.userType));
    if (!accounts.length) {
      const has = res.rows.map(u => u.userType).join(', ') || 'no account';
      console.log(`account  ${p}: skipped (${has}; ${spec.name} is for ${fitting.join(' / ')})`);
      continue;
    }
    for (const user of accounts) {
      const who = `${p} ${user.userType} ${user.fullName}`;
      if (user.roleId === roleId) {
        console.log(`account  ${who}: already ${spec.name}`);
        continue;
      }
      if (user.roleId && !ourIds.includes(user.roleId)) {
        console.log(
          `account  ${who}: skipped (has role ${user.roleId}, not one of the warehouse app's)`
        );
        continue;
      }
      await db.query(`UPDATE "Users" SET "roleId" = $1 WHERE id = $2`, [roleId, user.id]);
      const from = user.roleId ? ` (was role ${user.roleId})` : '';
      console.log(`account  ${who} (${user.status}): ${spec.name}${from} — sign in again`);
    }
  }
}

/** The phones' accounts that have one of this script's roles: back to no role (everything). */
async function unassign(db: Client, phones: string[], ourIds: number[]) {
  for (const p of phones) {
    const res = await db.query(
      `UPDATE "Users" SET "roleId" = NULL WHERE "phoneNumber" = $1 AND "roleId" = ANY($2::int[])
       RETURNING "userType", "fullName"`,
      [p, ourIds]
    );
    if (!res.rowCount) console.log(`account  ${p}: none with a warehouse app role`);
    res.rows.forEach(u =>
      console.log(`account  ${p} ${u.userType} ${u.fullName}: no role — sign in again`)
    );
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
