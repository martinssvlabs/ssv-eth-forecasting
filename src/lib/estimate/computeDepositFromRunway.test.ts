import { describe, expect, it } from 'vitest';
import { buildClusterForecastInput } from '@/lib/estimate/buildClusterForecastInput';
import { computeDepositFromRunway } from '@/lib/estimate/computeDepositFromRunway';

describe('computeDepositFromRunway', () => {
  it('handles a private zero-fee cluster', () => {
    const input = buildClusterForecastInput({
      cluster: {
        id: '0x1111111111111111111111111111111111111111111111111111111111111111',
        operatorIds: ['1', '2', '3', '4'],
        effectiveBalance: '32',
        active: true,
        validatorCount: '1',
      },
      operators: [
        { id: '1', fee: '0', isPrivate: true },
        { id: '2', fee: '0', isPrivate: true },
        { id: '3', fee: '0', isPrivate: true },
        { id: '4', fee: '0', isPrivate: true },
      ],
      runwayDays: 365,
      operatorFeeSsvToEthRateWei: 1000000000000000000n,
      overrides: {
        networkFeeWei: '1000000000',
        minimumLiquidationCollateralWei: '1000000000000000000',
        liquidationThreshold: '214800',
      },
    });

    const breakdown = computeDepositFromRunway(input);

    expect(breakdown.operatorFeeWeiPerBlock).toBe(0n);
    expect(breakdown.networkFeeWeiPerBlock).toBe(1000000000n);
    expect(breakdown.validatorUnits).toBe(1n);
    expect(breakdown.burnRateWeiPerBlock).toBe(1000000000n);
    expect(breakdown.liquidationCollateralWei).toBe(1000000000000000000n);
    expect(breakdown.runwayFundingWei).toBe(2613400000000000n);
    expect(breakdown.estimatedDepositWei).toBe(1002613400000000000n);
  });

  it('handles live public operator fees', () => {
    const input = buildClusterForecastInput({
      cluster: {
        id: '0x2222222222222222222222222222222222222222222222222222222222222222',
        operatorIds: ['10', '11', '12', '13'],
        effectiveBalance: '64',
        active: true,
        validatorCount: '2',
      },
      operators: [
        { id: '10', fee: '1000000000', isPrivate: false },
        { id: '11', fee: '1000000000', isPrivate: false },
        { id: '12', fee: '1000000000', isPrivate: false },
        { id: '13', fee: '1000000000', isPrivate: false },
      ],
      runwayDays: 30,
      operatorFeeSsvToEthRateWei: 1000000000000000000n,
      overrides: {
        networkFeeWei: '1000000000',
        minimumLiquidationCollateralWei: '1000000000000000000',
        liquidationThreshold: '214800',
      },
    });

    const breakdown = computeDepositFromRunway(input);

    expect(breakdown.operatorFeeWeiPerBlock).toBe(4000000000n);
    expect(breakdown.validatorUnits).toBe(2n);
    expect(breakdown.burnRateWeiPerBlock).toBe(10000000000n);
    expect(breakdown.runwayFundingWei).toBe(2148000000000000n);
    expect(breakdown.estimatedDepositWei).toBe(1002148000000000000n);
  });
});
