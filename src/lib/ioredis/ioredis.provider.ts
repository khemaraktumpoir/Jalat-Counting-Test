import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { IOREDIS_TOKEN } from './ioredis.constant';
import { IORedisConfig } from './ioredis.dto';
import { ConfigService } from '../config';

const logger = new Logger('IORedisModule');

let redis: Redis;

// The apps' sessions (sessions:<token>, written by the User Service at sign-in): the auth guard
// checks them, so a token signed out elsewhere stops working here too.
export const IORedisProvider = {
  inject: [ConfigService],
  provide: IOREDIS_TOKEN,
  useFactory: (configService: ConfigService) => {
    const config = configService.validate('IORedisModule', IORedisConfig);

    // This will prevent reinitialize redis and cause maximum redis connection
    if (redis) return redis;

    redis = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_AUTH_PASS || undefined
    });

    redis.on('error', e => logger.error(e.message, e.stack));
    redis.on('end', () => logger.warn('Ended'));
    redis.on('reconnecting', () => logger.log('Reconnecting'));
    redis.on('ready', () => logger.log('Connected'));
    return redis;
  }
};
