import { forecastConfig } from '@/lib/forecast-config';
import type {
  ClusterForecastInput,
  ForecastConfig,
  ForecastOverrides,
  LiveCluster,
  LiveOperator,
  OperatorFeeSelection,
} from '@/lib/estimate/types';

type BuildClusterForecastInputArgs = {
  cluster: LiveCluster;
  operators: LiveOperator[];
  runwayDays: number;
  operatorFeeSsvToEthRateWei: bigint;
  overrides?: ForecastOverrides;
  config?: ForecastConfig;
};

const WEI_PER_TOKEN = 10n ** 18n;

const parseOptionalBigInt = (
  value: string | undefined,
  fallback: bigint,
  fieldName: string,
): bigint => {
  if (!value || value.trim() === '') return fallback;

  try {
    const parsed = BigInt(value.trim());
    if (parsed < 0n) {
      throw new Error(`${fieldName} must be a non-negative integer`);
    }
    return parsed;
  } catch {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
};

const parseManualOperatorFee = (
  value: string | undefined,
  operatorId: string,
): bigint | undefined => {
  if (!value || value.trim() === '') return undefined;

  try {
    const parsed = BigInt(value.trim());
    if (parsed < 0n) {
      throw new Error(
        `manualOperatorFeesWeiById.${operatorId} must be a non-negative integer`,
      );
    }
    return parsed;
  } catch {
    throw new Error(
      `manualOperatorFeesWeiById.${operatorId} must be a non-negative integer`,
    );
  }
};

const resolveOperatorFeeSelection = (
  operator: LiveOperator,
  operatorFeeSsvToEthRateWei: bigint,
  manualOperatorFeeOverrideEnabled: boolean,
  manualOperatorFeesWeiById: Record<string, string> | undefined,
): OperatorFeeSelection => {
  const liveFeeSsvWeiPerBlock = BigInt(operator.fee);
  const liveFeeWei =
    (liveFeeSsvWeiPerBlock * operatorFeeSsvToEthRateWei) / WEI_PER_TOKEN;
  const manualFeeWei = manualOperatorFeeOverrideEnabled
    ? parseManualOperatorFee(manualOperatorFeesWeiById?.[operator.id], operator.id)
    : undefined;

  if (manualFeeWei !== undefined && manualFeeWei !== liveFeeWei) {
    return {
      operatorId: operator.id,
      isPrivate: operator.isPrivate,
      liveFeeWeiPerBlock: liveFeeWei,
      effectiveFeeWeiPerBlock: manualFeeWei,
      source: 'manual',
    };
  }

  if (operator.isPrivate && liveFeeWei === 0n) {
    return {
      operatorId: operator.id,
      isPrivate: operator.isPrivate,
      liveFeeWeiPerBlock: liveFeeWei,
      effectiveFeeWeiPerBlock: 0n,
      source: 'privateZeroFee',
    };
  }

  return {
    operatorId: operator.id,
    isPrivate: operator.isPrivate,
    liveFeeWeiPerBlock: liveFeeWei,
    effectiveFeeWeiPerBlock: liveFeeWei,
    source: 'live',
  };
};

const parseEffectiveBalance = (effectiveBalance: string): number => {
  const parsed = Number(effectiveBalance);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Cluster effective balance is invalid');
  }

  return parsed;
};

const findMissingOperatorIds = (
  expectedIds: string[],
  operators: LiveOperator[],
): string[] => {
  const available = new Set(operators.map((operator) => operator.id));
  return expectedIds.filter((id) => !available.has(id));
};

export const buildClusterForecastInput = ({
  cluster,
  operators,
  runwayDays,
  operatorFeeSsvToEthRateWei,
  overrides,
  config = forecastConfig,
}: BuildClusterForecastInputArgs): ClusterForecastInput => {
  const manualOperatorFeeOverrideEnabled =
    overrides?.manualOperatorFeeOverrideEnabled === true;

  const missingOperatorIds = findMissingOperatorIds(cluster.operatorIds, operators);
  if (missingOperatorIds.length > 0) {
    throw new Error(
      `Missing operator data for operator IDs: ${missingOperatorIds.join(', ')}`,
    );
  }

  const operatorsById = new Map(operators.map((operator) => [operator.id, operator]));
  const feeSelection = cluster.operatorIds.map((operatorId) => {
    const operator = operatorsById.get(operatorId);
    if (!operator) {
      throw new Error(`Missing operator data for operator ID: ${operatorId}`);
    }

    return resolveOperatorFeeSelection(
      operator,
      operatorFeeSsvToEthRateWei,
      manualOperatorFeeOverrideEnabled,
      overrides?.manualOperatorFeesWeiById,
    );
  });

  const operatorsFeeWeiPerBlock = feeSelection.reduce(
    (sum, item) => sum + item.effectiveFeeWeiPerBlock,
    0n,
  );

  return {
    clusterId: cluster.id,
    owner: cluster.owner,
    runwayDays,
    operatorIds: [...cluster.operatorIds],
    effectiveBalance: parseEffectiveBalance(cluster.effectiveBalance),
    operators: feeSelection,
    operatorsFeeWeiPerBlock,
    networkFeeWeiPerBlock: parseOptionalBigInt(
      overrides?.networkFeeWei,
      config.forecastEthNetworkFeeWei,
      'networkFeeWei',
    ),
    minimumLiquidationCollateralWei: parseOptionalBigInt(
      overrides?.minimumLiquidationCollateralWei,
      config.forecastMinimumLiquidationCollateralWei,
      'minimumLiquidationCollateralWei',
    ),
    liquidationThreshold: parseOptionalBigInt(
      overrides?.liquidationThreshold,
      config.forecastLiquidationThreshold,
      'liquidationThreshold',
    ),
    blocksPerDay: config.blocksPerDay,
    vUnitsPrecision: config.vUnitsPrecision,
  };
};
