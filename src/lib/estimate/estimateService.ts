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
} from '@/lib/estimate/types';
import { getClustersByOwner } from '@/lib/ssv/getClustersByOwner';
import { getOperators } from '@/lib/ssv/getOperators';

const defaultDataSource: ForecastDataSource = {
  getClustersByOwner,
  getOperators,
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

const estimateCluster = async (
  cluster: LiveCluster,
  runwayDays: number,
  overrides: ForecastOverrides | undefined,
  dataSource: ForecastDataSource,
): Promise<ClusterEstimateResult> => {
  const operators = await dataSource.getOperators(cluster.operatorIds);

  const forecastInput = buildClusterForecastInput({
    cluster,
    operators,
    runwayDays,
    overrides,
  });

  const breakdown = computeDepositFromRunway(forecastInput);

  return {
    clusterId: cluster.id,
    owner: cluster.owner,
    runwayDays,
    operatorIds: cluster.operatorIds,
    effectiveBalance: cluster.effectiveBalance,
    validatorCount: cluster.validatorCount,
    breakdown,
    feeSelection: forecastInput.operators,
  };
};

const resolveConfigUsed = (
  overrides: ForecastOverrides | undefined,
  clusters: ClusterEstimateResult[],
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
    operatorFeeSource,
    manualOperatorOverridesCount: manualOperatorIds.size,
    assumptionsLabel: forecastConfig.assumptionsLabel,
  };
};

const toEstimateResponse = (
  runwayDays: number,
  clusters: ClusterEstimateResult[],
  overrides: ForecastOverrides | undefined,
): EstimateResponse => {
  const total = clusters.reduce(
    (sum, item) => sum + item.breakdown.estimatedDepositWei,
    0n,
  );

  return {
    mode: 'owner',
    runwayDays,
    clusters: clusters.map(toResponseCluster),
    totalEstimatedDepositWei: total.toString(),
    configUsed: resolveConfigUsed(overrides, clusters),
    disclaimer: forecastConfig.disclaimerText,
  };
};

export const estimateByOwnerAddress = async (
  owner: string,
  runwayDays: number,
  overrides?: ForecastOverrides,
  dataSource: ForecastDataSource = defaultDataSource,
): Promise<EstimateResponse> => {
  const clusters = await dataSource.getClustersByOwner(owner);

  if (clusters.length === 0) {
    throw new Error('No clusters found for the given owner address');
  }

  const estimates = await Promise.all(
    clusters.map((cluster) =>
      estimateCluster(cluster, runwayDays, overrides, dataSource),
    ),
  );

  return toEstimateResponse(runwayDays, estimates, overrides);
};
