import { NotFoundException, UnauthorizedException } from '@nestjs/common';

import { AppExceptionFilter } from './app-exception-filter';

// The global filter: a plain HTTP request gets its JSON answer at once (an address with no route
// used to hang); GraphQL still gets the error as a value.
function host(type: 'http' | 'graphql') {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return {
    res,
    host: { getType: () => type, switchToHttp: () => ({ getResponse: () => res }) } as any
  };
}

describe('AppExceptionFilter', () => {
  it('answers an HTTP request with its status and message', () => {
    const { res, host: h } = host('http');
    expect(
      new AppExceptionFilter().catch(new NotFoundException('Cannot GET /nope'), h)
    ).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 404, message: 'Cannot GET /nope' });
  });

  it('gives GraphQL the error as a value, writing nothing', () => {
    const { res, host: h } = host('graphql');
    const result = new AppExceptionFilter().catch(
      new UnauthorizedException('Invalid Authorization Scheme'),
      h
    );
    expect(result?.getStatus()).toBe(401);
    expect(result?.getResponse()).toEqual({
      statusCode: 401,
      message: 'Invalid Authorization Scheme'
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
