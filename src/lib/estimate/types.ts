export type InputMode = 'owner' | 'ownerBatch';

export type LiveCluster = {
  id: string;
  owner?: string;
  operatorIds: string[];
  effectiveBalance: string;
  activeValidatorCount?: string;
  active: boolean;
  validatorCount: string;
};

export type LiveOperator = {
  id: string;
  fee: string;
  isPrivate: boolean;
};

export type ForecastConfig = {
  ssvSubgraphUrl: string;
  ssvSubgraphApiKey?: string;
  ssvApiBaseUrl: string;
  ssvApiNetwork: string;
  ssvToEthRateWeiOverride?: bigint;
  ssvToEthRateCacheTtlSeconds: number;
  defaultRunwayDays: number;
  forecastEthNetworkFeeWei: bigint;
  forecastMinimumLiquidationCollateralWei: bigint;
  forecastLiquidationThreshold: bigint;
  assumptionsLabel: string;
  blocksPerDay: bigint;
  vUnitsPrecision: number;
  disclaimerText: string;
};

export type ForecastOverrides = {
  networkFeeWei?: string;
  minimumLiquidationCollateralWei?: string;
  liquidationThreshold?: string;
  manualOperatorFeeOverrideEnabled?: boolean;
  manualOperatorFeesWeiById?: Record<string, string>;
};

export type OperatorFeeSelection = {
  operatorId: string;
  isPrivate: boolean;
  liveFeeWeiPerBlock: bigint;
  effectiveFeeWeiPerBlock: bigint;
  source: 'privateZeroFee' | 'live' | 'manual';
};

export type ClusterForecastInput = {
  clusterId: string;
  owner?: string;
  runwayDays: number;
  operatorIds: string[];
  effectiveBalance: number;
  operators: OperatorFeeSelection[];
  operatorsFeeWeiPerBlock: bigint;
  networkFeeWeiPerBlock: bigint;
  minimumLiquidationCollateralWei: bigint;
  liquidationThreshold: bigint;
  blocksPerDay: bigint;
  vUnitsPrecision: number;
};

export type ClusterEstimateBreakdown = {
  operatorFeeWeiPerBlock: bigint;
  networkFeeWeiPerBlock: bigint;
  burnRateWeiPerBlock: bigint;
  validatorUnits: bigint;
  liquidationCollateralWei: bigint;
  runwayFundingWei: bigint;
  estimatedDepositWei: bigint;
};

export type ClusterEstimateResult = {
  clusterId: string;
  owner?: string;
  runwayDays: number;
  operatorIds: string[];
  effectiveBalance: string;
  activeValidatorCount: string;
  validatorCount: string;
  breakdown: ClusterEstimateBreakdown;
  feeSelection: OperatorFeeSelection[];
};

export type ClusterEstimateResponseItem = {
  clusterId: string;
  owner?: string;
  runwayDays: number;
  operatorIds: string[];
  effectiveBalance: string;
  activeValidatorCount: string;
  validatorCount: string;
  breakdown: {
    operatorFeeWeiPerBlock: string;
    networkFeeWeiPerBlock: string;
    burnRateWeiPerBlock: string;
    validatorUnits: string;
    liquidationCollateralWei: string;
    runwayFundingWei: string;
    estimatedDepositWei: string;
  };
  feeSelection: Array<{
    operatorId: string;
    isPrivate: boolean;
    liveFeeWeiPerBlock: string;
    effectiveFeeWeiPerBlock: string;
    source: OperatorFeeSelection['source'];
  }>;
};

export type SsvToEthRate = {
  rateWei: bigint;
  source: 'env_override' | 'coingecko' | 'binance_derived';
  fetchedAtUnix: number;
  stale: boolean;
};

export type EstimateResponse = {
  mode: InputMode;
  runwayDays: number;
  clusters: ClusterEstimateResponseItem[];
  totalEstimatedDepositWei: string;
  ownersRequested: string[];
  ownersSucceeded: string[];
  failedOwners: Array<{
    ownerAddress: string;
    error: string;
  }>;
  configUsed: {
    networkFeeWei: string;
    minimumLiquidationCollateralWei: string;
    liquidationThreshold: string;
    blocksPerDay: string;
    operatorFeeSsvToEthRateWei: string;
    operatorFeeSsvToEthRateSource: SsvToEthRate['source'];
    operatorFeeSsvToEthRateFetchedAtUnix: number;
    operatorFeeSsvToEthRateStale: boolean;
    operatorFeeSource: 'live' | 'manualOverride';
    manualOperatorOverridesCount: number;
    assumptionsLabel: string;
  };
  disclaimer: string;
};

export type EstimateRequestBody = {
  ownerAddress?: string;
  ownerAddresses?: string[];
  runwayDays: number;
  overrides?: ForecastOverrides;
};

export type ForecastDataSource = {
  getClustersByOwner: (owner: string) => Promise<LiveCluster[]>;
  getOperators: (operatorIds: string[]) => Promise<LiveOperator[]>;
  getSsvToEthRateWei: () => Promise<SsvToEthRate>;
};
