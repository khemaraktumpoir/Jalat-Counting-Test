import { SetMetadata } from '@nestjs/common';

export const Auth = (
  ...roles: ('ADMIN' | 'DRIVER' | 'PARTNER' | 'NON_PARTNER' | 'MOBILE_WAREHOUSE' | 'OPERATION')[]
) => SetMetadata('roles', roles);
