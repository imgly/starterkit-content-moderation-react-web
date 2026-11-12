/**
 * IMG.LY Gateway Credential Resolution (App-Level, DEMO / LOCAL DEV ONLY)
 *
 * Every moderation request authenticates through `resolveAiToken`, so the
 * app has exactly one credential path.
 *
 * ⚠️  PRODUCTION WARNING
 *
 * The `apiKey` mode below sends the raw IMG.LY API key from the browser.
 * This is intentional for this starterkit's local-dev experience — it is
 * NOT appropriate for production deployments.
 *
 * In production you MUST:
 *
 *   1. Store the API key on a backend you control (never ship it to the
 *      browser, never commit it to git, never put it in `.env` files that
 *      get bundled into the client).
 *   2. Expose a backend endpoint that mints a short-lived JWT bound to
 *      the current user/session.
 *   3. Replace the `apiKey` branch of `resolveAiToken` with a fetch of
 *      that JWT, and return the token string directly.
 *
 * Full recipe:
 *   https://img.ly/docs/cesdk/js/user-interface/ai-integration/gateway-provider-06df22/
 *
 * Credential modes, in order of precedence:
 *
 *   1. `apiKey`       — `VITE_AI_API_KEY` is set in `.env`. The key is
 *                       returned via `{ dangerouslyExposeApiKey }`.
 *                       ⚠️  Demo / local-dev ONLY — see warning above.
 *
 *   2. `unconfigured` — no credentials detected. `resolveAiToken` throws;
 *                       the React onboarding screen surfaces the failure.
 */


// ============================================================================
// Credential Mode Detection
// ============================================================================

export type AiCredentialMode =
  | 'apiKey'
  | 'unconfigured';

// ----------------------------------------------------------------------------
// User-entered API key (deployed production bundles only)
// ----------------------------------------------------------------------------
//
// In a `vite build` bundle there is no `.env` the visitor can edit, so we
// persist a key pasted into the onboarding screen in `localStorage`. Only
// used when `import.meta.env.PROD === true`; during `vite dev` the env
// file remains the single source of truth.

const USER_API_KEY_STORAGE = 'imgly.content-moderation.apiKey';

export function getUserApiKey(): string | undefined {
  if (!import.meta.env.PROD) return undefined;
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(USER_API_KEY_STORAGE);
    return stored != null && stored.length > 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function setUserApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_API_KEY_STORAGE, key);
  } catch {
    // `localStorage` may be disabled (private browsing, quota, etc.).
    // Silently drop — the onboarding screen will re-prompt after reload.
  }
}

export function clearUserApiKey(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(USER_API_KEY_STORAGE);
  } catch {
    // Same reasoning as `setUserApiKey` — nothing to do on failure.
  }
}

function getApiKey(): string | undefined {
  // Deployed bundles: prefer a user-pasted key from `localStorage` so
  // adopters can swap keys without rebuilding. `getUserApiKey` already
  // no-ops during `vite dev`, so dev keeps its familiar `.env` flow.
  const stored = getUserApiKey();
  if (stored != null) return stored;

  const key = (undefined as string | undefined);
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

export function detectAiCredentialMode(): AiCredentialMode {
  if (getApiKey() != null) return 'apiKey';
  return 'unconfigured';
}

// ============================================================================
// Token Resolution (shared by the moderation client and the preflight probe)
// ============================================================================

/**
 * The credential a gateway request authenticates with.
 *   - `string` — a minted JWT (production); forwarded as the bearer.
 *   - `{ dangerouslyExposeApiKey }` — raw IMG.LY API key (demo/local dev).
 */
export type AiTokenResult = string | { dangerouslyExposeApiKey: string };

/**
 * Single source of truth for credential resolution. Both the moderation
 * client and the preflight probe in `probeAiCredentials` call into this
 * function.
 *
 * ⚠️  PRODUCTION: replace the `apiKey` branch below with a `fetch()` to
 * your backend that returns a short-lived JWT scoped to the current
 * session, and return that string directly (no `dangerouslyExposeApiKey`).
 * See the file header for the full recipe.
 *
 * Throws when no credentials are detected so the onboarding flow can
 * distinguish "missing" from "invalid."
 */
export async function resolveAiToken(): Promise<AiTokenResult> {

  const apiKey = getApiKey();
  if (apiKey != null) {
    // ⚠️  Demo / local-dev ONLY — raw key is forwarded to the browser.
    return { dangerouslyExposeApiKey: apiKey };
  }

  throw new Error(
    'No AI credentials configured. Set VITE_AI_API_KEY to an API key from ' +
      'the IMG.LY dashboard (https://img.ly/dashboard).'
  );
}

/**
 * Collapse an `AiTokenResult` to the raw bearer string used in
 * `Authorization: Bearer <token>` headers.
 */
export function bearerFromTokenResult(token: AiTokenResult): string {
  return typeof token === 'string' ? token : token.dangerouslyExposeApiKey;
}

// ============================================================================
// Gateway URL Resolution
// ============================================================================

const DEFAULT_GATEWAY_URL = 'https://gateway.img.ly';

/**
 * Resolve the gateway URL to use for both the preflight probe and the
 * moderation requests. Resolution order:
 *
 *   1. Embedded mode — `?gatewayUrl=` query param forwarded by the
 *      hosting demos page. Lets the host pair its Clerk instance with
 *      the matching gateway without any starterkit-side config.
 *   2. `VITE_AI_GATEWAY_URL` env var — standalone dev pointing at a
 *      non-production gateway.
 *   3. The default production gateway.
 */
export function getGatewayUrl(): string {
  return DEFAULT_GATEWAY_URL;
}

// ============================================================================
// Preflight Probe
// ============================================================================

/**
 * Discriminated result of `probeAiCredentials`. Lets the app decide
 * whether to render the editor, the onboarding screen, or continue
 * and let the moderation check report the failure.
 *
 * The `invalid` branch carries the credential mode so the UI can tell the
 * user whether to fix a local `.env` key (`apiKey`) or chase a host-side
 * Clerk/gateway mismatch (`embedded`).
 */
export type AiCredentialProbe =
  | { status: 'ok' }
  | { status: 'missing' }
  | { status: 'invalid'; mode: AiCredentialMode }
  | { status: 'unreachable'; message: string };

function isMissingCredentialsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('No AI credentials configured')
  );
}

/**
 * Verify credentials work against the IMG.LY Gateway before mounting the
 * editor. `/v1/models` is the cheapest authenticated endpoint, and no
 * moderation credits are spent.
 *
 * Never throws — resolves with a discriminated status so the caller can
 * map each outcome to a UI state without a try/catch.
 */
export async function probeAiCredentials(): Promise<AiCredentialProbe> {
  let token: AiTokenResult;
  try {
    token = await resolveAiToken();
  } catch (error) {
    if (isMissingCredentialsError(error)) return { status: 'missing' };
    return {
      status: 'unreachable',
      message: error instanceof Error ? error.message : String(error)
    };
  }

  let res: Response;
  try {
    res = await fetch(`${getGatewayUrl()}/v1/models?groupBy=capability`, {
      headers: { Authorization: `Bearer ${bearerFromTokenResult(token)}` }
    });
  } catch (error) {
    return {
      status: 'unreachable',
      message: error instanceof Error ? error.message : String(error)
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { status: 'invalid', mode: detectAiCredentialMode() };
  }
  if (!res.ok) {
    return {
      status: 'unreachable',
      message: `Gateway returned ${res.status} ${res.statusText}`
    };
  }

  return { status: 'ok' };
}
