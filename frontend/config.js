import { isValidStarknetAddress } from "./starknet.js";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_RELAYER_URL = "http://127.0.0.1:4000";
const DEFAULT_STARKNET_RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
const DEFAULT_STARKNET_EXPLORER_TX_URL = "https://sepolia.starkscan.co/tx/";
const DEFAULT_STARKNET_CHAIN_ID = "SN_SEPOLIA";
const DEFAULT_STARKNET_NETWORK_NAME = "Starknet Sepolia";
const DEFAULT_STARKNET_EXPLORER_SITE_URL = "https://sepolia.starkscan.co/";

function cleanValue(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatReadableTokenAmount(value, fallback) {
  const trimmed = cleanValue(value);
  if (!trimmed || !/^[0-9]+$/.test(trimmed)) {
    return fallback;
  }

  const amount = BigInt(trimmed);
  const base = 10n ** 18n;
  const whole = amount / base;
  const fraction = amount % base;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function defaultReadableAmount(readableEnv, weiEnv, fallback) {
  const readable = cleanValue(readableEnv);
  if (readable) {
    return readable;
  }

  return formatReadableTokenAmount(weiEnv, fallback);
}

export const appConfig = {
  apiBaseUrl: cleanValue(import.meta.env.VITE_API_BASE_URL, DEFAULT_API_BASE_URL),
  relayerUrl: cleanValue(import.meta.env.VITE_ZUS_RELAYER_URL, DEFAULT_RELAYER_URL),
  campaignMessage: cleanValue(import.meta.env.VITE_ZUS_CAMPAIGN_MESSAGE, "ZUSMVP01"),
  defaultPayoutAvax: defaultReadableAmount(
    import.meta.env.VITE_ZUS_DEFAULT_PAYOUT,
    import.meta.env.VITE_ZUS_DEFAULT_PAYOUT_WEI,
    "0.0001",
  ),
  defaultFundingAvax: defaultReadableAmount(
    import.meta.env.VITE_ZUS_DEFAULT_FUNDING,
    import.meta.env.VITE_ZUS_DEFAULT_FUNDING_WEI,
    "0.0001",
  ),
  starknet: {
    rpcUrl: cleanValue(import.meta.env.VITE_STARKNET_RPC_URL || import.meta.env.VITE_RPC_URL, DEFAULT_STARKNET_RPC_URL),
    protocolAddress: cleanValue(import.meta.env.VITE_STARKNET_PROTOCOL_ADDRESS || import.meta.env.VITE_ZUS_PROTOCOL_ADDRESS),
    verifierAddress: cleanValue(
      import.meta.env.VITE_STARKNET_VERIFIER_ADDRESS || import.meta.env.VITE_ZUS_VERIFIER_ADDRESS,
      cleanValue(import.meta.env.VITE_STARKNET_PROTOCOL_ADDRESS || import.meta.env.VITE_ZUS_PROTOCOL_ADDRESS),
    ),
    payoutTokenAddress: cleanValue(import.meta.env.VITE_STARKNET_PAYOUT_TOKEN_ADDRESS || import.meta.env.VITE_ZUS_PAYOUT_TOKEN_ADDRESS),
    explorerBaseUrl: cleanValue(import.meta.env.VITE_STARKNET_EXPLORER_BASE_URL || import.meta.env.VITE_EXPLORER_BASE_URL, DEFAULT_STARKNET_EXPLORER_TX_URL),
    explorerSiteUrl: cleanValue(import.meta.env.VITE_STARKNET_EXPLORER_SITE_URL || import.meta.env.VITE_EXPLORER_SITE_URL, DEFAULT_STARKNET_EXPLORER_SITE_URL),
    chainId: cleanValue(import.meta.env.VITE_STARKNET_CHAIN_ID || import.meta.env.VITE_CHAIN_ID, DEFAULT_STARKNET_CHAIN_ID),
    networkName: cleanValue(import.meta.env.VITE_STARKNET_NETWORK_NAME || import.meta.env.VITE_NETWORK_NAME, DEFAULT_STARKNET_NETWORK_NAME),
  },
};

export function resolveApiUrl(path) {
  const base = appConfig.apiBaseUrl;

  if (base.startsWith("http://") || base.startsWith("https://")) {
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    return new URL(path.replace(/^\//, ""), normalizedBase).toString();
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/$/, "")}${normalizedPath}`;
}

export function getExplorerBaseUrl() {
  return appConfig.starknet.explorerBaseUrl;
}

export function getNetworkName() {
  return appConfig.starknet.networkName;
}

export function getCreateCampaignConfigErrors() {
  const issues = [];
  const messageBytes = new TextEncoder().encode(appConfig.campaignMessage);

  if (!appConfig.apiBaseUrl) {
    issues.push("VITE_API_BASE_URL");
  }

  if (!appConfig.relayerUrl) {
    issues.push("VITE_ZUS_RELAYER_URL");
  }

  if (!appConfig.starknet.rpcUrl) {
    issues.push("VITE_STARKNET_RPC_URL");
  }
  if (!isValidStarknetAddress(appConfig.starknet.protocolAddress)) {
    issues.push("VITE_STARKNET_PROTOCOL_ADDRESS");
  }
  if (!isValidStarknetAddress(appConfig.starknet.payoutTokenAddress)) {
    issues.push("VITE_STARKNET_PAYOUT_TOKEN_ADDRESS");
  }
  if (appConfig.starknet.verifierAddress && !isValidStarknetAddress(appConfig.starknet.verifierAddress)) {
    issues.push("VITE_STARKNET_VERIFIER_ADDRESS");
  }
  if (
    messageBytes.length === 0 ||
    messageBytes.length > 31 ||
    [...messageBytes].some((byte) => byte > 0x7f)
  ) {
    issues.push("VITE_ZUS_CAMPAIGN_MESSAGE(1-31 ASCII chars for Starknet)");
  }

  return issues;
}
