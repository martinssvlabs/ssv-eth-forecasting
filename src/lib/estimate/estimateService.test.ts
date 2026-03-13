import { describe, expect, it } from 'vitest';
import { estimateByOwnerAddress } from '@/lib/estimate/estimateService';
import type { ForecastDataSource } from '@/lib/estimate/types';

const mockDataSource: ForecastDataSource = {
  async getClustersByOwner(owner: string) {
    return [
      {
        id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        owner,
        operatorIds: ['1', '2', '3', '4'],
        effectiveBalance: '32',
        active: true,
        validatorCount: '1',
      },
      {
        id: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        owner,
        operatorIds: ['10', '11', '12', '13'],
        effectiveBalance: '64',
        active: true,
        validatorCount: '2',
      },
    ];
  },
  async getOperators(operatorIds: string[]) {
    if (operatorIds[0] === '1') {
      return operatorIds.map((id) => ({ id, fee: '0', isPrivate: true }));
    }

    return operatorIds.map((id) => ({ id, fee: '1000000000', isPrivate: false }));
  },
  async getSsvToEthRateWei() {
    return {
      rateWei: 1000000000000000000n,
      source: 'env_override' as const,
      fetchedAtUnix: 1_773_419_830,
      stale: false,
    };
  },
};

describe('estimateByOwnerAddress', () => {
  it('uses the corrected ETH liquidation defaults when no overrides are provided', async () => {
    const result = await estimateByOwnerAddress(
      '0x000000000000000000000000000000000000dead',
      30,
      undefined,
      mockDataSource,
    );

    expect(result.configUsed.minimumLiquidationCollateralWei).toBe('644900000000000');
    expect(result.configUsed.liquidationThreshold).toBe('21480');
    expect(result.clusters[0].breakdown.liquidationCollateralWei).toBe(
      '644900000000000',
    );
    expect(result.clusters[1].breakdown.liquidationCollateralWei).toBe(
      '644900000000000',
    );
    expect(result.totalEstimatedDepositWei).toBe('5301350684791600');
  });

  it('aggregates estimates across multiple clusters', async () => {
    const result = await estimateByOwnerAddress(
      '0x000000000000000000000000000000000000dead',
      30,
      {
        networkFeeWei: '1000000000',
        minimumLiquidationCollateralWei: '1000000000000000000',
        liquidationThreshold: '214800',
      },
      mockDataSource,
    );

    expect(result.mode).toBe('owner');
    expect(result.clusters).toHaveLength(2);

    const first = result.clusters[0];
    const second = result.clusters[1];

    expect(first.validatorCount).toBe('1');
    expect(second.validatorCount).toBe('2');
    expect(first.breakdown.estimatedDepositWei).toBe('1000214800000000000');
    expect(second.breakdown.estimatedDepositWei).toBe('1002148000000000000');
    expect(result.totalEstimatedDepositWei).toBe('2002362800000000000');
  });

  it('applies manual operator fee overrides only when enabled', async () => {
    const result = await estimateByOwnerAddress(
      '0x000000000000000000000000000000000000dead',
      30,
      {
        networkFeeWei: '1000000000',
        minimumLiquidationCollateralWei: '1000000000000000000',
        liquidationThreshold: '214800',
        manualOperatorFeeOverrideEnabled: true,
        manualOperatorFeesWeiById: {
          '1': '1000000000',
          '2': '1000000000',
          '3': '1000000000',
          '4': '1000000000',
          '10': '1000000000',
          '11': '1000000000',
          '12': '1000000000',
          '13': '1000000000',
        },
      },
      mockDataSource,
    );

    const first = result.clusters[0];
    const second = result.clusters[1];

    expect(first.breakdown.estimatedDepositWei).toBe('1001074000000000000');
    expect(second.breakdown.estimatedDepositWei).toBe('1002148000000000000');
    expect(result.totalEstimatedDepositWei).toBe('2003222000000000000');
    expect(result.configUsed.operatorFeeSource).toBe('manualOverride');
    expect(result.configUsed.manualOperatorOverridesCount).toBe(4);
    expect(result.configUsed.operatorFeeSsvToEthRateSource).toBe('env_override');
    expect(result.configUsed.operatorFeeSsvToEthRateStale).toBe(false);
    expect(first.feeSelection.every((item) => item.source === 'manual')).toBe(true);
    expect(second.feeSelection.every((item) => item.source === 'live')).toBe(true);
  });
});
