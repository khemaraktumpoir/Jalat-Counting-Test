/** Query parameters whose value is a secret: never written to a log. */
const SECRET_PARAMS = ['access_token', 'token', 'apikey', 'api_key'];

/**
 * A request's address for the log, with secret values hidden. The camera images (snapshot, live
 * preview) take the sign-in token as ?access_token= (an <img> cannot send a header): written as
 * it is, anyone who reads the log could sign in as that account.
 */
export function logUrl(url: string): string {
  return url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (all, sep: string, name: string) =>
    SECRET_PARAMS.includes(name.toLowerCase()) ? `${sep}${name}=…` : all
  );
}
