'use client';

import type { EstimateResponse } from '@/lib/estimate/types';
import { formatEther, formatUnits } from 'viem';
import styles from './EstimateResults.module.css';

type EstimateResultsProps = {
  result: EstimateResponse | null;
  loading: boolean;
  error: string | null;
};

const formatEth = (valueWei: string, maximumFractionDigits = 6): string => {
  const eth = formatEther(BigInt(valueWei));
  const asNumber = Number(eth);

  if (!Number.isFinite(asNumber)) {
    return eth;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(asNumber);
};

const formatGwei = (valueWei: string, maximumFractionDigits = 4): string => {
  const gwei = formatUnits(BigInt(valueWei), 9);
  const asNumber = Number(gwei);

  if (!Number.isFinite(asNumber)) {
    return gwei;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(asNumber);
};

const formatInteger = (value: string): string => {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) {
    return value;
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(asNumber);
};

const sourceLabelMap: Record<
  EstimateResponse['clusters'][number]['feeSelection'][number]['source'],
  string
> = {
  privateZeroFee: 'private zero',
  live: 'live',
  manual: 'manual override',
};

const healthCheckFromTotal = (totalWei: string) => {
  const totalEth = Number(formatEther(BigInt(totalWei)));

  if (!Number.isFinite(totalEth)) {
    return {
      tone: 'neutral' as const,
      message: 'Estimate computed. Review the breakdown details before migration.',
    };
  }

  if (totalEth < 0.05) {
    return {
      tone: 'warning' as const,
      message:
        'Very low estimate detected. Recheck owner address, operator fees, and forecast assumptions.',
    };
  }

  if (totalEth > 30) {
    return {
      tone: 'warning' as const,
      message:
        'High estimate detected. Confirm runway length and fee assumptions before planning funding.',
    };
  }

  return {
    tone: 'ok' as const,
    message: 'Estimate is in a typical range for many clusters. Still treat as forecast-only.',
  };
};

const InfoTooltip = ({ text }: { text: string }) => {
  return (
    <span className={styles.infoTooltip} tabIndex={0} aria-label={text}>
      i
      <span role="tooltip" className={styles.infoTooltipContent}>
        {text}
      </span>
    </span>
  );
};

const BreakdownCard = ({
  cluster,
  configUsed,
}: {
  cluster: EstimateResponse['clusters'][number];
  configUsed: EstimateResponse['configUsed'];
}) => {
  const blocksPerDay = BigInt(configUsed.blocksPerDay);
  const blocksPerYear = blocksPerDay * 365n;
  const validatorUnits = BigInt(cluster.breakdown.validatorUnits);
  const operatorFeeWeiPerBlock = BigInt(cluster.breakdown.operatorFeeWeiPerBlock);
  const networkFeeWeiPerBlock = BigInt(cluster.breakdown.networkFeeWeiPerBlock);
  const burnRateWeiPerBlock = BigInt(cluster.breakdown.burnRateWeiPerBlock);
  const burnRateWeiPerDay = burnRateWeiPerBlock * blocksPerDay;
  const burnRateWeiPerYear = burnRateWeiPerDay * 365n;
  const operatorCostWeiPerYear =
    operatorFeeWeiPerBlock * validatorUnits * blocksPerYear;
  const networkCostWeiPerYear =
    networkFeeWeiPerBlock * validatorUnits * blocksPerYear;

  return (
    <article className={styles.breakdownCard}>
      <div className={styles.cardHeader}>
        <h4>Cluster {cluster.clusterId}</h4>
      </div>

      <dl className={styles.primaryGrid}>
        <div>
          <dt>Total estimated deposit for selected runway</dt>
          <dd>{formatEth(cluster.breakdown.estimatedDepositWei)} ETH</dd>
        </div>
        <div>
          <dt>Runway funding for selected period</dt>
          <dd>{formatEth(cluster.breakdown.runwayFundingWei)} ETH</dd>
        </div>
        <div>
          <dt>Collateral requirement</dt>
          <dd>{formatEth(cluster.breakdown.liquidationCollateralWei)} ETH</dd>
        </div>
      </dl>

      <dl className={styles.operationalGrid}>
        <div>
          <dt>Validators in cluster</dt>
          <dd>{formatInteger(cluster.validatorCount)}</dd>
        </div>
        <div>
          <dt>Validator units used</dt>
          <dd>{formatInteger(cluster.breakdown.validatorUnits)}</dd>
        </div>
        <div>
          <dt>Operator cost</dt>
          <dd>{formatEth(operatorCostWeiPerYear.toString(), 8)} ETH/year</dd>
        </div>
        <div>
          <dt>Network cost</dt>
          <dd>{formatEth(networkCostWeiPerYear.toString(), 8)} ETH/year</dd>
        </div>
        <div>
          <dt>Burn rate</dt>
          <dd>{formatEth(burnRateWeiPerDay.toString(), 8)} ETH/day</dd>
        </div>
        <div>
          <dt>Burn</dt>
          <dd>{formatEth(burnRateWeiPerYear.toString(), 6)} ETH/year</dd>
        </div>
      </dl>

      <details className={styles.protocolBox}>
        <summary>Technical details</summary>
        <ul>
          <li>Operator fee sum: {formatGwei(cluster.breakdown.operatorFeeWeiPerBlock)} gwei/block</li>
          <li>Network fee: {formatGwei(cluster.breakdown.networkFeeWeiPerBlock)} gwei/block</li>
          <li>Burn rate: {formatGwei(cluster.breakdown.burnRateWeiPerBlock)} gwei/block</li>
          <li>Liquidation threshold: {configUsed.liquidationThreshold} blocks</li>
          <li>Blocks/day assumption: {configUsed.blocksPerDay}</li>
          <li>Validator units used internally: {cluster.breakdown.validatorUnits}</li>
        </ul>

        <div className={styles.sourceSection}>
          <h5>Operator fee sources</h5>
          <div className={styles.sourceList}>
            {cluster.feeSelection.map((item) => (
              <div key={item.operatorId} className={styles.sourceRow}>
                <span className={styles.sourceOperator}>Operator {item.operatorId}</span>
                <span
                  className={`${styles.sourceBadge} ${styles[`source_${item.source}`]}`}
                >
                  {sourceLabelMap[item.source]}
                </span>
                <span className={styles.sourceFee}>
                  {formatGwei(item.effectiveFeeWeiPerBlock)} gwei/block
                </span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </article>
  );
};

export function EstimateResults({ result, loading, error }: EstimateResultsProps) {
  if (loading) {
    return (
      <section className={styles.panel}>
        <p className={styles.stateText}>Calculating estimates from live mainnet state...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.errorTitle}>Could not calculate estimate</h3>
        <p className={styles.errorText}>{error}</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.emptyTitle}>No estimate yet</h3>
        <p className={styles.stateText}>
          Provide an owner address, then click Calculate estimate.
        </p>
      </section>
    );
  }

  const health = healthCheckFromTotal(result.totalEstimatedDepositWei);
  const thresholdBlocks = BigInt(result.configUsed.liquidationThreshold);
  const blocksPerDay = BigInt(result.configUsed.blocksPerDay);
  const blocksPerYear = blocksPerDay * 365n;
  const thresholdDaysEquivalent =
    Number(thresholdBlocks) / Number(blocksPerDay || 1n);
  const networkFeeWeiPerYearPerUnit = (
    BigInt(result.configUsed.networkFeeWei) * blocksPerYear
  ).toString();
  const summaryTooltipText = `Burn is the ongoing operating cost of running the cluster. Collateral is not burned; it is the required balance buffer to avoid liquidation. Total estimated deposit = runway funding + collateral requirement. Minimum collateral floor: ${formatEth(result.configUsed.minimumLiquidationCollateralWei)} ETH.`;
  const manualModeActive = result.configUsed.operatorFeeSource === 'manualOverride';
  const yearlyTotals = result.clusters.reduce(
    (acc, cluster) => {
      const validatorUnits = BigInt(cluster.breakdown.validatorUnits);
      acc.operator +=
        BigInt(cluster.breakdown.operatorFeeWeiPerBlock) *
        validatorUnits *
        blocksPerYear;
      acc.network +=
        BigInt(cluster.breakdown.networkFeeWeiPerBlock) *
        validatorUnits *
        blocksPerYear;
      acc.runwayFunding += BigInt(cluster.breakdown.runwayFundingWei);
      acc.collateral += BigInt(cluster.breakdown.liquidationCollateralWei);
      return acc;
    },
    { operator: 0n, network: 0n, runwayFunding: 0n, collateral: 0n },
  );

  return (
    <section className={styles.panel}>
      <div className={`${styles.healthBanner} ${styles[`health_${health.tone}`]}`}>
        {health.message}
      </div>

      <div className={styles.summary}>
        <h3 className={styles.summaryTitle}>
          Estimate Summary
          <InfoTooltip text={summaryTooltipText} />
        </h3>
        <p>
          Total estimated deposit required:{' '}
          <strong>{formatEth(result.totalEstimatedDepositWei)} ETH</strong>
        </p>
        <div className={styles.yearlySummary}>
          <p>
            Operator cost: {formatEth(yearlyTotals.operator.toString(), 8)} ETH/year
          </p>
          <p>
            Network cost: {formatEth(yearlyTotals.network.toString(), 8)} ETH/year
          </p>
          <p>
            Runway funding for selected period:{' '}
            {formatEth(yearlyTotals.runwayFunding.toString(), 8)} ETH
          </p>
          <p>
            Collateral requirement: {formatEth(yearlyTotals.collateral.toString(), 8)} ETH
          </p>
        </div>
        {manualModeActive ? (
          <p className={styles.manualModeTag}>
            Manual operator fee override is active ({result.configUsed.manualOperatorOverridesCount}{' '}
            operators overridden).
          </p>
        ) : null}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Cluster ID</th>
              <th>Validators</th>
              <th>Runway</th>
              <th>Estimate</th>
            </tr>
          </thead>
          <tbody>
            {result.clusters.map((cluster) => (
              <tr key={cluster.clusterId}>
                <td className={styles.code}>{cluster.clusterId}</td>
                <td>{formatInteger(cluster.validatorCount)}</td>
                <td>{cluster.runwayDays} days</td>
                <td>{formatEth(cluster.breakdown.estimatedDepositWei)} ETH</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        {result.clusters.map((cluster) => (
          <BreakdownCard
            key={cluster.clusterId}
            cluster={cluster}
            configUsed={result.configUsed}
          />
        ))}
      </div>

      <details className={styles.configBox}>
        <summary>Assumptions used</summary>
        <ul>
          <li>
            Operator fee source:{' '}
            {manualModeActive
              ? `manual override (${result.configUsed.manualOperatorOverridesCount} operators)`
              : 'live operator data from mainnet subgraph'}
          </li>
          <li>
            Forecast network fee assumption:{' '}
            {formatEth(networkFeeWeiPerYearPerUnit, 9)} ETH/year per validator
          </li>
          <li>
            Minimum liquidation collateral: {formatEth(result.configUsed.minimumLiquidationCollateralWei)} ETH
          </li>
          <li>
            Liquidation threshold: {new Intl.NumberFormat('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            }).format(thresholdDaysEquivalent)} days equivalent ({result.configUsed.liquidationThreshold} blocks)
          </li>
          <li>Blocks/day assumption: {result.configUsed.blocksPerDay}</li>
          <li>Assumptions profile: {result.configUsed.assumptionsLabel}</li>
        </ul>
      </details>

      <section className={styles.checklistBox}>
        <h4>Migration Notes</h4>
        <ul>
          <li>This output is forecast-only and not a binding on-chain quote.</li>
          <li>Final required ETH can change if fee or collateral assumptions change before activation.</li>
          <li>Verify operator fees before migration, especially in manual override mode.</li>
          <li>Migration is one-way. Confirm assumptions before execution planning.</li>
        </ul>
      </section>
    </section>
  );
}
