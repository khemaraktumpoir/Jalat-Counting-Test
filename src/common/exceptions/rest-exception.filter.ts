import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

/**
 * A REST route's errors as a JSON answer: put @UseFilters(new RestExceptionFilter()) on every REST
 * controller. The global AppExceptionFilter only builds a value (enough for GraphQL) and never
 * writes the HTTP response, so a refused REST call would hang until the gateway gives up (504).
 */
@Catch()
export class RestExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('RestException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const raw =
      typeof body === 'string' ? body : (body as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw[0] : raw || 'Something went wrong.';
    if (status >= 500)
      this.logger.error(exception instanceof Error ? exception.message : String(exception));
    response.status(status).json({ statusCode: status, message });
  }
}
