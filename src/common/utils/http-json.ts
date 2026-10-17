import * as http from 'http';
import * as https from 'https';

/**
 * A JSON request with Node's own http/https — this service runs on Node 16 (Dockerfile), which has
 * no global fetch. Never hangs: it gives up after `timeoutMs`. Resolves with the status and the
 * parsed body (null when the body is not JSON); rejects only when the request itself fails.
 */
export function requestJson<T = unknown>(
  url: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; body: T | null }> {
  const { method = 'GET', body, timeoutMs = 15_000 } = options;
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
          : undefined
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: T | null = null;
          try {
            parsed = text ? (JSON.parse(text) as T) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
        response.on('error', reject);
      }
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`timed out after ${timeoutMs} ms`))
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
