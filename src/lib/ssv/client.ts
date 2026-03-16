import { forecastConfig } from '@/lib/forecast-config';

type GraphQLError = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
};

const REQUEST_TIMEOUT_MS = 12_000;

const trimTrailingSlashes = (value: string): string => {
  return value.replace(/\/+$/, '');
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const querySSVSubgraph = async <T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (forecastConfig.ssvSubgraphApiKey) {
    headers.authorization = `Bearer ${forecastConfig.ssvSubgraphApiKey}`;
  }

  const response = await fetchWithTimeout(forecastConfig.ssvSubgraphUrl, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed with status ${response.status}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((error) => error.message).join('; ');
    throw new Error(`Subgraph query error: ${message}`);
  }

  if (!json.data) {
    throw new Error('Subgraph query returned no data');
  }

  return json.data;
};

export const querySSVApi = async <T>(
  path: string,
  queryParams?: Record<string, string | number | boolean | undefined>,
): Promise<T> => {
  const baseUrl = trimTrailingSlashes(forecastConfig.ssvApiBaseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    const responseText = await response.text();
    const suffix = responseText ? `: ${responseText.slice(0, 200)}` : '';
    throw new Error(`SSV API request failed with status ${response.status}${suffix}`);
  }

  return (await response.json()) as T;
};
