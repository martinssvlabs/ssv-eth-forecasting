'use client';

import { useEffect, useMemo, useState } from 'react';
import { EstimateResults } from '@/components/EstimateResults';
import type { EstimateResponse, ForecastOverrides } from '@/lib/estimate/types';
import { formatEther, isAddress, parseEther } from 'viem';
import styles from './EstimatorForm.module.css';

type ForecastDefaults = {
  defaultRunwayDays: number;
  blocksPerDay: string;
  networkFeeWei: string;
  minimumLiquidationCollateralWei: string;
  liquidationThreshold: string;
  assumptionsLabel: string;
  disclaimerText: string;
};

type EstimatorFormProps = {
  defaults: ForecastDefaults;
};

type OperatorLiveFeeRow = {
  operatorId: string;
  liveFeeWeiPerBlock: string;
};

type ClusterManualRow = {
  clusterId: string;
  operators: OperatorLiveFeeRow[];
};

type FieldLabelProps = {
  label: string;
  tooltip: string;
};

const FieldLabel = ({ label, tooltip }: FieldLabelProps) => {
  return (
    <span className={styles.fieldLabel}>
      {label}
      <span className={styles.tooltipTrigger} tabIndex={0} aria-label={tooltip}>
        i
        <span role="tooltip" className={styles.tooltipContent}>
          {tooltip}
        </span>
      </span>
    </span>
  );
};

const toThresholdDays = (thresholdBlocks: string, blocksPerDay: string): string => {
  const blocks = Number(thresholdBlocks);
  const perDay = Number(blocksPerDay);

  if (!Number.isFinite(blocks) || !Number.isFinite(perDay) || perDay <= 0) {
    return '0';
  }

  return (blocks / perDay).toFixed(2);
};

const toEth = (weiValue: string): string => {
  try {
    return formatEther(BigInt(weiValue));
  } catch {
    return '0';
  }
};

const toFixedDecimal = (value: string, decimals: number): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return parsed.toFixed(decimals);
};

const toDefaultAdvancedState = (defaults: ForecastDefaults) => ({
  networkFeeEthPerYear: toFixedDecimal(
    toEthPerYearFromWeiPerBlock(defaults.networkFeeWei, defaults.blocksPerDay),
    5,
  ),
  minimumLiquidationCollateralEth: toEth(defaults.minimumLiquidationCollateralWei),
  liquidationThresholdDays: toThresholdDays(
    defaults.liquidationThreshold,
    defaults.blocksPerDay,
  ),
});

const parsePositiveNumber = (value: string, fieldName: string): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }

  return parsed;
};

const getBlocksPerYear = (blocksPerDay: string): bigint => {
  try {
    const parsed = BigInt(blocksPerDay);
    if (parsed <= 0n) return 1n;
    return parsed * 365n;
  } catch {
    return 1n;
  }
};

const toEthPerYearFromWeiPerBlock = (
  weiPerBlock: string,
  blocksPerDay: string,
): string => {
  try {
    const blocksPerYear = getBlocksPerYear(blocksPerDay);
    return formatEther(BigInt(weiPerBlock) * blocksPerYear);
  } catch {
    return '0';
  }
};

const validateEthPerYearInput = (value: string | undefined): string | null => {
  if (!value || value.trim() === '') {
    return 'Enter a value in ETH/year.';
  }

  try {
    const parsed = parseEther(value.trim());
    if (parsed < 0n) {
      return 'Value must be zero or greater.';
    }
  } catch {
    return 'Enter a valid ETH number (for example: 0.04).';
  }

  return null;
};

const sortOperatorRows = (a: OperatorLiveFeeRow, b: OperatorLiveFeeRow) => {
  const numA = Number(a.operatorId);
  const numB = Number(b.operatorId);

  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }

  return a.operatorId.localeCompare(b.operatorId);
};

const extractOperatorLiveFees = (
  response: EstimateResponse | null,
): OperatorLiveFeeRow[] => {
  if (!response) return [];

  const byId = new Map<string, OperatorLiveFeeRow>();
  for (const cluster of response.clusters) {
    for (const fee of cluster.feeSelection) {
      if (!byId.has(fee.operatorId)) {
        byId.set(fee.operatorId, {
          operatorId: fee.operatorId,
          liveFeeWeiPerBlock: fee.liveFeeWeiPerBlock,
        });
      }
    }
  }

  return Array.from(byId.values()).sort(sortOperatorRows);
};

const extractClusterManualRows = (
  response: EstimateResponse | null,
): ClusterManualRow[] => {
  if (!response) return [];

  return response.clusters.map((cluster) => ({
    clusterId: cluster.clusterId,
    operators: cluster.feeSelection
      .map((fee) => ({
        operatorId: fee.operatorId,
        liveFeeWeiPerBlock: fee.liveFeeWeiPerBlock,
      }))
      .sort(sortOperatorRows),
  }));
};

const shortenClusterId = (clusterId: string): string => {
  if (clusterId.length <= 20) return clusterId;
  return `${clusterId.slice(0, 12)}...${clusterId.slice(-8)}`;
};

export function EstimatorForm({ defaults }: EstimatorFormProps) {
  const defaultAdvancedState = useMemo(
    () => toDefaultAdvancedState(defaults),
    [defaults],
  );

  const [ownerAddress, setOwnerAddress] = useState('');
  const [runwayDays, setRunwayDays] = useState(defaults.defaultRunwayDays);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [networkFeeEthPerYear, setNetworkFeeEthPerYear] = useState(
    defaultAdvancedState.networkFeeEthPerYear,
  );
  const [minimumLiquidationCollateralEth, setMinimumLiquidationCollateralEth] =
    useState(defaultAdvancedState.minimumLiquidationCollateralEth);
  const [liquidationThresholdDays, setLiquidationThresholdDays] = useState(
    defaultAdvancedState.liquidationThresholdDays,
  );
  const [manualOperatorFeeOverrideEnabled, setManualOperatorFeeOverrideEnabled] =
    useState(false);
  const [manualOperatorFeesEthYearById, setManualOperatorFeesEthYearById] = useState<
    Record<string, string>
  >({});
  const [manualOperatorFeeTouchedById, setManualOperatorFeeTouchedById] = useState<
    Record<string, boolean>
  >({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [selectedManualClusterId, setSelectedManualClusterId] = useState('');
  const [lastEstimatedOwner, setLastEstimatedOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [shouldScrollToResults, setShouldScrollToResults] = useState(false);
  const manualOperatorRows = useMemo(() => extractOperatorLiveFees(result), [result]);
  const manualClusterRows = useMemo(() => extractClusterManualRows(result), [result]);
  const selectedManualCluster = useMemo(
    () =>
      manualClusterRows.find((cluster) => cluster.clusterId === selectedManualClusterId) ??
      null,
    [manualClusterRows, selectedManualClusterId],
  );
  const operatorUsageCountById = useMemo(() => {
    const usage = new Map<string, number>();
    for (const cluster of manualClusterRows) {
      for (const operator of cluster.operators) {
        usage.set(operator.operatorId, (usage.get(operator.operatorId) ?? 0) + 1);
      }
    }
    return usage;
  }, [manualClusterRows]);
  const manualOverrideSummary = useMemo(() => {
    const blocksPerYear = getBlocksPerYear(defaults.blocksPerDay);
    const overriddenOperatorIds = new Set<string>();

    for (const row of manualOperatorRows) {
      const liveWeiPerYear = BigInt(row.liveFeeWeiPerBlock) * blocksPerYear;
      const manualEthPerYear = manualOperatorFeesEthYearById[row.operatorId];
      if (!manualEthPerYear || manualEthPerYear.trim() === '') continue;

      try {
        const manualWeiPerYear = parseEther(manualEthPerYear.trim());
        if (manualWeiPerYear !== liveWeiPerYear) {
          overriddenOperatorIds.add(row.operatorId);
        }
      } catch {
        continue;
      }
    }

    let impactedClusters = 0;
    for (const cluster of manualClusterRows) {
      if (cluster.operators.some((operator) => overriddenOperatorIds.has(operator.operatorId))) {
        impactedClusters += 1;
      }
    }

    return {
      clusters: manualClusterRows.length,
      uniqueOperators: manualOperatorRows.length,
      overriddenOperators: overriddenOperatorIds.size,
      impactedClusters,
    };
  }, [defaults.blocksPerDay, manualClusterRows, manualOperatorFeesEthYearById, manualOperatorRows]);
  const manualOperatorFeeErrorsById = useMemo(() => {
    const next: Record<string, string | null> = {};
    for (const row of manualOperatorRows) {
      next[row.operatorId] = validateEthPerYearInput(
        manualOperatorFeesEthYearById[row.operatorId],
      );
    }
    return next;
  }, [manualOperatorFeesEthYearById, manualOperatorRows]);
  const normalizedOwnerInput = ownerAddress.trim().toLowerCase();
  const hasBaselineForCurrentOwner =
    normalizedOwnerInput.length > 0 &&
    normalizedOwnerInput === lastEstimatedOwner &&
    manualOperatorRows.length > 0;
  const manualToggleHint = hasBaselineForCurrentOwner
    ? 'Manual operator fee override is available for this owner.'
    : 'To use manual operator fees, first click Calculate estimate for this owner. The toggle unlocks after cluster data is loaded.';

  const ownerAddressHint = useMemo(() => {
    const trimmed = ownerAddress.trim();

    if (!trimmed) {
      return {
        text: 'Enter the wallet address that owns the clusters.',
        tone: 'neutral' as const,
      };
    }

    if (isAddress(trimmed)) {
      return {
        text: 'Address format looks valid.',
        tone: 'valid' as const,
      };
    }

    return {
      text: 'Address is not a valid EVM address.',
      tone: 'error' as const,
    };
  }, [ownerAddress]);

  useEffect(() => {
    if (manualOperatorRows.length === 0) return;

    setManualOperatorFeesEthYearById((current) => {
      const next: Record<string, string> = {};

      for (const row of manualOperatorRows) {
        next[row.operatorId] =
          current[row.operatorId] ??
          toEthPerYearFromWeiPerBlock(row.liveFeeWeiPerBlock, defaults.blocksPerDay);
      }

      return next;
    });
  }, [defaults.blocksPerDay, manualOperatorRows]);

  useEffect(() => {
    if (!hasBaselineForCurrentOwner && manualOperatorFeeOverrideEnabled) {
      setManualOperatorFeeOverrideEnabled(false);
    }
  }, [hasBaselineForCurrentOwner, manualOperatorFeeOverrideEnabled]);

  useEffect(() => {
    setManualOperatorFeeTouchedById((current) => {
      const next: Record<string, boolean> = {};
      for (const row of manualOperatorRows) {
        if (current[row.operatorId]) {
          next[row.operatorId] = true;
        }
      }
      return next;
    });
  }, [manualOperatorRows]);

  useEffect(() => {
    if (!shouldScrollToResults || loading || !result) return;

    const frame = window.requestAnimationFrame(() => {
      const summarySection = document.getElementById('estimate-summary-section');
      summarySection?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      setShouldScrollToResults(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loading, result, shouldScrollToResults]);

  useEffect(() => {
    if (manualClusterRows.length === 0) {
      if (selectedManualClusterId !== '') {
        setSelectedManualClusterId('');
      }
      return;
    }

    const hasSelectedCluster = manualClusterRows.some(
      (cluster) => cluster.clusterId === selectedManualClusterId,
    );
    if (!hasSelectedCluster) {
      setSelectedManualClusterId(manualClusterRows[0].clusterId);
    }
  }, [manualClusterRows, selectedManualClusterId]);

  const resetAdvancedToDefaults = () => {
    setNetworkFeeEthPerYear(defaultAdvancedState.networkFeeEthPerYear);
    setMinimumLiquidationCollateralEth(
      defaultAdvancedState.minimumLiquidationCollateralEth,
    );
    setLiquidationThresholdDays(defaultAdvancedState.liquidationThresholdDays);
  };

  const resetManualFeesToLive = () => {
    const next: Record<string, string> = {};
    for (const row of manualOperatorRows) {
      next[row.operatorId] = toEthPerYearFromWeiPerBlock(
        row.liveFeeWeiPerBlock,
        defaults.blocksPerDay,
      );
    }
    setManualOperatorFeesEthYearById(next);
  };

  const resetSelectedClusterFeesToLive = () => {
    if (!selectedManualCluster) return;

    setManualOperatorFeesEthYearById((current) => {
      const next = { ...current };
      for (const operator of selectedManualCluster.operators) {
        next[operator.operatorId] = toEthPerYearFromWeiPerBlock(
          operator.liveFeeWeiPerBlock,
          defaults.blocksPerDay,
        );
      }
      return next;
    });
  };

  const buildOverrides = (): ForecastOverrides | undefined => {
    const next: ForecastOverrides = {};

    if (showAdvanced) {
      const thresholdDays = parsePositiveNumber(
        liquidationThresholdDays,
        'Liquidation threshold days equivalent',
      );

      const thresholdBlocks = BigInt(
        Math.round(thresholdDays * Number(defaults.blocksPerDay)),
      );

      if (thresholdBlocks <= 0n) {
        throw new Error('Liquidation threshold blocks must be greater than 0');
      }

      let networkFeeWeiPerYear: bigint;
      try {
        networkFeeWeiPerYear = parseEther(networkFeeEthPerYear.trim());
      } catch {
        throw new Error('Estimated yearly SSV network fee must be a valid ETH value');
      }
      const blocksPerYear = getBlocksPerYear(defaults.blocksPerDay);
      next.networkFeeWei = (networkFeeWeiPerYear / blocksPerYear).toString();
      next.minimumLiquidationCollateralWei = parseEther(
        minimumLiquidationCollateralEth.trim(),
      ).toString();
      next.liquidationThreshold = thresholdBlocks.toString();
    }

    if (manualOperatorFeeOverrideEnabled) {
      const normalizedOwner = ownerAddress.trim().toLowerCase();
      if (
        manualOperatorRows.length === 0 ||
        !lastEstimatedOwner ||
        normalizedOwner !== lastEstimatedOwner
      ) {
        throw new Error(
          'Manual operator override requires a baseline estimate for the same owner. Run once with live fees first.',
        );
      }

      const manualOperatorFeesWeiById: Record<string, string> = {};
      const blocksPerYear = getBlocksPerYear(defaults.blocksPerDay);
      for (const row of manualOperatorRows) {
        const currentValue = manualOperatorFeesEthYearById[row.operatorId];
        if (!currentValue || currentValue.trim() === '') {
          throw new Error(`Manual fee is required for operator ${row.operatorId}`);
        }

        let parsedWeiPerYear: bigint;
        try {
          parsedWeiPerYear = parseEther(currentValue.trim());
        } catch {
          throw new Error(
            `Manual fee for operator ${row.operatorId} must be a valid ETH/year value`,
          );
        }
        const parsedWei = parsedWeiPerYear / blocksPerYear;
        if (parsedWei < 0n) {
          throw new Error(
            `Manual fee for operator ${row.operatorId} must be a non-negative value`,
          );
        }

        manualOperatorFeesWeiById[row.operatorId] = parsedWei.toString();
      }

      next.manualOperatorFeeOverrideEnabled = true;
      next.manualOperatorFeesWeiById = manualOperatorFeesWeiById;
    }

    return Object.keys(next).length > 0 ? next : undefined;
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);

    if (!ownerAddress.trim()) {
      setError('Owner address is required');
      return;
    }

    if (!isAddress(ownerAddress.trim())) {
      setError('Owner address is not a valid EVM address');
      return;
    }

    if (!Number.isFinite(runwayDays) || runwayDays <= 0) {
      setError('Runway must be greater than 0');
      return;
    }

    if (manualOperatorFeeOverrideEnabled) {
      const hasManualFeeErrors = manualOperatorRows.some(
        (row) => manualOperatorFeeErrorsById[row.operatorId] !== null,
      );

      if (hasManualFeeErrors) {
        setError('Fix the highlighted operator fee values and try again.');
        return;
      }
    }

    let overrides: ForecastOverrides | undefined;
    try {
      overrides = buildOverrides();
    } catch (buildError) {
      setError(
        buildError instanceof Error
          ? buildError.message
          : 'Invalid advanced override values',
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/estimate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ownerAddress: ownerAddress.trim(),
          runwayDays,
          overrides,
        }),
      });

      const json = (await response.json()) as EstimateResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(json.error || 'Failed to calculate estimate');
      }

      setResult(json);
      setLastEstimatedOwner(ownerAddress.trim().toLowerCase());
      setShouldScrollToResults(true);
      setSubmitAttempted(false);
    } catch (err) {
      setResult(null);
      setShouldScrollToResults(false);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.layout}>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Section 1</p>
          <h2>Setup</h2>
        </div>
        <p className={styles.helpText}>{defaults.disclaimerText}</p>

        <details className={styles.methodBox}>
          <summary>How the estimate works</summary>
          <ul>
            <li>
              The app reads your current clusters and operators from mainnet.
            </li>
            <li>
              By default, operator fees come from live operator records for each
              cluster.
            </li>
            <li>
              It combines live cluster state with your fee and collateral
              assumptions.
            </li>
            <li>
              Required ETH is estimated as runway funding plus required collateral.
              Collateral uses the higher of the minimum collateral floor or
              burn-rate-based collateral.
            </li>
          </ul>
        </details>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.field}>
            <FieldLabel
              label="Owner address"
              tooltip="Wallet address that owns the SSV clusters. The app fetches all clusters for this owner on mainnet."
            />
            <input
              type="text"
              value={ownerAddress}
              onChange={(event) => setOwnerAddress(event.target.value)}
              placeholder="0x... (owner address)"
            />
            <small
              className={`${styles.fieldHint} ${styles[`fieldHint_${ownerAddressHint.tone}`]}`}
            >
              {ownerAddressHint.text}
            </small>
          </label>

          <label className={styles.field}>
            <FieldLabel
              label="Runway (days)"
              tooltip="How long the migrated cluster should remain funded. Higher runway increases required ETH."
            />
            <input
              type="number"
              min={1}
              step={1}
              value={runwayDays}
              onChange={(event) => setRunwayDays(Number(event.target.value))}
            />
          </label>

          <div className={styles.manualModeBox}>
            <div className={styles.manualToggleRow}>
              <span className={styles.manualToggleText}>
                Manual operator fee override
              </span>
              <span
                className={`${styles.switchTooltipWrapper} ${!hasBaselineForCurrentOwner ? styles.switchTooltipWrapper_disabled : ''}`}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={manualOperatorFeeOverrideEnabled}
                  aria-label="Manual operator fee override"
                  className={`${styles.switchButton} ${manualOperatorFeeOverrideEnabled ? styles.switchButton_on : ''}`}
                  onClick={() =>
                    setManualOperatorFeeOverrideEnabled((current) => !current)
                  }
                  disabled={!hasBaselineForCurrentOwner}
                >
                  <span className={styles.switchKnob} />
                </button>
                {!hasBaselineForCurrentOwner ? (
                  <span role="tooltip" className={styles.switchTooltip}>
                    {manualToggleHint}
                  </span>
                ) : null}
              </span>
            </div>
            <small className={styles.fieldHint}>
              {hasBaselineForCurrentOwner
                ? 'Default mode uses live operator fees. Manual mode is optional and only affects this estimate run.'
                : 'Run a baseline estimate first to enable manual operator fee override for this owner.'}
            </small>

            {manualOperatorFeeOverrideEnabled ? (
              <div className={styles.manualFields}>
                <small className={styles.manualWarning}>
                  Manual mode is enabled. Edited operator fees are custom assumptions
                  for this estimate.
                </small>

                {manualOperatorRows.length === 0 ? (
                  <small className={styles.fieldHint}>
                    Run a baseline estimate with live fees first to load operator
                    values for manual editing.
                  </small>
                ) : (
                  <>
                    <div className={styles.manualSummaryRow}>
                      <span className={styles.manualSummaryChip}>
                        Clusters: {manualOverrideSummary.clusters}
                      </span>
                      <span className={styles.manualSummaryChip}>
                        Unique operators: {manualOverrideSummary.uniqueOperators}
                      </span>
                      <span className={styles.manualSummaryChip}>
                        Overridden operators: {manualOverrideSummary.overriddenOperators}
                      </span>
                      <span className={styles.manualSummaryChip}>
                        Impacted clusters: {manualOverrideSummary.impactedClusters}
                      </span>
                    </div>

                    <div className={styles.manualClusterPicker}>
                      <label className={styles.field}>
                        <FieldLabel
                          label="Cluster to edit"
                          tooltip="Select one cluster to edit operator fee overrides. Overrides are still applied by operator ID."
                        />
                        <select
                          value={selectedManualClusterId}
                          onChange={(event) =>
                            setSelectedManualClusterId(event.target.value)
                          }
                        >
                          {manualClusterRows.map((cluster) => (
                            <option key={cluster.clusterId} value={cluster.clusterId}>
                              {shortenClusterId(cluster.clusterId)} ({cluster.operators.length} operators)
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className={styles.advancedActions}>
                      <small className={styles.fieldHint}>
                        Prefilled from live operator fees. Edit values in ETH/year.
                      </small>
                      <div className={styles.manualActions}>
                        <button
                          type="button"
                          className={styles.resetDefaultsButton}
                          onClick={resetSelectedClusterFeesToLive}
                          disabled={!selectedManualCluster}
                        >
                          Reset selected cluster
                        </button>
                        <button
                          type="button"
                          className={styles.resetDefaultsButton}
                          onClick={resetManualFeesToLive}
                        >
                          Reset all operators
                        </button>
                      </div>
                    </div>

                    <div className={styles.manualOperatorGrid}>
                      {selectedManualCluster?.operators.map((row) => {
                        const usageCount = operatorUsageCountById.get(row.operatorId) ?? 1;
                        const manualFeeError = manualOperatorFeeErrorsById[row.operatorId];
                        const showManualFeeError =
                          manualFeeError !== null &&
                          ((manualOperatorFeeTouchedById[row.operatorId] ?? false) ||
                            submitAttempted);
                        return (
                          <label className={styles.field} key={row.operatorId}>
                            <FieldLabel
                              label={`Operator ${row.operatorId} fee (ETH/year)`}
                              tooltip="Manual fee assumption for this operator, entered as ETH/year."
                            />
                            <input
                              type="text"
                              className={showManualFeeError ? styles.fieldInputError : ''}
                              value={manualOperatorFeesEthYearById[row.operatorId] ?? ''}
                              onChange={(event) =>
                                setManualOperatorFeesEthYearById((current) => ({
                                  ...current,
                                  [row.operatorId]: event.target.value,
                                }))
                              }
                              onBlur={() =>
                                setManualOperatorFeeTouchedById((current) => ({
                                  ...current,
                                  [row.operatorId]: true,
                                }))
                              }
                            />
                            {showManualFeeError ? (
                              <small
                                className={`${styles.fieldHint} ${styles.fieldHint_error}`}
                              >
                                {manualFeeError}
                              </small>
                            ) : null}
                            <small className={styles.fieldHint}>
                              Live:{' '}
                              {toEthPerYearFromWeiPerBlock(
                                row.liveFeeWeiPerBlock,
                                defaults.blocksPerDay,
                              )}{' '}
                              ETH/year
                              {usageCount > 1
                                ? ` • used in ${usageCount} clusters`
                                : ''}
                            </small>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={styles.toggleAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced settings
          </button>

          {showAdvanced ? (
            <div className={styles.advanced}>
              <div className={styles.advancedActions}>
                <small className={styles.fieldHint}>
                  Optional: adjust fee and collateral assumptions for your forecast.
                </small>
                <button
                  type="button"
                  className={styles.resetDefaultsButton}
                  onClick={resetAdvancedToDefaults}
                >
                  Use defaults
                </button>
              </div>

              <label className={styles.field}>
                <FieldLabel
                  label="Estimated yearly ssv.network fee (ETH)"
                  tooltip="Estimated ETH fee paid to ssv.network each year for one validator (ETH/year). This value may change before migration."
                />
                <input
                  type="text"
                  value={networkFeeEthPerYear}
                  onChange={(event) =>
                    setNetworkFeeEthPerYear(event.target.value)
                  }
                />
                <small className={styles.fieldHint}>
                  Enter as ETH/year.
                </small>
              </label>

              <label className={styles.field}>
                <FieldLabel
                  label="Minimum liquidation collateral (ETH)"
                  tooltip="Lower bound for collateral. Formula uses max(minCollateral, burnRate * threshold)."
                />
                <input
                  type="text"
                  value={minimumLiquidationCollateralEth}
                  onChange={(event) =>
                    setMinimumLiquidationCollateralEth(event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <FieldLabel
                  label="Collateral coverage period (days)"
                  tooltip="How many days of burn should be covered by collateral when applying the liquidation requirement."
                />
                <input
                  type="text"
                  value={liquidationThresholdDays}
                  onChange={(event) =>
                    setLiquidationThresholdDays(event.target.value)
                  }
                />
              </label>
            </div>
          ) : null}

          <button type="submit" className={styles.submitButton} disabled={loading}>
            {loading ? 'Calculating...' : 'Calculate estimate'}
          </button>
        </form>
      </section>

      <EstimateResults result={result} loading={loading} error={error} />
    </div>
  );
}
