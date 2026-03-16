'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { EstimateResponse } from '@/lib/estimate/types';
import { formatEther, formatUnits } from 'viem';
import styles from './EstimateResults.module.css';

type EstimateResultsProps = {
  result: EstimateResponse | null;
  loading: boolean;
  error: string | null;
};

type OwnerGroup = {
  owner: string;
  clusters: EstimateResponse['clusters'];
  subtotalEstimatedWei: bigint;
};

const SUMMARY_DECIMALS = 4;
const DETAIL_DECIMALS = 4;
const DAILY_RATE_DECIMALS = 6;

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

const formatBalanceEth = (value: string): string => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(parsed);
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

const formatDays = (days: number): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(days);
};

const toClusterExplorerUrl = (clusterId: string): string =>
  `https://explorer.ssv.network/mainnet/cluster/${clusterId}`;

const shortenClusterId = (clusterId: string): string => {
  if (clusterId.length <= 22) return clusterId;
  return `${clusterId.slice(0, 10)}...${clusterId.slice(-8)}`;
};

const shortenOwnerAddress = (ownerAddress: string): string => {
  if (ownerAddress.length <= 20) return ownerAddress;
  return `${ownerAddress.slice(0, 8)}...${ownerAddress.slice(-6)}`;
};

const rateSourceLabel: Record<
  EstimateResponse['configUsed']['operatorFeeSsvToEthRateSource'],
  string
> = {
  env_override: 'configured override',
  coingecko: 'CoinGecko',
  binance_derived: 'Binance (derived pair)',
};

const formatUnixTime = (unixSeconds: number): string => {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return 'n/a';
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(new Date(unixSeconds * 1000));
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

const SectionHeader = ({
  sectionNumber,
  title,
}: {
  sectionNumber: string;
  title: string;
}) => (
  <div className={styles.sectionHeader}>
    <p className={styles.sectionEyebrow}>Section {sectionNumber}</p>
    <h3>{title}</h3>
  </div>
);

const sortClustersForDisplay = (
  clusters: EstimateResponse['clusters'],
): EstimateResponse['clusters'] => {
  return [...clusters].sort((a, b) => {
    if ((a.owner ?? '') !== (b.owner ?? '')) {
      return (a.owner ?? '').localeCompare(b.owner ?? '');
    }
    const aWei = BigInt(a.breakdown.estimatedDepositWei);
    const bWei = BigInt(b.breakdown.estimatedDepositWei);
    if (aWei === bWei) return 0;
    return aWei > bWei ? -1 : 1;
  });
};

const buildOwnerGroups = (
  clusters: EstimateResponse['clusters'],
): OwnerGroup[] => {
  const sortedClusters = sortClustersForDisplay(clusters);
  const groups = new Map<string, EstimateResponse['clusters']>();

  for (const cluster of sortedClusters) {
    const owner = cluster.owner ?? 'unknown';
    const current = groups.get(owner) ?? [];
    current.push(cluster);
    groups.set(owner, current);
  }

  return Array.from(groups.entries()).map(([owner, groupedClusters]) => ({
    owner,
    clusters: groupedClusters,
    subtotalEstimatedWei: groupedClusters.reduce(
      (sum, cluster) => sum + BigInt(cluster.breakdown.estimatedDepositWei),
      0n,
    ),
  }));
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
        <h4>
          Cluster{' '}
          <a
            href={toClusterExplorerUrl(cluster.clusterId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.clusterLink}
          >
            {cluster.clusterId}
          </a>
        </h4>
      </div>

      <dl className={styles.primaryGrid}>
        <div>
          <dt>Estimated required ETH</dt>
          <dd>{formatEth(cluster.breakdown.estimatedDepositWei)} ETH</dd>
        </div>
        <div>
          <dt>Effective balance</dt>
          <dd>{formatBalanceEth(cluster.effectiveBalance)} ETH</dd>
        </div>
        <div>
          <dt>Daily burn rate</dt>
          <dd>{formatEth(burnRateWeiPerDay.toString(), DAILY_RATE_DECIMALS)} ETH/day</dd>
        </div>
        <div>
          <dt>Runway</dt>
          <dd>{cluster.runwayDays} days</dd>
        </div>
        <div>
          <dt>Runway funding</dt>
          <dd>{formatEth(cluster.breakdown.runwayFundingWei, DETAIL_DECIMALS)} ETH</dd>
        </div>
        <div>
          <dt>Liquidation collateral</dt>
          <dd>{formatEth(cluster.breakdown.liquidationCollateralWei, DETAIL_DECIMALS)} ETH</dd>
        </div>
      </dl>

      <dl className={styles.operationalGrid}>
        <div>
          <dt>Operator fee</dt>
          <dd>{formatEth(operatorCostWeiPerYear.toString(), DETAIL_DECIMALS)} ETH/year</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>{formatEth(networkCostWeiPerYear.toString(), DETAIL_DECIMALS)} ETH/year</dd>
        </div>
        <div>
          <dt>Total burn</dt>
          <dd>{formatEth(burnRateWeiPerYear.toString(), DETAIL_DECIMALS)} ETH/year</dd>
        </div>
        <div>
          <dt>Active validators</dt>
          <dd>{formatInteger(cluster.activeValidatorCount)}</dd>
        </div>
      </dl>

      <details className={styles.protocolBox}>
        <summary>Technical details</summary>
        <ul>
          <li>
            <strong>Operator fee sum:</strong>{' '}
            {formatGwei(cluster.breakdown.operatorFeeWeiPerBlock)} gwei/block
          </li>
          <li>
            <strong>Network fee:</strong>{' '}
            {formatGwei(cluster.breakdown.networkFeeWeiPerBlock)} gwei/block
          </li>
          <li>
            <strong>Burn rate:</strong>{' '}
            {formatGwei(cluster.breakdown.burnRateWeiPerBlock)} gwei/block
          </li>
          <li>
            <strong>Liquidation threshold:</strong> {configUsed.liquidationThreshold}{' '}
            blocks
          </li>
          <li>
            <strong>Blocks/day assumption:</strong> {configUsed.blocksPerDay}
          </li>
        </ul>

        <div className={styles.sourceSection}>
          <h5>Operator fee sources</h5>
          <div className={styles.sourceList}>
            {cluster.feeSelection.map((item) => (
              <div key={item.operatorId} className={styles.sourceRow}>
                <span className={styles.sourceOperator}>Operator {item.operatorId}</span>
                <span
                  className={`${styles.sourceBadge} ${item.isPrivate ? styles.sourceTypePrivate : styles.sourceTypePublic}`}
                >
                  {item.isPrivate ? 'Private operator' : 'Public operator'}
                </span>
                <span className={styles.appliedFeeBadge}>
                  {formatEth(
                    (
                      BigInt(item.effectiveFeeWeiPerBlock) * blocksPerYear
                    ).toString(),
                    DETAIL_DECIMALS,
                  )}{' '}
                  ETH/year
                </span>
                {item.source === 'manual' ? (
                  <span className={`${styles.sourceBadge} ${styles.sourceManual}`}>
                    Manual override
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </details>
    </article>
  );
};

export function EstimateResults({ result, loading, error }: EstimateResultsProps) {
  const ownerGroups = useMemo(
    () => (result ? buildOwnerGroups(result.clusters) : []),
    [result],
  );
  const [ownerExpandedById, setOwnerExpandedById] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (ownerGroups.length === 0) {
      setOwnerExpandedById({});
      return;
    }

    setOwnerExpandedById((current) => {
      const next: Record<string, boolean> = {};
      for (const group of ownerGroups) {
        next[group.owner] = current[group.owner] ?? true;
      }
      return next;
    });
  }, [ownerGroups]);

  const toggleOwnerExpanded = (owner: string) => {
    setOwnerExpandedById((current) => ({
      ...current,
      [owner]: !(current[owner] ?? true),
    }));
  };

  let summaryContent;
  let detailContent;

  if (loading) {
    summaryContent = (
      <p className={styles.stateText}>Calculating estimates from live mainnet state...</p>
    );
    detailContent = (
      <p className={styles.stateText}>
        Cluster-level breakdown will appear after calculation finishes.
      </p>
    );
  } else if (error) {
    summaryContent = (
      <>
        <h4 className={styles.errorTitle}>Could not calculate estimate</h4>
        <p className={styles.errorText}>{error}</p>
      </>
    );
    detailContent = (
      <p className={styles.stateText}>
        Fix the input error and run the estimate again to load details.
      </p>
    );
  } else if (!result) {
    summaryContent = (
      <p className={styles.stateText}>
        Provide one or more owner addresses, then click Calculate estimate.
      </p>
    );
    detailContent = (
      <p className={styles.stateText}>
        Detailed breakdown and assumptions will appear after the first estimate.
      </p>
    );
  } else {
    const health = healthCheckFromTotal(result.totalEstimatedDepositWei);
    const thresholdBlocks = BigInt(result.configUsed.liquidationThreshold);
    const blocksPerDay = BigInt(result.configUsed.blocksPerDay);
    const blocksPerYear = blocksPerDay * 365n;
    const thresholdDaysEquivalent = Number(thresholdBlocks) / Number(blocksPerDay || 1n);
    const networkFeeWeiPerYearPerUnit = (
      BigInt(result.configUsed.networkFeeWei) * blocksPerYear
    ).toString();
    const operatorFeeSsvToEthRate = result.configUsed.operatorFeeSsvToEthRateWei;
    const operatorFeeRateSource =
      rateSourceLabel[result.configUsed.operatorFeeSsvToEthRateSource];
    const operatorFeeRateTimestamp = formatUnixTime(
      result.configUsed.operatorFeeSsvToEthRateFetchedAtUnix,
    );
    const operatorFeeRateStale = result.configUsed.operatorFeeSsvToEthRateStale;
    const manualModeActive = result.configUsed.operatorFeeSource === 'manualOverride';
    const sortedClusters = ownerGroups.flatMap((group) => group.clusters);
    const showOwnerColumn = ownerGroups.length > 1;

    const totals = result.clusters.reduce(
      (acc, cluster) => {
        const validatorUnits = BigInt(cluster.breakdown.validatorUnits);
        const operatorFeeWeiPerBlock = BigInt(cluster.breakdown.operatorFeeWeiPerBlock);
        const networkFeeWeiPerBlock = BigInt(cluster.breakdown.networkFeeWeiPerBlock);

        acc.operator += operatorFeeWeiPerBlock * validatorUnits * blocksPerYear;
        acc.network += networkFeeWeiPerBlock * validatorUnits * blocksPerYear;
        acc.runwayFunding += BigInt(cluster.breakdown.runwayFundingWei);
        acc.collateral += BigInt(cluster.breakdown.liquidationCollateralWei);
        return acc;
      },
      { operator: 0n, network: 0n, runwayFunding: 0n, collateral: 0n },
    );

    const summaryTooltipText = `Burn is the ongoing operating cost of running the cluster. Collateral is not burned; it is the required balance buffer to avoid liquidation. Total estimated deposit = runway funding + collateral requirement. Minimum collateral floor: ${formatEth(result.configUsed.minimumLiquidationCollateralWei)} ETH.`;

    summaryContent = (
      <>
        <div className={`${styles.healthBanner} ${styles[`health_${health.tone}`]}`}>
          {health.message}
        </div>
        {result.failedOwners.length > 0 ? (
          <div className={`${styles.healthBanner} ${styles.health_warning}`}>
            {result.failedOwners.length} owner
            {result.failedOwners.length === 1 ? '' : 's'} failed and {result.ownersSucceeded.length}{' '}
            owner{result.ownersSucceeded.length === 1 ? '' : 's'} succeeded in this batch.
          </div>
        ) : null}

        <div className={styles.summaryTop}>
          <div className={styles.kpiCard}>
            <p className={styles.kpiLabel}>
              Total estimated deposit required
              <InfoTooltip text={summaryTooltipText} />
            </p>
            <p className={styles.kpiValue}>
              {formatEth(result.totalEstimatedDepositWei)} ETH
            </p>
          </div>

          <div className={styles.summaryMetrics}>
            <p>
              <strong>Operator fee:</strong> {formatEth(totals.operator.toString(), SUMMARY_DECIMALS)} ETH/year
            </p>
            <p>
              <strong>Network fee:</strong> {formatEth(totals.network.toString(), SUMMARY_DECIMALS)} ETH/year
            </p>
            <p>
              <strong>Runway funding:</strong> {formatEth(totals.runwayFunding.toString(), SUMMARY_DECIMALS)} ETH
            </p>
            <p>
              <strong>Collateral requirement:</strong> {formatEth(totals.collateral.toString(), SUMMARY_DECIMALS)} ETH
            </p>
            <p>
              <strong>Owners processed:</strong> {result.ownersSucceeded.length}/
              {result.ownersRequested.length}
            </p>
            <p>
              <strong>Clusters processed:</strong> {result.clusters.length}
            </p>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {showOwnerColumn ? <th>Owner</th> : null}
                <th>Cluster ID</th>
                <th className={styles.numberCol}>Effective balance</th>
                <th className={styles.numberCol}>Daily burn rate</th>
                <th className={styles.numberCol}>Liquidation collateral</th>
                <th className={styles.numberCol}>Runway</th>
                <th className={`${styles.numberCol} ${styles.estimatedCol}`}>
                  Estimated required ETH
                </th>
              </tr>
            </thead>
            <tbody>
              {ownerGroups.map((group) => (
                <Fragment key={group.owner}>
                  {group.clusters.map((cluster) => {
                    const dailyBurnWei =
                      BigInt(cluster.breakdown.burnRateWeiPerBlock) * blocksPerDay;

                    return (
                      <tr key={cluster.clusterId}>
                        {showOwnerColumn ? (
                          <td title={group.owner}>{shortenOwnerAddress(group.owner)}</td>
                        ) : null}
                        <td className={styles.codeCell}>
                          <a
                            href={toClusterExplorerUrl(cluster.clusterId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.clusterLink}
                            title={cluster.clusterId}
                          >
                            {shortenClusterId(cluster.clusterId)}
                          </a>
                        </td>
                        <td className={styles.numberCell}>
                          {formatBalanceEth(cluster.effectiveBalance)} ETH
                        </td>
                    <td className={styles.numberCell}>
                      {formatEth(dailyBurnWei.toString(), DAILY_RATE_DECIMALS)} ETH/day
                    </td>
                    <td className={styles.numberCell}>
                      {formatEth(cluster.breakdown.liquidationCollateralWei, DETAIL_DECIMALS)} ETH
                    </td>
                        <td className={styles.numberCell}>{cluster.runwayDays} days</td>
                        <td className={`${styles.numberCell} ${styles.estimatedCell}`}>
                          {formatEth(cluster.breakdown.estimatedDepositWei)} ETH
                        </td>
                      </tr>
                    );
                  })}
                  {showOwnerColumn ? (
                    <tr className={styles.ownerSubtotalRow}>
                      <td colSpan={showOwnerColumn ? 5 : 4}>
                        Owner subtotal ({shortenOwnerAddress(group.owner)})
                      </td>
                      <td className={styles.numberCell} />
                      <td className={`${styles.numberCell} ${styles.estimatedCell}`}>
                        {formatEth(group.subtotalEstimatedWei.toString())} ETH
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );

    detailContent = (
      <>
        {showOwnerColumn ? (
          <div className={styles.ownerGroups}>
            {ownerGroups.map((group) => (
              <section key={group.owner} className={styles.ownerGroupSection}>
                <header className={styles.ownerGroupHeader}>
                  <div className={styles.ownerGroupHeaderLeft}>
                    <h4 title={group.owner}>{group.owner}</h4>
                    <p>
                      {group.clusters.length} clusters • subtotal{' '}
                      {formatEth(group.subtotalEstimatedWei.toString())} ETH
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.ownerToggleButton}
                    onClick={() => toggleOwnerExpanded(group.owner)}
                    aria-expanded={ownerExpandedById[group.owner] ?? true}
                    aria-label={
                      (ownerExpandedById[group.owner] ?? true)
                        ? `Collapse owner ${group.owner}`
                        : `Expand owner ${group.owner}`
                    }
                    title={(ownerExpandedById[group.owner] ?? true) ? 'Collapse' : 'Expand'}
                  >
                    <span className={styles.ownerToggleIcon} aria-hidden="true">
                      {(ownerExpandedById[group.owner] ?? true) ? '▾' : '▸'}
                    </span>
                  </button>
                </header>
                {(ownerExpandedById[group.owner] ?? true) ? (
                  <div className={styles.cards}>
                    {group.clusters.map((cluster) => (
                      <BreakdownCard
                        key={cluster.clusterId}
                        cluster={cluster}
                        configUsed={result.configUsed}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        ) : (
          <div className={styles.cards}>
            {sortedClusters.map((cluster) => (
              <BreakdownCard
                key={cluster.clusterId}
                cluster={cluster}
                configUsed={result.configUsed}
              />
            ))}
          </div>
        )}

        <div className={styles.bottomGrid}>
          <section className={styles.assumptionsBox}>
            <h4>Assumptions used</h4>
            <ul>
              <li>
                <strong>Operator fee source:</strong>{' '}
                {manualModeActive
                  ? `manual override (${result.configUsed.manualOperatorOverridesCount} operators)`
                  : 'live operator data from mainnet data sources (converted to ETH)'}
              </li>
              <li>
                <strong>Operator fee conversion:</strong> 1 SSV ={' '}
                {formatEth(operatorFeeSsvToEthRate, 9)} ETH ({operatorFeeRateSource}
                {operatorFeeRateStale ? ', cached' : ''})
              </li>
              <li>
                <strong>Conversion rate updated:</strong> {operatorFeeRateTimestamp}
              </li>
              <li>
                <strong>Network fee assumption:</strong>{' '}
                {formatEth(networkFeeWeiPerYearPerUnit, 9)} ETH/year per validator
              </li>
              <li>
                <strong>Minimum liquidation collateral:</strong>{' '}
                {formatEth(result.configUsed.minimumLiquidationCollateralWei, DETAIL_DECIMALS)} ETH
              </li>
              <li>
                <strong>Blocks before liquidation:</strong>{' '}
                {result.configUsed.liquidationThreshold} blocks
              </li>
              <li>
                <strong>Equivalent duration:</strong> {formatDays(thresholdDaysEquivalent)} days
              </li>
              <li>
                <strong>Blocks/day assumption:</strong> {result.configUsed.blocksPerDay}
              </li>
              {result.failedOwners.length > 0 ? (
                <li>
                  <strong>Owners skipped:</strong>{' '}
                  {result.failedOwners
                    .map((item) => shortenOwnerAddress(item.ownerAddress))
                    .join(', ')}
                </li>
              ) : null}
            </ul>
          </section>

          <section className={styles.notesBox}>
            <h4>Migration notes</h4>
            <ul>
              <li>This output is forecast-only and not a binding on-chain quote.</li>
              <li>
                Final required ETH can change if fee or collateral assumptions change
                before activation.
              </li>
              <li>Verify operator fees before migration, especially in manual mode.</li>
              <li>Migration is one-way. Confirm assumptions before execution planning.</li>
            </ul>
          </section>
        </div>
      </>
    );
  }

  return (
    <div className={styles.resultsSections}>
      <section id="estimate-summary-section" className={styles.panel}>
        <SectionHeader sectionNumber="2" title="Summary" />
        {summaryContent}
      </section>

      <section className={styles.panel}>
        <SectionHeader sectionNumber="3" title="Detailed Breakdown" />
        {detailContent}
      </section>
    </div>
  );
}
