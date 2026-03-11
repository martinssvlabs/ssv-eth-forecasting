import type {
  ClusterEstimateBreakdown,
  ClusterForecastInput,
} from '@/lib/estimate/types';

const bigintMax = (a: bigint, b: bigint): bigint => (a > b ? a : b);

const computeDailyAmount = (
  value: bigint,
  days: number,
  blocksPerDay: bigint,
): bigint => {
  const scale = 10 ** 6;
  // Keep SDK parity: BigInt(days * scale) truncates fractional micro-days.
  const scaledDays = BigInt(days * scale);

  return (value * scaledDays * blocksPerDay) / BigInt(scale);
};

const getValidatorUnits = (
  effectiveBalance: number,
  vUnitsPrecision: number,
): bigint => {
  const vUnits = (vUnitsPrecision * effectiveBalance) / 32;
  const computed = BigInt(Math.floor(vUnits / vUnitsPrecision));

  return computed || 1n;
};

// Mirrors the SDK calcDepositFromRunway formula but takes forecast-ready inputs.
export const computeDepositFromRunway = (
  input: ClusterForecastInput,
): ClusterEstimateBreakdown => {
  const validatorUnits = getValidatorUnits(
    input.effectiveBalance,
    input.vUnitsPrecision,
  );

  const burnRate =
    (input.operatorsFeeWeiPerBlock + input.networkFeeWeiPerBlock) *
      validatorUnits || 1n;

  const liquidationCollateral = bigintMax(
    input.minimumLiquidationCollateralWei,
    burnRate * input.liquidationThreshold,
  );

  const runwayFunding = computeDailyAmount(
    burnRate,
    input.runwayDays,
    input.blocksPerDay,
  );

  return {
    operatorFeeWeiPerBlock: input.operatorsFeeWeiPerBlock,
    networkFeeWeiPerBlock: input.networkFeeWeiPerBlock,
    burnRateWeiPerBlock: burnRate,
    validatorUnits,
    liquidationCollateralWei: liquidationCollateral,
    runwayFundingWei: runwayFunding,
    estimatedDepositWei: runwayFunding + liquidationCollateral,
  };
};
