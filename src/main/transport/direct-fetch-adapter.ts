/** Internal adapter for native, non-proxied fetch requests. */
export function fetchDirect(input: string | URL, init: RequestInit | undefined): Promise<Response> {
  return fetch(input, init)
}