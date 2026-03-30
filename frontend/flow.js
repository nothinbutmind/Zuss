import { BrowserProvider, Contract, getAddress, isAddress, solidityPackedKeccak256, toUtf8Bytes, zeroPadBytes } from "ethers";
import { flowZusProtocolAbi } from "./zusProtocolAbi.js";

const DECIMALS = 18;

function getInjectedProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No EVM wallet detected. Install a Flow EVM-compatible wallet in this browser.");
  }

  return window.ethereum;
}

function normalizeBytes32(value) {
  const trimmed = `${value ?? ""}`.trim();
  if (!trimmed) {
    throw new Error("Missing bytes32 value.");
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const hex = trimmed.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    return `0x${hex.padStart(64, "0").toLowerCase()}`;
  }

  return solidityPackedKeccak256(["string"], [trimmed]);
}

export function isValidFlowAddress(value) {
  return typeof value === "string" && !!value.trim() && isAddress(value.trim());
}

export function normalizeFlowAddress(value) {
  return getAddress(value.trim());
}

export function parseFlowAmount(value, decimals = DECIMALS) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid FLOW amount.");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`FLOW amounts support at most ${decimals} decimal places.`);
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

export function formatFlowAmount(value, decimals = DECIMALS) {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function encodeFlowMessageDomain(message) {
  const bytes = toUtf8Bytes(message.trim());
  if (bytes.length === 0 || bytes.length > 8) {
    throw new Error("Flow EVM campaign messages must be 1-8 ASCII bytes.");
  }

  return `0x${Array.from(zeroPadBytes(bytes, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function connectFlowWallet({ silent = false } = {}) {
  const walletProvider = getInjectedProvider();
  const method = silent ? "eth_accounts" : "eth_requestAccounts";
  const accounts = await walletProvider.request({ method });
  const address = accounts?.[0] ? normalizeFlowAddress(accounts[0]) : "";

  if (!address) {
    return null;
  }

  const browserProvider = new BrowserProvider(walletProvider, "any");
  const signer = await browserProvider.getSigner();
  const network = await browserProvider.getNetwork();

  return {
    address,
    chainId: `0x${network.chainId.toString(16)}`,
    walletProvider,
    walletAccount: signer,
    walletName: walletProvider.isMetaMask ? "MetaMask" : "EVM Wallet",
  };
}

export async function executeFlowCampaignDeployment({
  walletAccount,
  protocolAddress,
  verifierAddress,
  campaignId,
  eligibleRoot,
  messageDomain,
  payoutAmount,
  fundingAmount,
}) {
  const protocol = new Contract(protocolAddress, flowZusProtocolAbi, walletAccount);
  const normalizedCampaignId = normalizeBytes32(campaignId);
  const normalizedRoot = normalizeBytes32(eligibleRoot);
  const createTx = await protocol.createCampaign(
    normalizedCampaignId,
    normalizeFlowAddress(verifierAddress),
    normalizedRoot,
    messageDomain,
    payoutAmount,
  );
  await createTx.wait();

  const fundTx = await protocol.fundCampaign(normalizedCampaignId, {
    value: fundingAmount,
  });
  await fundTx.wait();
  return fundTx.hash;
}

export async function prepareFlowRelayedClaim({
  walletAccount,
  claimPayload,
  campaignMessage,
}) {
  const claimantAddress = normalizeFlowAddress(claimPayload.leaf_address);
  const campaignId = normalizeBytes32(claimPayload.onchain_campaign_id || claimPayload.campaign_id);
  const merkleRoot = normalizeBytes32(claimPayload.merkle_root);
  const proofPackage = claimPayload.evm_claim || claimPayload.flow_evm_claim || null;

  if (!proofPackage?.proof || !Array.isArray(proofPackage.public_inputs)) {
    throw new Error(
      "This Flow EVM campaign does not include a browser-ready proof package yet. Add `flow_evm_claim` proof data in the shared payload to relay it.",
    );
  }

  const network = await walletAccount.provider.getNetwork();
  const domain = {
    name: "ZUS_RELAYER",
    version: "1",
    chainId: Number(network.chainId),
  };
  const types = {
    ClaimAuthorization: [
      { name: "campaign_id", type: "bytes32" },
      { name: "claimant_address", type: "address" },
      { name: "merkle_root", type: "bytes32" },
      { name: "message", type: "string" },
    ],
  };
  const message = {
    campaign_id: campaignId,
    claimant_address: claimantAddress,
    merkle_root: merkleRoot,
    message: campaignMessage,
  };
  const signature = await walletAccount.signTypedData(domain, types, message);

  return {
    chain: "flow_evm",
    campaign_id: campaignId,
    claimant_address: claimantAddress,
    merkle_root: merkleRoot,
    proof: proofPackage.proof,
    public_inputs: proofPackage.public_inputs.map((value) => normalizeBytes32(value)),
    authorization: {
      signature,
      typed_data: { domain, types, message },
    },
  };
}
