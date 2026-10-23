import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

/**
 * The global filter. GraphQL: the error as a value (Apollo answers with it). A plain HTTP request
 * (a REST route without its own RestExceptionFilter, or an address with no route at all, like a
 * browser opening a wrong path): the JSON answer written here — returning a value there writes
 * nothing, and the request hung until the browser or the gateway gave up.
 */
@Catch(HttpException)
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse() as
      | string
      | { statusCode: number; message: string | string[]; error: string };
    const raw = typeof response === 'string' ? response : response.message;
    const message = Array.isArray(raw) ? raw[0] : raw;

    // ! Display log in server. Can also integrate with Mailer if want to alert to developer
    if (statusCode >= 500) {
      console.error(exception);
    } else if (host.getType<string>() !== 'http') {
      console.log(response);
    }

    if (host.getType<string>() === 'http') {
      const res = host.switchToHttp().getResponse<Response>();
      if (!res.headersSent) res.status(statusCode).json({ statusCode, message });
      return;
    }
    return new HttpException({ statusCode, message }, statusCode);
  }
}
