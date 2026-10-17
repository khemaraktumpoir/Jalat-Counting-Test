import {
  CanActivate,
  ContextType,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';

import { E } from '@common';
import { InjectIORedis } from '@lib/ioredis';

import { JWTPayload } from './auth.interfaces';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(
    private readonly service: JwtService,
    private readonly reflector: Reflector,
    @InjectIORedis() private readonly redis: Redis
  ) {}

  async canActivate(context: ExecutionContext) {
    const ctx = this.getContext(context);
    // const ctx = GqlExecutionContext.create(context);
    const handler = ctx.getHandler();
    const roles = this.reflector.get<string[]>('roles', handler);

    if (roles === undefined) return true;

    const req = this.getRequest(context);
    // An <img> (snapshot, live preview) cannot send a header: REST routes also take ?access_token=.
    const queryToken = context.getType() === 'http' ? req.query?.access_token : undefined;
    const authToken = req.get('authorization') || (queryToken ? `Bearer ${queryToken}` : '');
    const [scheme, token] = authToken.split(' ');

    const user = await this.checkUserScheme(scheme, token, roles);
    (req as any).user = user;

    return true;
  }

  async checkUserScheme(scheme: string, token: string, roles: string[]) {
    if (scheme.toLowerCase() !== 'bearer')
      throw new UnauthorizedException('Invalid Authorization Scheme');
    if (!token) throw new UnauthorizedException('Authorization token is missing.');

    let decoded: JWTPayload;
    try {
      decoded = await this.service.verifyAsync<JWTPayload>(token);
    } catch (e: any) {
      throw new UnauthorizedException(e.name + ' ' + e.message);
    }

    // TODO: use your own user table
    if (roles.length > 0 && !roles.find(x => x === decoded.userType))
      throw new ForbiddenException('Invalid User Role');

    const existToken = await this.redis.get(`sessions:${token}`);
    if (!existToken && decoded.userType != E.UserTypeEnum.ADMIN)
      throw new UnauthorizedException('Unauthorized');

    return { ...decoded };
  }

  private getContext(context: ExecutionContext): any {
    if (context.getType<ContextType | 'graphql'>() === 'graphql') {
      return GqlExecutionContext.create(context);
    }
    return context;
  }

  private getRequest(context: ExecutionContext) {
    if (context.getType<ContextType | 'graphql'>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext().req;
    }
    return context.switchToHttp().getRequest();
  }
}
