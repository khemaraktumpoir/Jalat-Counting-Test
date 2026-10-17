import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const AuthUser = createParamDecorator(
  (args: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().authUser
);

// TODO: create your own Authenticate User Interface
export interface AuthUserX {
  id: string;
}
