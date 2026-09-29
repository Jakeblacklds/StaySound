/** Small fetch helpers shared by the mirror and HTTP layers. */
import { isHtmlResponse } from "./mirrorPolicy";

export function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

export async function parseJsonResponse<T>(
  response: Response,
  base: string,
): Promise<T> {
  const rawBody = await response.text();
  if (isHtmlResponse(response.headers.get("content-type"), rawBody)) {
    throw new Error(`Mirror returned HTML instead of JSON: ${base}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${base}`);
  }
}
