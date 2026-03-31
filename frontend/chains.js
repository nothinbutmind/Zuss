import {
  coerceTextOrNumericToFelt,
  connectStarknetWallet,
  createWalletAccount,
  encodeMessageDomain,
  executeCampaignDeployment as executeStarknetCampaignDeployment,
  isValidStarknetAddress,
  normalizeStarknetAddress,
  parseTokenAmount,
} from "./starknet.js";

export const CHAIN_OPTIONS = [{ key: "starknet", label: "Starknet" }];

export function normalizeChainKey() {
  return "starknet";
}

export function isValidAddressForChain(_chain, value) {
  return isValidStarknetAddress(value);
}

export function normalizeAddressForChain(_chain, value) {
  return normalizeStarknetAddress(value);
}

export function parseAmountForChain(_chain, value) {
  return parseTokenAmount(value);
}

export function formatAmountForChain(_chain, value) {
  return typeof value === "bigint" ? value.toString() : `${value}`;
}

export async function connectWalletForChain(_chain, appConfig, options = {}) {
  return connectStarknetWallet({ rpcUrl: appConfig.starknet.rpcUrl, ...options });
}

export function buildWalletAccountForChain(_chain, appConfig, walletProvider, address) {
  return createWalletAccount(appConfig.starknet.rpcUrl, walletProvider, address);
}

export async function executeCampaignDeploymentForChain(_chain, appConfig, walletAccount, deployment) {
  return executeStarknetCampaignDeployment({
    rpcUrl: appConfig.starknet.rpcUrl,
    walletAccount,
    protocolAddress: appConfig.starknet.protocolAddress,
    payoutTokenAddress: appConfig.starknet.payoutTokenAddress,
    verifierAddress: appConfig.starknet.verifierAddress || appConfig.starknet.protocolAddress,
    campaignId: await coerceTextOrNumericToFelt(
      deployment.apiCampaign.onchain_campaign_id || deployment.apiCampaign.campaign_id,
    ),
    eligibleRoot: await coerceTextOrNumericToFelt(deployment.apiCampaign.merkle_root),
    messageDomain: encodeMessageDomain(appConfig.campaignMessage),
    payoutAmount: BigInt(deployment.payoutWei),
    fundingAmount: BigInt(deployment.fundingWei),
    metadataHash: await coerceTextOrNumericToFelt(
      `${deployment.apiCampaign.campaign_id}:${deployment.apiCampaign.name || deployment.apiCampaign.onchain_campaign_id || ""}`,
    ),
  });
}
