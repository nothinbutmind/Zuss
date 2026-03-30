import {
  coerceTextOrNumericToFelt,
  connectStarknetWallet,
  createWalletAccount,
  encodeMessageDomain,
  executeCampaignDeployment as executeStarknetCampaignDeployment,
  isValidStarknetAddress,
  normalizeStarknetAddress,
  parseTokenAmount,
  prepareRelayedClaim as prepareStarknetRelayedClaim,
} from "./starknet.js";
import {
  connectFlowWallet,
  encodeFlowMessageDomain,
  executeFlowCampaignDeployment,
  formatFlowAmount,
  isValidFlowAddress,
  normalizeFlowAddress,
  parseFlowAmount,
  prepareFlowRelayedClaim,
} from "./flow.js";

export const CHAIN_OPTIONS = [
  { key: "flow_evm", label: "Flow EVM" },
  { key: "starknet", label: "Starknet" },
];

export function normalizeChainKey(value) {
  return value === "flow" || value === "flow-evm" ? "flow_evm" : value === "starknet" ? "starknet" : "starknet";
}

export function isValidAddressForChain(chain, value) {
  return normalizeChainKey(chain) === "flow_evm"
    ? isValidFlowAddress(value)
    : isValidStarknetAddress(value);
}

export function normalizeAddressForChain(chain, value) {
  return normalizeChainKey(chain) === "flow_evm"
    ? normalizeFlowAddress(value)
    : normalizeStarknetAddress(value);
}

export function parseAmountForChain(chain, value) {
  return normalizeChainKey(chain) === "flow_evm" ? parseFlowAmount(value) : parseTokenAmount(value);
}

export function formatAmountForChain(chain, value) {
  return normalizeChainKey(chain) === "flow_evm" ? formatFlowAmount(value) : formatFlowAmount(value);
}

export async function connectWalletForChain(chain, appConfig, options = {}) {
  if (normalizeChainKey(chain) === "flow_evm") {
    return connectFlowWallet(options);
  }

  return connectStarknetWallet({ rpcUrl: appConfig.starknet.rpcUrl, ...options });
}

export function buildWalletAccountForChain(chain, appConfig, walletProvider, address) {
  if (normalizeChainKey(chain) === "flow_evm") {
    return null;
  }

  return createWalletAccount(appConfig.starknet.rpcUrl, walletProvider, address);
}

export async function executeCampaignDeploymentForChain(chain, appConfig, walletAccount, deployment) {
  if (normalizeChainKey(chain) === "flow_evm") {
    return executeFlowCampaignDeployment({
      walletAccount,
      protocolAddress: appConfig.flow.protocolAddress,
      verifierAddress: appConfig.flow.verifierAddress,
      campaignId: deployment.apiCampaign.onchain_campaign_id || deployment.apiCampaign.campaign_id,
      eligibleRoot: deployment.apiCampaign.merkle_root,
      messageDomain: encodeFlowMessageDomain(appConfig.campaignMessage),
      payoutAmount: BigInt(deployment.payoutWei),
      fundingAmount: BigInt(deployment.fundingWei),
    });
  }

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

export async function prepareRelayedClaimForChain(chain, appConfig, walletAccount, walletState, claimPayload) {
  if (normalizeChainKey(chain) === "flow_evm") {
    return prepareFlowRelayedClaim({
      walletAccount,
      claimPayload,
      campaignMessage: appConfig.campaignMessage,
    });
  }

  return prepareStarknetRelayedClaim({
    walletAccount,
    chainId: walletState.chainId || appConfig.starknet.chainId,
    claimPayload,
    campaignMessage: appConfig.campaignMessage,
  });
}
