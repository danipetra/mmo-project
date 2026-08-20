const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";

export class ApiError extends Error {}

export async function apiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `request failed (${res.status})`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}
