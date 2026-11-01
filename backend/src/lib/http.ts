/**
 * Application error with an HTTP status, a stable error code and an optional
 * Persian (fa) message for the RTL UI.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly messageFa?: string,
    public readonly code: string = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
