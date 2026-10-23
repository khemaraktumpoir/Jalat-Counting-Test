import { SetMetadata } from '@nestjs/common';

import type { CountingPermission } from '../constants';

export const Auth = (
  ...roles: ('ADMIN' | 'DRIVER' | 'PARTNER' | 'NON_PARTNER' | 'MOBILE_WAREHOUSE' | 'OPERATION')[]
) => SetMetadata('roles', roles);

/** The permission codes an account with a role needs (C.COUNTING_PERMISSIONS); with Auth. */
export const Permission = (...codes: CountingPermission[]) => SetMetadata('permissions', codes);
