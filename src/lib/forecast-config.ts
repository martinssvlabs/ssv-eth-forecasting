import type { ForecastConfig } from '@/lib/estimate/types';

const DEFAULT_SUBGRAPH_URL =
  'https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest';

const DEFAULT_DISCLAIMER =
  'Estimate only. Uses current mainnet cluster/operator state plus configured post-migration ETH protocol parameters. Final required ETH can change if governance parameters change before migration activation.';

const DEFAULT_ASSUMPTIONS_LABEL = 'mainnet-forecast-defaults-v1';

const parseBigIntEnv = (envKey: string, fallback: bigint): bigint => {
  const value = process.env[envKey];
  if (!value) return fallback;

  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
};

const parseNumberEnv = (envKey: string, fallback: number): number => {
  const value = process.env[envKey];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createForecastConfig = (): ForecastConfig => {
  return {
    ssvSubgraphUrl: process.env.SSV_SUBGRAPH_URL || DEFAULT_SUBGRAPH_URL,
    ssvSubgraphApiKey: process.env.SSV_SUBGRAPH_API_KEY,
    defaultRunwayDays: parseNumberEnv('DEFAULT_RUNWAY_DAYS', 365),
    forecastEthNetworkFeeWei: parseBigIntEnv(
      'FORECAST_ETH_NETWORK_FEE_WEI',
      1000000000n,
    ),
    forecastMinimumLiquidationCollateralWei: parseBigIntEnv(
      'FORECAST_MINIMUM_LIQUIDATION_COLLATERAL_WEI',
      1000000000000000000n,
    ),
    forecastLiquidationThreshold: parseBigIntEnv(
      'FORECAST_LIQUIDATION_THRESHOLD',
      214800n,
    ),
    assumptionsLabel:
      process.env.FORECAST_ASSUMPTIONS_LABEL || DEFAULT_ASSUMPTIONS_LABEL,
    blocksPerDay: parseBigIntEnv('BLOCKS_PER_DAY', 7160n),
    vUnitsPrecision: parseNumberEnv('VUNITS_PRECISION', 10000),
    disclaimerText: process.env.APP_DISCLAIMER_TEXT || DEFAULT_DISCLAIMER,
  };
};

export const forecastConfig = createForecastConfig();

export const publicForecastDefaults = {
  defaultRunwayDays: forecastConfig.defaultRunwayDays,
  blocksPerDay: forecastConfig.blocksPerDay.toString(),
  networkFeeWei: forecastConfig.forecastEthNetworkFeeWei.toString(),
  minimumLiquidationCollateralWei:
    forecastConfig.forecastMinimumLiquidationCollateralWei.toString(),
  liquidationThreshold: forecastConfig.forecastLiquidationThreshold.toString(),
  assumptionsLabel: forecastConfig.assumptionsLabel,
  disclaimerText: forecastConfig.disclaimerText,
};
