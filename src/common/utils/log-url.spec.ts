import { logUrl } from './log-url';

describe('logUrl', () => {
  it('hides the sign-in token, keeps the rest of the address', () => {
    expect(logUrl('/api/v1/counting/cameras/b19c/stream?access_token=eyJ.abc.def&t=1793')).toBe(
      '/api/v1/counting/cameras/b19c/stream?access_token=…&t=1793'
    );
    expect(logUrl('/x?t=1&ACCESS_TOKEN=secret')).toBe('/x?t=1&ACCESS_TOKEN=…');
  });

  it('leaves an address without secrets as it is', () => {
    expect(logUrl('/api/v1/counting/photos?name=Belt+4')).toBe(
      '/api/v1/counting/photos?name=Belt+4'
    );
    expect(logUrl('/health')).toBe('/health');
  });
});
