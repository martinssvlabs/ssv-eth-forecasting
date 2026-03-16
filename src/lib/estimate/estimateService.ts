import { buildClusterForecastInput } from '@/lib/estimate/buildClusterForecastInput';
import { computeDepositFromRunway } from '@/lib/estimate/computeDepositFromRunway';
import { forecastConfig } from '@/lib/forecast-config';
import type {
  ClusterEstimateResponseItem,
  ClusterEstimateResult,
  EstimateResponse,
  ForecastDataSource,
  ForecastOverrides,
  LiveCluster,
  LiveOperator,
  SsvToEthRate,
} from '@/lib/estimate/types';
import { getClustersByOwner } from '@/lib/ssv/getClustersByOwner';
import { getOperators } from '@/lib/ssv/getOperators';
import { getSsvToEthRateWei } from '@/lib/ssv/getSsvToEthRateWei';

const OWNER_FETCH_CONCURRENCY = 4;

const defaultDataSource: ForecastDataSource = {
  getClustersByOwner,
  getOperators,
  getSsvToEthRateWei,
};

const parseNonNegativeBigInt = (
  value: string | undefined,
  fallback: bigint,
): bigint => {
  if (!value || value.trim() === '') return fallback;

  try {
    const parsed = BigInt(value.trim());
    if (parsed < 0n) {
      throw new Error('Override values must be non-negative integers');
    }
    return parsed;
  } catch {
    throw new Error('Override values must be non-negative integers');
  }
};

const toResponseCluster = (
  estimate: ClusterEstimateResult,
): ClusterEstimateResponseItem => ({
  clusterId: estimate.clusterId,
  owner: estimate.owner,
  runwayDays: estimate.runwayDays,
  operatorIds: estimate.operatorIds,
  effectiveBalance: estimate.effectiveBalance,
  activeValidatorCount: estimate.activeValidatorCount,
  validatorCount: estimate.validatorCount,
  breakdown: {
    operatorFeeWeiPerBlock: estimate.breakdown.operatorFeeWeiPerBlock.toString(),
    networkFeeWeiPerBlock: estimate.breakdown.networkFeeWeiPerBlock.toString(),
    burnRateWeiPerBlock: estimate.breakdown.burnRateWeiPerBlock.toString(),
    validatorUnits: estimate.breakdown.validatorUnits.toString(),
    liquidationCollateralWei: estimate.breakdown.liquidationCollateralWei.toString(),
    runwayFundingWei: estimate.breakdown.runwayFundingWei.toString(),
    estimatedDepositWei: estimate.breakdown.estimatedDepositWei.toString(),
  },
  feeSelection: estimate.feeSelection.map((item) => ({
    operatorId: item.operatorId,
    isPrivate: item.isPrivate,
    liveFeeWeiPerBlock: item.liveFeeWeiPerBlock.toString(),
    effectiveFeeWeiPerBlock: item.effectiveFeeWeiPerBlock.toString(),
    source: item.source,
  })),
});

const getClusterOperators = (
  cluster: LiveCluster,
  operatorsById: Map<string, LiveOperator>,
): LiveOperator[] => {
  return cluster.operatorIds.map((operatorId) => {
    const operator = operatorsById.get(operatorId);
    if (!operator) {
      throw new Error(`Missing operator data for operator ID: ${operatorId}`);
    }
    return operator;
  });
};

const estimateCluster = (
  cluster: LiveCluster,
  runwayDays: number,
  operatorFeeSsvToEthRateWei: bigint,
  overrides: ForecastOverrides | undefined,
  operatorsById: Map<string, LiveOperator>,
): ClusterEstimateResult => {
  const operators = getClusterOperators(cluster, operatorsById);

  const forecastInput = buildClusterForecastInput({
    cluster,
    operators,
    runwayDays,
    operatorFeeSsvToEthRateWei,
    overrides,
  });

  const breakdown = computeDepositFromRunway(forecastInput);

  return {
    clusterId: cluster.id,
    owner: cluster.owner,
    runwayDays,
    operatorIds: cluster.operatorIds,
    effectiveBalance: cluster.effectiveBalance,
    activeValidatorCount: cluster.activeValidatorCount ?? cluster.validatorCount,
    validatorCount: cluster.validatorCount,
    breakdown,
    feeSelection: forecastInput.operators,
  };
};

const resolveConfigUsed = (
  overrides: ForecastOverrides | undefined,
  clusters: ClusterEstimateResult[],
  operatorFeeSsvToEthRate: SsvToEthRate,
) => {
  const manualOperatorIds = new Set<string>();
  for (const cluster of clusters) {
    for (const item of cluster.feeSelection) {
      if (item.source === 'manual') {
        manualOperatorIds.add(item.operatorId);
      }
    }
  }
  const operatorFeeSource: 'live' | 'manualOverride' =
    manualOperatorIds.size > 0 ? 'manualOverride' : 'live';

  return {
    networkFeeWei: parseNonNegativeBigInt(
      overrides?.networkFeeWei,
      forecastConfig.forecastEthNetworkFeeWei,
    ).toString(),
    minimumLiquidationCollateralWei: parseNonNegativeBigInt(
      overrides?.minimumLiquidationCollateralWei,
      forecastConfig.forecastMinimumLiquidationCollateralWei,
    ).toString(),
    liquidationThreshold: parseNonNegativeBigInt(
      overrides?.liquidationThreshold,
      forecastConfig.forecastLiquidationThreshold,
    ).toString(),
    blocksPerDay: forecastConfig.blocksPerDay.toString(),
    operatorFeeSsvToEthRateWei: operatorFeeSsvToEthRate.rateWei.toString(),
    operatorFeeSsvToEthRateSource: operatorFeeSsvToEthRate.source,
    operatorFeeSsvToEthRateFetchedAtUnix: operatorFeeSsvToEthRate.fetchedAtUnix,
    operatorFeeSsvToEthRateStale: operatorFeeSsvToEthRate.stale,
    operatorFeeSource,
    manualOperatorOverridesCount: manualOperatorIds.size,
    assumptionsLabel: forecastConfig.assumptionsLabel,
  };
};

const toEstimateResponse = (
  runwayDays: number,
  clusters: ClusterEstimateResult[],
  operatorFeeSsvToEthRate: SsvToEthRate,
  overrides: ForecastOverrides | undefined,
  ownerSummary: {
    ownersRequested: string[];
    ownersSucceeded: string[];
    failedOwners: Array<{
      ownerAddress: string;
      error: string;
    }>;
  },
): EstimateResponse => {
  const total = clusters.reduce(
    (sum, item) => sum + item.breakdown.estimatedDepositWei,
    0n,
  );

  const mode = ownerSummary.ownersRequested.length > 1 ? 'ownerBatch' : 'owner';

  return {
    mode,
    runwayDays,
    clusters: clusters.map(toResponseCluster),
    totalEstimatedDepositWei: total.toString(),
    ownersRequested: ownerSummary.ownersRequested,
    ownersSucceeded: ownerSummary.ownersSucceeded,
    failedOwners: ownerSummary.failedOwners,
    configUsed: resolveConfigUsed(overrides, clusters, operatorFeeSsvToEthRate),
    disclaimer: forecastConfig.disclaimerText,
  };
};

const normalizeOwners = (ownerAddresses: string[]): string[] => {
  const normalized = ownerAddresses
    .map((owner) => owner.trim().toLowerCase())
    .filter((owner) => owner.length > 0);

  return [...new Set(normalized)];
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index]);
    }
  };

  await Promise.all(Array.from({ length: limit }, runWorker));
  return results;
};

type OwnerClustersSuccess = {
  owner: string;
  clusters: LiveCluster[];
};

type OwnerClustersFailure = {
  owner: string;
  error: string;
};

const toSafeOwnerLoadError = (message: string): string => {
  if (
    message.includes('No clusters found') ||
    message.includes('No estimable clusters found')
  ) {
    return message;
  }

  return 'Could not load this owner from upstream data sources';
};

const loadOwnerClusters = async (
  owner: string,
  dataSource: ForecastDataSource,
): Promise<OwnerClustersSuccess | OwnerClustersFailure> => {
  try {
    const clusters = await dataSource.getClustersByOwner(owner);
    if (clusters.length === 0) {
      return {
        owner,
        error: 'No clusters found for the given owner address',
      };
    }
    return {
      owner,
      clusters,
    };
  } catch (error) {
    const rawMessage =
      error instanceof Error
        ? error.message
        : 'Unknown error while loading owner clusters';

    return {
      owner,
      error: toSafeOwnerLoadError(rawMessage),
    };
  }
};

export const estimateByOwnerAddresses = async (
  ownerAddresses: string[],
  runwayDays: number,
  overrides?: ForecastOverrides,
  dataSource: ForecastDataSource = defaultDataSource,
): Promise<EstimateResponse> => {
  const normalizedOwners = normalizeOwners(ownerAddresses);
  if (normalizedOwners.length === 0) {
    throw new Error('At least one owner address is required');
  }

  const operatorFeeSsvToEthRate = await dataSource.getSsvToEthRateWei();
  if (operatorFeeSsvToEthRate.rateWei <= 0n) {
    throw new Error('Invalid SSV to ETH conversion rate');
  }

  const ownerClusterResults = await mapWithConcurrency(
    normalizedOwners,
    OWNER_FETCH_CONCURRENCY,
    async (owner) => loadOwnerClusters(owner, dataSource),
  );

  const successfulOwners = ownerClusterResults.filter(
    (item): item is OwnerClustersSuccess => 'clusters' in item,
  );
  const failedOwners = ownerClusterResults
    .filter((item): item is OwnerClustersFailure => 'error' in item)
    .map((item) => ({
      ownerAddress: item.owner,
      error: item.error,
    }));

  if (successfulOwners.length === 0) {
    const reason = failedOwners[0]?.error ?? 'No clusters found for given owner address(es)';
    throw new Error(reason);
  }

  const clusters = successfulOwners.flatMap((item) =>
    item.clusters.map((cluster) => ({
      ...cluster,
      owner: cluster.owner ?? item.owner,
    })),
  );

  const uniqueOperatorIds = [...new Set(clusters.flatMap((cluster) => cluster.operatorIds))];
  const operators = await dataSource.getOperators(uniqueOperatorIds);
  const operatorsById = new Map(operators.map((operator) => [operator.id, operator]));

  const missingOperatorIds = uniqueOperatorIds.filter(
    (operatorId) => !operatorsById.has(operatorId),
  );
  if (missingOperatorIds.length > 0) {
    throw new Error(
      `Missing operator data for operator IDs: ${missingOperatorIds.join(', ')}`,
    );
  }

  const estimates = clusters.map((cluster) =>
    estimateCluster(
      cluster,
      runwayDays,
      operatorFeeSsvToEthRate.rateWei,
      overrides,
      operatorsById,
    ),
  );

  return toEstimateResponse(
    runwayDays,
    estimates,
    operatorFeeSsvToEthRate,
    overrides,
    {
      ownersRequested: normalizedOwners,
      ownersSucceeded: successfulOwners.map((item) => item.owner),
      failedOwners,
    },
  );
};

export const estimateByOwnerAddress = async (
  owner: string,
  runwayDays: number,
  overrides?: ForecastOverrides,
  dataSource: ForecastDataSource = defaultDataSource,
): Promise<EstimateResponse> => {
  return estimateByOwnerAddresses([owner], runwayDays, overrides, dataSource);
};
