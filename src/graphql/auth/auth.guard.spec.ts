import { ForbiddenException } from '@nestjs/common';

import { GqlAuthGuard } from './auth.guard';

const READ = 'COUNTING:READ';
const SETTING = 'COUNTING:SETTING';
const ALL = ['COUNTING:READ', 'COUNTING:COUNT', 'COUNTING:CONTROL', 'COUNTING:SETTING'];

/** A REST request through the guard: the token's payload, the role cache, and the operation's codes. */
async function run(
  payload: Record<string, unknown>,
  roleCache: Record<string, string>,
  permissions: string[] | undefined
) {
  const req: any = { query: {}, get: () => 'Bearer token' };
  const jwt = { verifyAsync: async () => payload } as any;
  const reflector = {
    get: (key: string) => (key === 'roles' ? ['OPERATION', 'MOBILE_WAREHOUSE'] : permissions)
  } as any;
  const redis = {
    get: async (key: string) => (key === 'sessions:token' ? '{}' : roleCache[key] ?? null)
  } as any;
  const context: any = {
    getType: () => 'http',
    getHandler: () => undefined,
    switchToHttp: () => ({ getRequest: () => req })
  };
  await new GqlAuthGuard(jwt, reflector, redis).canActivate(context);
  return req.user.permissions as string[];
}

const operation = { id: 'u1', userType: 'OPERATION' };

describe('GqlAuthGuard permissions', () => {
  it('lets an account without a role do everything, as before roles', async () => {
    await expect(run(operation, {}, [SETTING])).resolves.toEqual(ALL);
    await expect(run({ ...operation, roleId: null }, {}, [SETTING])).resolves.toEqual(ALL);
  });

  it('gives a role only its own COUNTING codes', async () => {
    const cache = {
      'user:roles:44': JSON.stringify({ isFullAuthorized: false, permissions: [READ, 'ZONE:READ'] })
    };
    await expect(run({ ...operation, roleId: 44 }, cache, [READ])).resolves.toEqual([READ]);
    await expect(run({ ...operation, roleId: 44 }, cache, [SETTING])).rejects.toThrow(
      new ForbiddenException('Your role may not do this (needs COUNTING:SETTING).')
    );
  });

  it('gives a full role everything', async () => {
    const cache = { 'user:roles:1': JSON.stringify({ isFullAuthorized: true, permissions: [] }) };
    await expect(run({ ...operation, roleId: 1 }, cache, [SETTING])).resolves.toEqual(ALL);
  });

  it('gives a role missing from the cache nothing', async () => {
    await expect(run({ ...operation, roleId: 99 }, {}, [READ])).rejects.toThrow(ForbiddenException);
    await expect(run({ ...operation, roleId: 99 }, {}, undefined)).resolves.toEqual([]);
  });
});
