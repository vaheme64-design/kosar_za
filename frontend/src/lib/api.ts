export interface ApiErrorPayload {
  error?: string;
  message?: string;
  messageFa?: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly messageFa?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const BASE: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const TOKEN_KEY = 'kpims.token';

let authToken: string | null = localStorage.getItem(TOKEN_KEY);

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Dispatched (globally) when the API answers 401 so AuthContext can log out. */
export const UNAUTHORIZED_EVENT = 'kpims:unauthorized';

export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, 'network_error', 'Network error', 'ارتباط با سرور برقرار نشد');
  }

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;

  if (!response.ok) {
    if (response.status === 401 && authToken) {
      setAuthToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiClientError(
      response.status,
      payload.error ?? 'error',
      payload.message ?? `HTTP ${response.status}`,
      payload.messageFa,
      payload.details,
    );
  }

  return payload as T;
}
