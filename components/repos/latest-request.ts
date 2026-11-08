/**
 * Lets only the most recent of a series of requests report back.
 *
 * Aborting the earlier fetch is not enough on its own: a response that has
 * already arrived, and is waiting on `res.json()`, is past the point an abort
 * can stop, and a mocked or proxied fetch may ignore the signal outright. So
 * each request also carries a token, and `isCurrent()` is the check the caller
 * makes after every await before it touches state.
 */
export interface LatestRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export function createLatestRequest() {
  let token = 0;
  let controller: AbortController | null = null;

  const cancel = () => {
    token += 1;
    controller?.abort();
    controller = null;
  };

  const begin = (): LatestRequest => {
    cancel();
    const mine = token;
    const own = new AbortController();
    controller = own;
    return { signal: own.signal, isCurrent: () => token === mine };
  };

  return { begin, cancel };
}
