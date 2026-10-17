const API_BASE_URL = "/api/v1";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface ErrorResponse {
  detail?: string | Array<{ msg: string }>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCsrfToken(): string | undefined {
  const name = import.meta.env.MODE === "desktop" ? `noted_csrf_${window.location.port}` : "noted_csrf";
  const cookie = document.cookie.split("; ").find((value) => value.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const data: ErrorResponse = await response.json().catch(() => ({}));

  if (typeof data.detail === "string") {
    return data.detail;
  }

  if (Array.isArray(data.detail)) {
    return data.detail.map((item) => item.msg).join(". ");
  }

  return "Something went wrong. Please try again.";
}

export async function fetchResponse(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
): Promise<Response> {
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
    headers,
    credentials: "same-origin",
    body: isFormData || isBlob ? body : body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  return response;
}

export async function request<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetchResponse(path, method, body);
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const pageSize = 100;
  const items: T[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await request<T[]>(`${path}?limit=${pageSize}&offset=${offset}`);
    items.push(...page);

    if (page.length < pageSize) {
      return items;
    }
  }
}
