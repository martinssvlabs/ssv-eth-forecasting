import type { LiveOperator } from '@/lib/estimate/types';
import { querySSVSubgraph } from '@/lib/ssv/client';

type GetOperatorsData = {
  operators: Array<{
    id: string;
    fee: string;
    isPrivate: boolean;
  }>;
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
  const data = await querySSVSubgraph<GetOperatorsData>(GET_OPERATORS_QUERY, {
    operatorIds,
  });

  const byId = new Map(
    data.operators.map((operator) => [
      operator.id,
      {
        id: operator.id,
        fee: operator.fee,
        isPrivate: operator.isPrivate,
      },
    ]),
  );

  return operatorIds
    .map((id) => byId.get(id))
    .filter((operator): operator is LiveOperator => Boolean(operator));
};
