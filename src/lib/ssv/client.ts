import { forecastConfig } from '@/lib/forecast-config';

type GraphQLError = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
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

  const response = await fetch(forecastConfig.ssvSubgraphUrl, {
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
