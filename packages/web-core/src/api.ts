// Fetch wrapper: attaches auth and turns API errors into ApiError with a stable `code`.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(code);
  }
}

export type AuthProvider = () => string | null;

/** `baseUrl` = backend origin when the frontend is hosted elsewhere (e.g. Vercel); "" = same origin. */
export function createApi(getAuthHeader: AuthProvider, baseUrl = "") {
  const root = baseUrl.replace(/\/$/, "");
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const authHeader = getAuthHeader();
    if (authHeader) headers.authorization = authHeader;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${root}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "network_error");
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json ?? {}) as { error?: string; details?: { path: string; message: string }[] };
      throw new ApiError(res.status, err.error ?? "http_error", err.details);
    }
    return json as T;
  }
  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    del: <T>(path: string) => request<T>("DELETE", path),
  };
}

export type Api = ReturnType<typeof createApi>;

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
