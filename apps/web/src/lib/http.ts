import { isAndroidPilot, pilotRequest } from "./android-pilot";

const API_BASE_URL = "/api/v1";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ErrorResponse {
  detail?: string | Array<{ msg: string }>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isSessionRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.detail === "Sign in to continue"
  );
}

function readCsrfToken(): string | undefined {
  const name =
    import.meta.env.MODE === "desktop"
      ? `noted_csrf_${window.location.port}`
      : "noted_csrf";
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

async function readApiError(response: Response): Promise<ApiError> {
  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim();
  const data: ErrorResponse =
    mime?.toLowerCase() === "application/json"
      ? ((await response.json().catch(() => null)) ?? {})
      : {};

  if (typeof data.detail === "string") {
    return new ApiError(response.status, data.detail, data.detail);
  }

  if (Array.isArray(data.detail)) {
    return new ApiError(
      response.status,
      data.detail
        .map((item) => item?.msg)
        .filter(Boolean)
        .join(". "),
    );
  }

  return new ApiError(
    response.status,
    "The server returned an unexpected response. Check your connection and try again.",
  );
}

export async function fetchResponse(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  if (isAndroidPilot) {
    const response = await pilotRequest(path, method, body, signal);
    if (!response.ok) throw await readApiError(response);
    return response;
  }
  const headers = new Headers();
  const csrfToken = readCsrfToken();

  const isFormData = body instanceof FormData;
  const isBlob = body instanceof Blob;
  if (body !== undefined && !isFormData && !isBlob) {
    headers.set("Content-Type", "application/json");
  }

  if (csrfToken && method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    headers,
    credentials: "same-origin",
    body:
      isFormData || isBlob
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await readApiError(response);
  }

  return response;
}

export async function request<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchResponse(path, method, body, signal);
  } catch (error) {
    if (signal?.aborted)
      throw new Error(
        "The server took too long to respond. Check your connection and try again.",
        { cause: error },
      );
    if (error instanceof TypeError)
      throw new Error(
        "Couldn't reach your server. Check your connection and server address.",
        { cause: error },
      );
    throw error;
  }
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const pageSize = 100;
  const items: T[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await request<T[]>(
      `${path}?limit=${pageSize}&offset=${offset}`,
    );
    items.push(...page);

    if (page.length < pageSize) {
      return items;
    }
  }
}
