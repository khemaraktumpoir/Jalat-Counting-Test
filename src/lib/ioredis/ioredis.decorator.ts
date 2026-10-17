import { Inject } from '@nestjs/common';

import { IOREDIS_TOKEN } from './ioredis.constant';

export const InjectIORedis = () => Inject(IOREDIS_TOKEN);
