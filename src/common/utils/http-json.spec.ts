import * as http from 'http';
import { AddressInfo } from 'net';

import { requestJson } from './http-json';

// The Node 16 replacement for fetch (no global fetch there): JSON in and out, and a timeout.
describe('requestJson', () => {
  let server: http.Server;
  let base = '';

  beforeAll(done => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') return; // never answers
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'application/json' });
        res.end(
          req.url === '/text'
            ? 'not json'
            : JSON.stringify({ method: req.method, got: body ? JSON.parse(body) : null })
        );
      });
    });
    server.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
  afterAll(done => {
    server.close(() => done());
  });

  it('posts JSON and reads the JSON answer', async () => {
    await expect(requestJson(`${base}/x`, { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      status: 200,
      body: { method: 'POST', got: { a: 1 } }
    });
  });

  it('gives the status, and a null body when it is not JSON', async () => {
    await expect(requestJson(`${base}/missing`)).resolves.toMatchObject({ status: 404 });
    await expect(requestJson(`${base}/text`)).resolves.toEqual({ status: 200, body: null });
  });

  it('gives up instead of hanging', async () => {
    await expect(requestJson(`${base}/slow`, { timeoutMs: 200 })).rejects.toThrow('timed out');
  });
});
