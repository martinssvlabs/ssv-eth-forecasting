import { forecastConfig } from '@/lib/forecast-config';
import type { SsvToEthRate } from '@/lib/estimate/types';
import { parseEther } from 'viem';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ssv-network&vs_currencies=eth&include_last_updated_at=true';
const BINANCE_SSV_BTC_URL =
  'https://api.binance.com/api/v3/ticker/price?symbol=SSVBTC';
const BINANCE_ETH_BTC_URL =
  'https://api.binance.com/api/v3/ticker/price?symbol=ETHBTC';
const REQUEST_TIMEOUT_MS = 4500;

type CachedRate = {
  value: SsvToEthRate;
  expiresAtMs: number;
};

type CoinGeckoResponse = {
  'ssv-network'?: {
    eth?: number;
    last_updated_at?: number;
  };
};

type BinanceTickerResponse = {
  price?: string;
};

let cachedRate: CachedRate | null = null;
let inFlightRate: Promise<SsvToEthRate> | null = null;

const isPositiveFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
};

const parseRateWei = (value: string): bigint => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Empty conversion rate');
  }
  return parseEther(normalized);
};

const getNowUnix = () => Math.floor(Date.now() / 1000);

const resolveConfiguredRate = (): SsvToEthRate | null => {
  const configured = forecastConfig.ssvToEthRateWeiOverride;
  if (!configured) return null;
  if (configured <= 0n) {
    throw new Error('SSV_TO_ETH_RATE_WEI must be greater than 0');
  }

  return {
    rateWei: configured,
    source: 'env_override',
    fetchedAtUnix: getNowUnix(),
    stale: false,
  };
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchFromCoinGecko = async (): Promise<SsvToEthRate> => {
  const json = await fetchJson<CoinGeckoResponse>(COINGECKO_URL);
  const payload = json['ssv-network'];

  if (!payload || !isPositiveFiniteNumber(payload.eth)) {
    throw new Error('CoinGecko response missing ssv-network.eth');
  }

  const rateWei = parseRateWei(String(payload.eth));
  if (rateWei <= 0n) {
    throw new Error('CoinGecko returned non-positive conversion rate');
  }

  return {
    rateWei,
    source: 'coingecko',
    fetchedAtUnix:
      isPositiveFiniteNumber(payload.last_updated_at) &&
      Number.isInteger(payload.last_updated_at)
        ? payload.last_updated_at
        : getNowUnix(),
    stale: false,
  };
};

const parseTickerPrice = (value: string | undefined, label: string): number => {
  if (!value) {
    throw new Error(`${label} missing price`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} invalid price`);
  }

  return parsed;
};

const fetchFromBinanceDerived = async (): Promise<SsvToEthRate> => {
  const [ssvBtc, ethBtc] = await Promise.all([
    fetchJson<BinanceTickerResponse>(BINANCE_SSV_BTC_URL),
    fetchJson<BinanceTickerResponse>(BINANCE_ETH_BTC_URL),
  ]);

  const ssvBtcPrice = parseTickerPrice(ssvBtc.price, 'SSVBTC');
  const ethBtcPrice = parseTickerPrice(ethBtc.price, 'ETHBTC');
  const ssvEthPrice = ssvBtcPrice / ethBtcPrice;
  if (!Number.isFinite(ssvEthPrice) || ssvEthPrice <= 0) {
    throw new Error('Derived SSV/ETH price is invalid');
  }

  const rateWei = parseRateWei(String(ssvEthPrice));

  return {
    rateWei,
    source: 'binance_derived',
    fetchedAtUnix: getNowUnix(),
    stale: false,
  };
};

const getCachedRate = (): SsvToEthRate | null => {
  if (!cachedRate) return null;
  if (Date.now() < cachedRate.expiresAtMs) {
    return cachedRate.value;
  }
  return null;
};

const saveCachedRate = (value: SsvToEthRate): void => {
  const ttlMs = Math.max(1, forecastConfig.ssvToEthRateCacheTtlSeconds) * 1000;
  cachedRate = {
    value,
    expiresAtMs: Date.now() + ttlMs,
  };
};

export const getSsvToEthRateWei = async (): Promise<SsvToEthRate> => {
  const configured = resolveConfiguredRate();
  if (configured) {
    return configured;
  }

  const activeCache = getCachedRate();
  if (activeCache) {
    return activeCache;
  }

  if (inFlightRate) {
    return inFlightRate;
  }

  inFlightRate = (async () => {
    const errors: string[] = [];
    const providers: Array<() => Promise<SsvToEthRate>> = [
      fetchFromCoinGecko,
      fetchFromBinanceDerived,
    ];

    for (const provider of providers) {
      try {
        const value = await provider();
        saveCachedRate(value);
        return value;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'unknown provider error');
      }
    }

    if (cachedRate) {
      return {
        ...cachedRate.value,
        stale: true,
      };
    }

    throw new Error(
      `Could not resolve live SSV/ETH conversion rate from providers. Set SSV_TO_ETH_RATE_WEI as fallback. Details: ${errors.join(' | ')}`,
    );
  })();

  try {
    return await inFlightRate;
  } finally {
    inFlightRate = null;
  }
};
