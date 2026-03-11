import type { LiveCluster } from '@/lib/estimate/types';
import { querySSVSubgraph } from '@/lib/ssv/client';

type GetClustersData = {
  clusters: Array<{
    id: string;
    operatorIds: string[];
    effectiveBalance: string;
    active: boolean;
    validatorCount: string;
  }>;
};

const GET_CLUSTERS_QUERY = `
  query GetClusters($owner: String!, $first: Int!, $skip: Int!) {
    clusters(where: { owner: $owner }, first: $first, skip: $skip) {
      id
      operatorIds
      effectiveBalance
      active
      validatorCount
    }
  }
`;

export const getClustersByOwner = async (owner: string): Promise<LiveCluster[]> => {
  const normalizedOwner = owner.toLowerCase();
  const pageSize = 100;
  let skip = 0;
  const allClusters: GetClustersData['clusters'] = [];

  while (true) {
    const data = await querySSVSubgraph<GetClustersData>(GET_CLUSTERS_QUERY, {
      owner: normalizedOwner,
      first: pageSize,
      skip,
    });

    allClusters.push(...data.clusters);

    if (data.clusters.length < pageSize) {
      break;
    }

    skip += pageSize;
  }

  return allClusters.map((cluster) => ({
    id: cluster.id,
    owner: normalizedOwner,
    operatorIds: cluster.operatorIds,
    effectiveBalance: cluster.effectiveBalance,
    active: cluster.active,
    validatorCount: cluster.validatorCount,
  }));
};
