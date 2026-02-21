const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: { code: string; message: string };
}

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
    const response = json as ApiResponse<T>;
    if (!response.success) {
      throw new Error(response.error?.message ?? 'API Error');
    }
    return response.data as T;
  }

  throw new Error('Invalid API response format');
}

/** apiFetch that includes pagination in the result */
export async function apiFetchWithPagination<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T; pagination: ApiResponse<T>['pagination'] }> {
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
    const response = json as ApiResponse<T>;
    if (!response.success) {
      throw new Error(response.error?.message ?? 'API Error');
    }
    return { data: response.data as T, pagination: response.pagination };
  }

  throw new Error('Invalid API response format');
}
