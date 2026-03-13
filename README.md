# SSV Mainnet ETH Migration Forecast App

Simple production-ready Next.js app to estimate ETH required to migrate **mainnet SSV clusters** from SSV-based payments to ETH-based payments.

This tool is informational only:
- no wallet connect
- no transaction execution
- no on-chain quote guarantees

## Why This Exists

The SDK helper `calcDepositFromRunway` (in `ssv-sdk`) uses live DAO/network values available on Hoodi ETH-era contracts.

For **mainnet pre-migration forecasting**, those ETH-era values are not fully live yet. This app adapts the same formula by combining:
- live mainnet cluster/operator data
- configured forecast ETH parameters

## Features

- Estimate all clusters by owner address + total
- Runway input (default: 365 days)
- Advanced protocol-parameter overrides (UI in gwei/ETH/days, converted internally)
- ETH-first per-cluster breakdown (estimated deposit, runway funding, collateral used)
- Operational context per cluster (validator count, validator units, burn rate in ETH/day + ETH/year)
- Collapsible protocol details (gwei/block and block-based internals)
- Optional manual operator fee override mode for explicit scenario testing (off by default)
- Operator fee source badges (private zero / live / manual override)
- Quick health-check banner on total estimate
- Short migration notes checklist below results
- Loading/error/empty states

## Calculation Model (Math + Parameters)

This section documents the exact math used by the estimator.

The implementation is in:
- `src/lib/estimate/buildClusterForecastInput.ts`
- `src/lib/estimate/computeDepositFromRunway.ts`
- `src/lib/estimate/estimateService.ts`

### Parameter Glossary

| Parameter | Unit | Source | Meaning |
|---|---|---|---|
| `ownerAddress` | address | user input | Owner used to fetch clusters from mainnet data sources |
| `runwayDays` | days | user input | Target runway period to fund |
| `effectiveBalance` | ETH | live cluster data | Cluster total effective balance used to derive validator units |
| `operator.fee` | legacy token wei/block | live operator data | Current on-chain operator fee before migration |
| `operatorFeeSsvToEthRateWei` | wei | config or SSV API finance endpoint | Conversion rate used to map legacy operator fees to ETH |
| `networkFeeWei` | wei/block | forecast config or override | Forecast network fee per block |
| `minimumLiquidationCollateralWei` | wei | forecast config or override | Collateral floor used by liquidation logic |
| `liquidationThreshold` | blocks | forecast config or override | Liquidation threshold period |
| `blocksPerDay` | blocks/day | config | Block frequency assumption |
| `vUnitsPrecision` | dimensionless | config | Precision constant used in validator-unit derivation |

### Per-Cluster Equations

For each cluster, the estimator computes:

```text
liveOperatorFeeEthWeiPerBlock = floor(
  liveOperatorFeeSsvWeiPerBlock * operatorFeeSsvToEthRateWei / 1e18
)

operatorsFeeWeiPerBlock = sum(effective ETH operator fees for the cluster)

validatorUnits = max(
  1,
  floor(((vUnitsPrecision * effectiveBalance) / 32) / vUnitsPrecision)
)

burnRateWeiPerBlock = max(
  1,
  (operatorsFeeWeiPerBlock + networkFeeWeiPerBlock) * validatorUnits
)

liquidationCollateralWei = max(
  minimumLiquidationCollateralWei,
  burnRateWeiPerBlock * liquidationThreshold
)

scaledDays = floor(runwayDays * 1e6)

runwayFundingWei = floor(
  burnRateWeiPerBlock * scaledDays * blocksPerDay / 1e6
)

estimatedDepositWei = runwayFundingWei + liquidationCollateralWei
```

### Manual Operator Override Conversion

Default behavior starts from live operator fees and converts them to ETH first.

If manual override mode is enabled, users input operator fee assumptions in `ETH/year`.
Each manual value is converted before calculation:

```text
blocksPerYear = blocksPerDay * 365

manualOperatorFeeWeiPerBlock = floor(
  manualOperatorFeeWeiPerYear / blocksPerYear
)
```

Where:
- `manualOperatorFeeWeiPerYear = parseEther(userInputEthPerYear)`
- the converted `manualOperatorFeeWeiPerBlock` is used only for that estimate run

Display-side conversion for live fee prefills:

```text
liveOperatorFeeEthPerYear =
  liveOperatorFeeWeiPerBlock * blocksPerYear / 1e18
```

### Owner-Level Aggregation

In owner mode, each cluster is estimated independently, then summed:

```text
totalEstimatedDepositWei = sum(cluster.estimatedDepositWei)
```

### Effective Balance Source

- Cluster inventory and operator composition are fetched from the mainnet subgraph.
- Cluster **total effective balance** is fetched from SSV API v4:
  - `GET /api/v4/{network}/clusters/{clusterHash}/totalEffectiveBalance`
- SSV API returns effective balance in `gwei`; the app converts it to `ETH` before the runway formula is applied.

### Rounding and Integer Behavior

- Math is integer-safe (`bigint`) end-to-end for protocol values.
- Fractional runway days are handled with a `1e6` scaling factor and truncated (`floor`) behavior.
- Manual `ETH/year -> wei/block` conversion uses integer division (truncates toward zero).
- Minimum safeguards:
  - `validatorUnits` is at least `1`
  - `burnRateWeiPerBlock` is at least `1`

## Live Fee Policy

Operator fees are taken from live operator records for each cluster, then converted to ETH.

- private operator with live fee `0` remains `0`
- all other operators use live fee converted with current `SSV -> ETH` rate

No public-operator forecast strategy is used in the default estimator path.

## Manual Override Mode

- Default behavior remains protocol-grounded: live operator fees are used directly.
- Optional manual mode lets users override operator fees per operator in ETH/year.
- Manual ETH/year inputs are converted internally to protocol units (gwei/block) using the app's blocks/day assumption.
- Manual mode is off by default and clearly marked as non-default.

## Project Structure

- `src/app/page.tsx` UI page
- `src/components/EstimatorForm.tsx` form + request handling
- `src/components/EstimateResults.tsx` result rendering
- `src/app/api/estimate/route.ts` API endpoint + validation
- `src/lib/forecast-config.ts` env-backed forecast defaults
- `src/lib/estimate/computeDepositFromRunway.ts` pure formula
- `src/lib/estimate/buildClusterForecastInput.ts` adapter from live data + forecast config
- `src/lib/estimate/estimateService.ts` orchestration and owner aggregation
- `src/lib/ssv/*` data-fetching layer (subgraph + SSV API)

## Environment Variables

Copy `.env.example` to `.env.local` and adjust as needed.

- `SSV_SUBGRAPH_URL`: SSV mainnet subgraph endpoint (used for operator fee data)
- `SSV_SUBGRAPH_API_KEY`: optional Graph auth key
- `SSV_API_BASE_URL`: SSV API base URL (used for cluster effective balance)
- `SSV_API_NETWORK`: SSV API network name/path segment (default `mainnet`)
- `SSV_TO_ETH_RATE_WEI`: optional fixed conversion rate (`1 SSV = X ETH`, encoded in wei)
- `SSV_TO_ETH_RATE_CACHE_TTL_SECONDS`: cache TTL for live SSV/ETH rate (default `600`)

Live conversion rate behavior (when `SSV_TO_ETH_RATE_WEI` is not set):
- primary source: CoinGecko (`ssv-network` vs `eth`)
- fallback source: Binance derived (`SSVBTC / ETHBTC`)
- server-side cache with TTL from `SSV_TO_ETH_RATE_CACHE_TTL_SECONDS`
- if live providers fail and a cached value exists, cached value is reused and marked as cached in the UI assumptions
- `DEFAULT_RUNWAY_DAYS`: default runway value
- `FORECAST_ETH_NETWORK_FEE_WEI`
- `FORECAST_MINIMUM_LIQUIDATION_COLLATERAL_WEI`
- `FORECAST_LIQUIDATION_THRESHOLD`
- `FORECAST_ASSUMPTIONS_LABEL`
- `BLOCKS_PER_DAY`
- `VUNITS_PRECISION`
- `APP_DISCLAIMER_TEXT`

## Run Locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

## Tests

```bash
pnpm test
```

Included representative tests:
- private zero-fee cluster
- live public fee cluster
- multiple clusters in owner mode (aggregated total)

## Production Build

```bash
pnpm build
pnpm start
```

## Deploy to Vercel

1. Push this folder to a Git repo.
2. Import project in Vercel.
3. Set the same environment variables from `.env.example`.
4. Deploy.

No extra build customization is required.

## Updating Forecast Parameters

Primary location:
- environment variables (`.env.local` / Vercel env settings)

Code defaults fallback:
- `src/lib/forecast-config.ts`

UI testing overrides:
- "protocol parameter overrides" section in the form
