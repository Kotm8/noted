export async function desktopRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const csrfName = `noted_csrf_${window.location.port}=`;
  const csrf = document.cookie.split("; ").find((item) => item.startsWith(csrfName))?.slice(csrfName.length);
  const response = await fetch(`/desktop/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Check the supplied setup details.");
  return data as T;
}
