const API_URL = import.meta.env.VITE_API_URL ?? '';

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const json: unknown = await res.json();

  if (
    typeof json === 'object' &&
    json !== null &&
    'success' in json
  ) {
    const response = json as { success: boolean; data?: T; error?: { code: string; message: string } };
    if (!response.success) {
      throw new Error(response.error?.message ?? 'API Error');
    }
    return response.data as T;
  }

  throw new Error('Invalid API response format');
}
