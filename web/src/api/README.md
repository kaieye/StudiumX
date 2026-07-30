# Web API Client

HTTP client code for the StudiumX-Server backend.

## Modules

- `http.ts` - authenticated HTTP client. Exports `apiGet` / `apiPost` / `apiPut`
  (plus `ApiError` / `AuthError`). Injects `Authorization: Bearer <accessToken>`
  read directly from `localStorage` (`studiumx.accessToken`), and on HTTP 401
  performs a single token refresh (`POST /auth/refresh`, rotation) + retry before
  giving up with an `AuthError`. Non-2xx responses throw `ApiError`.
  Auth/login code lives in `web/src/auth/*` and shares only the localStorage key
  contract with this module - `http.ts` does not import from `auth/`.

## Conventions

- API base URL: `import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'`.
- Access token localStorage key: `studiumx.accessToken`.
- Refresh token localStorage key: `studiumx.refreshToken`.
- Auth header: `Authorization: Bearer <accessToken>` (no cookies; CORS is
  `credentials: false`, see server-contracts.md §0).
