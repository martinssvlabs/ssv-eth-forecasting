import type { LiveOperator } from '@/lib/estimate/types';
import { forecastConfig } from '@/lib/forecast-config';
import { querySSVApi, querySSVSubgraph } from '@/lib/ssv/client';

type GetOperatorsData = {
  operators: Array<{
    id: string;
    fee: string;
    isPrivate: boolean;
  }>;
};

type SsvApiOperator = {
  id: number;
  fee: string;
  is_private: boolean;
};

const GET_OPERATORS_QUERY = `
  query GetOperators($operatorIds: [String!]!) {
    operators(where: { id_in: $operatorIds }) {
      id
      fee
      isPrivate
    }
  }
`;

export const getOperators = async (
  operatorIds: string[],
): Promise<LiveOperator[]> => {
  const uniqueOperatorIds = [...new Set(operatorIds)];
  const byId = new Map<string, LiveOperator>();

  try {
    const data = await querySSVSubgraph<GetOperatorsData>(GET_OPERATORS_QUERY, {
      operatorIds: uniqueOperatorIds,
    });

    for (const operator of data.operators) {
      byId.set(operator.id, {
        id: operator.id,
        fee: operator.fee,
        isPrivate: operator.isPrivate,
      });
    }
  } catch {
    // Continue with API fallback below.
  }

  const missingIds = uniqueOperatorIds.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    const apiOperators = await Promise.all(
      missingIds.map(async (id) => {
        const response = await querySSVApi<SsvApiOperator>(
          `/api/v4/${forecastConfig.ssvApiNetwork}/operators/${id}`,
        );
        return {
          id: String(response.id),
          fee: response.fee,
          isPrivate: response.is_private,
        } satisfies LiveOperator;
      }),
    );

    for (const operator of apiOperators) {
      byId.set(operator.id, operator);
    }
  }

  const resolved = operatorIds
    .map((id) => byId.get(id))
    .filter((operator): operator is LiveOperator => Boolean(operator));

  if (resolved.length !== operatorIds.length) {
    const available = new Set(resolved.map((operator) => operator.id));
    const missing = operatorIds.filter((id) => !available.has(id));
    throw new Error(`Missing operator data for operator IDs: ${missing.join(', ')}`);
  }

  return resolved;
};
