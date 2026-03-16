import { forecastConfig } from '@/lib/forecast-config';
import type { LiveCluster } from '@/lib/estimate/types';
import { querySSVApi, querySSVSubgraph } from '@/lib/ssv/client';

type SubgraphCluster = {
  id: string;
  operatorIds: string[];
  active: boolean;
  validatorCount: string;
};

type GetClustersSubgraphData = {
  clusters: SubgraphCluster[];
};

type SsvApiOwnerCluster = {
  clusterId: string;
  operators: number[];
  active?: boolean;
  validatorCount?: number;
};

type SsvApiOwnerClustersResponse = {
  clusters: SsvApiOwnerCluster[];
  pagination?: {
    pages?: number;
    page?: number;
  };
};

type SsvApiClusterEffectiveBalanceResponse = {
  clusterId: string;
  effectiveBalance: string; // gwei
};

type SsvApiValidatorsByClusterResponse = {
  pagination?: {
    total?: number;
  };
};

const GET_CLUSTERS_QUERY = `
  query GetClusters($owner: String!, $first: Int!, $skip: Int!) {
    clusters(where: { owner: $owner }, first: $first, skip: $skip) {
      id
      operatorIds
      active
      validatorCount
    }
  }
`;

const GWEI_PER_ETH = 1_000_000_000n;
const SUBGRAPH_PAGE_SIZE = 100;
const API_PAGE_SIZE = 100;
const BALANCE_FETCH_BATCH_SIZE = 10;
const CLUSTER_HASH_REGEX = /^0x[0-9a-f]{64}$/i;

type ClusterSeed = {
  clusterHash: string;
  operatorIds: string[];
  active: boolean;
  validatorCount: string;
};

const operatorSetKey = (operatorIds: string[]): string => {
  return [...operatorIds]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .join(',');
};

const isClusterHash = (value: string): boolean => CLUSTER_HASH_REGEX.test(value);

const gweiToEth = (gweiValue: string): string => {
  const gwei = BigInt(gweiValue);
  if (gwei < 0n) {
    throw new Error('Effective balance from SSV API must be non-negative');
  }

  const whole = gwei / GWEI_PER_ETH;
  const fraction = gwei % GWEI_PER_ETH;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`;
};

const isPositiveNumericString = (value: string): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const fetchClustersFromSubgraph = async (
  owner: string,
): Promise<SubgraphCluster[]> => {
  let skip = 0;
  const allClusters: SubgraphCluster[] = [];

  while (true) {
    const data = await querySSVSubgraph<GetClustersSubgraphData>(GET_CLUSTERS_QUERY, {
      owner,
      first: SUBGRAPH_PAGE_SIZE,
      skip,
    });

    allClusters.push(...data.clusters);

    if (data.clusters.length < SUBGRAPH_PAGE_SIZE) {
      break;
    }

    skip += SUBGRAPH_PAGE_SIZE;
  }

  return allClusters;
};

const fetchOwnerClustersFromApi = async (
  owner: string,
): Promise<SsvApiOwnerCluster[]> => {
  const allClusters: SsvApiOwnerCluster[] = [];
  let page = 1;
  let pages = 1;

  do {
    const response = await querySSVApi<SsvApiOwnerClustersResponse>(
      `/api/v4/${forecastConfig.ssvApiNetwork}/clusters/owner/${owner}`,
      { page, perPage: API_PAGE_SIZE },
    );

    allClusters.push(...(response.clusters || []));
    pages = response.pagination?.pages ?? page;
    page += 1;
  } while (page <= pages);

  return allClusters;
};

const fetchClusterEffectiveBalanceEth = async (
  clusterHash: string,
): Promise<string> => {
  const response = await querySSVApi<SsvApiClusterEffectiveBalanceResponse>(
    `/api/v4/${forecastConfig.ssvApiNetwork}/clusters/${clusterHash}/totalEffectiveBalance`,
  );

  if (!response?.effectiveBalance) {
    throw new Error(`Missing effective balance from SSV API for cluster ${clusterHash}`);
  }

  return gweiToEth(response.effectiveBalance);
};

const fetchClusterActiveValidatorsCount = async (
  clusterHash: string,
): Promise<string> => {
  const response = await querySSVApi<SsvApiValidatorsByClusterResponse>(
    `/api/v4/${forecastConfig.ssvApiNetwork}/validators`,
    {
      cluster: clusterHash,
      status: 'active',
      perPage: 1,
    },
  );

  const total = response.pagination?.total;
  if (total === undefined || total === null || !Number.isFinite(total) || total < 0) {
    throw new Error(
      `Missing active validator count from SSV API for cluster ${clusterHash}`,
    );
  }

  return Math.floor(total).toString();
};

const mapOperatorSetToClusterHash = (
  apiClusters: SsvApiOwnerCluster[],
): Map<string, string> => {
  const result = new Map<string, string>();
  for (const cluster of apiClusters) {
    const key = operatorSetKey(cluster.operators.map((id) => id.toString()));
    if (result.has(key)) {
      throw new Error(
        `Duplicate API cluster operator set detected for operators [${key}]`,
      );
    }
    result.set(key, cluster.clusterId);
  }
  return result;
};

const toApiClusterSeeds = (apiClusters: SsvApiOwnerCluster[]): ClusterSeed[] => {
  return apiClusters.map((cluster) => ({
    clusterHash: cluster.clusterId,
    operatorIds: cluster.operators.map((id) => id.toString()),
    active: cluster.active ?? true,
    validatorCount: String(cluster.validatorCount ?? 0),
  }));
};

const toSubgraphClusterSeeds = (
  subgraphClusters: SubgraphCluster[],
  operatorSetToClusterHash?: Map<string, string>,
): ClusterSeed[] => {
  return subgraphClusters.map((cluster) => {
    const key = operatorSetKey(cluster.operatorIds);
    const clusterHash =
      operatorSetToClusterHash?.get(key) ??
      (isClusterHash(cluster.id) ? cluster.id : undefined);
    if (!clusterHash) {
      throw new Error(
        `Could not match subgraph cluster to SSV API cluster for operators [${cluster.operatorIds.join(', ')}]`,
      );
    }
    return {
      clusterHash,
      operatorIds: cluster.operatorIds,
      active: cluster.active,
      validatorCount: cluster.validatorCount,
    };
  });
};

const attachApiClusterData = async (
  clusters: ClusterSeed[],
): Promise<
  Array<
    ClusterSeed & {
      clusterHash: string;
      effectiveBalanceEth: string;
      activeValidatorCount: string;
    }
  >
> => {
  const result: Array<
    ClusterSeed & {
      clusterHash: string;
      effectiveBalanceEth: string;
      activeValidatorCount: string;
    }
  > = [];

  for (let i = 0; i < clusters.length; i += BALANCE_FETCH_BATCH_SIZE) {
    const clusterBatch = clusters.slice(i, i + BALANCE_FETCH_BATCH_SIZE);

    const enriched = await Promise.all(
      clusterBatch.map(async (cluster) => {
        const [effectiveBalanceEth, activeValidatorCount] = await Promise.all([
          fetchClusterEffectiveBalanceEth(cluster.clusterHash),
          fetchClusterActiveValidatorsCount(cluster.clusterHash),
        ]);

        return {
          ...cluster,
          clusterHash: cluster.clusterHash,
          effectiveBalanceEth,
          activeValidatorCount,
        };
      }),
    );

    result.push(...enriched);
  }

  return result;
};

export const getClustersByOwner = async (owner: string): Promise<LiveCluster[]> => {
  const normalizedOwner = owner.toLowerCase();

  let subgraphClusters: SubgraphCluster[] = [];
  let subgraphError: Error | null = null;
  try {
    subgraphClusters = await fetchClustersFromSubgraph(normalizedOwner);
  } catch (error) {
    subgraphError = error instanceof Error ? error : new Error('Unknown subgraph error');
  }

  let apiOwnerClusters: SsvApiOwnerCluster[] = [];
  let apiError: Error | null = null;
  try {
    apiOwnerClusters = await fetchOwnerClustersFromApi(normalizedOwner);
  } catch (error) {
    apiError = error instanceof Error ? error : new Error('Unknown SSV API error');
  }

  if (subgraphClusters.length === 0 && apiOwnerClusters.length === 0) {
    if (subgraphError || apiError) {
      throw new Error(
        `Could not load clusters from upstream data sources. Subgraph: ${subgraphError?.message ?? 'n/a'} | SSV API: ${apiError?.message ?? 'n/a'}`,
      );
    }

    throw new Error('No clusters found for the given owner address');
  }

  const clusterSeeds = (() => {
    if (subgraphClusters.length === 0) {
      return toApiClusterSeeds(apiOwnerClusters);
    }

    try {
      const operatorSetToClusterHash =
        apiOwnerClusters.length > 0
          ? mapOperatorSetToClusterHash(apiOwnerClusters)
          : undefined;
      return toSubgraphClusterSeeds(subgraphClusters, operatorSetToClusterHash);
    } catch {
      if (apiOwnerClusters.length > 0) {
        return toApiClusterSeeds(apiOwnerClusters);
      }
      throw new Error(
        'Could not resolve cluster IDs from subgraph data for the given owner address',
      );
    }
  })();

  const clustersWithBalance = await attachApiClusterData(clusterSeeds);

  const estimableClusters = clustersWithBalance.filter(
    (cluster) =>
      isPositiveNumericString(cluster.effectiveBalanceEth) &&
      isPositiveNumericString(cluster.activeValidatorCount),
  );

  if (estimableClusters.length === 0) {
    throw new Error(
      'No estimable clusters found for this owner (all discovered clusters have zero effective balance or zero active validators).',
    );
  }

  return estimableClusters.map((cluster) => ({
    id: cluster.clusterHash,
    owner: normalizedOwner,
    operatorIds: cluster.operatorIds,
    effectiveBalance: cluster.effectiveBalanceEth,
    activeValidatorCount: cluster.activeValidatorCount,
    active: cluster.active,
    validatorCount: cluster.validatorCount,
  }));
};
