import { connect } from "@starknet-io/get-starknet";
import {
  Contract,
  RpcProvider,
  WalletAccount,
  addAddressPadding,
  cairo,
  ec,
  hash,
  shortString,
  validateAndParseAddress,
} from "starknet";
import { erc20Abi, zusProtocolAbi } from "./zusProtocolAbi.js";

const SUPPORTED_WALLETS = ["argentX", "braavos"];
const STARK_FIELD_PRIME = (1n << 251n) + (17n << 192n) + 1n;
const DECIMALS = 18;
const TREE_DEPTH = 12;
const NULLIFIER_DOMAIN = BigInt(shortString.encodeShortString("NULLIFIER_V1"));
const STEALTH_ADDR_DOMAIN = BigInt(shortString.encodeShortString("STEALTH_ADDR"));
const RETRY_ADDR_DOMAIN = BigInt(shortString.encodeShortString("STEALTH_RETRY"));
const WITNESS_SEED_DOMAIN = BigInt(shortString.encodeShortString("ZUS_WITNESS"));
const STEALTH_SEED_DOMAIN = BigInt(shortString.encodeShortString("ZUS_STEALTH"));

function getBrowserCrypto() {
  if (typeof globalThis === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error("This browser does not support the Web Crypto API required for Starknet hashing.");
  }

  return globalThis.crypto;
}

export function getRpcProvider(rpcUrl) {
  return new RpcProvider({ nodeUrl: rpcUrl });
}

export function createWalletAccount(rpcUrl, walletProvider, address) {
  return new WalletAccount(getRpcProvider(rpcUrl), walletProvider, normalizeStarknetAddress(address));
}

export function isValidStarknetAddress(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    validateAndParseAddress(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function normalizeStarknetAddress(value) {
  return addAddressPadding(validateAndParseAddress(value.trim()));
}

export function formatTokenAmount(value, decimals = DECIMALS) {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function parseTokenAmount(value, decimals = DECIMALS) {
  const trimmed = value.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid token amount.");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Token amounts support at most ${decimals} decimal places.`);
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  const normalized = `${whole}${paddedFraction}`.replace(/^0+/, "") || "0";
  return BigInt(normalized);
}

export function encodeMessageDomain(message) {
  return shortString.encodeShortString(message.trim());
}

export function toFeltHex(value) {
  const asBigInt =
    typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(value)
        : BigInt(`${value}`.trim());

  if (asBigInt < 0n) {
    throw new Error("felt252 values must be non-negative.");
  }

  return `0x${asBigInt.toString(16)}`;
}

function toBigIntFelt(value) {
  return BigInt(typeof value === "string" ? value : toFeltHex(value));
}

function nonZeroFeltHex(value) {
  const normalized = toBigIntFelt(value) % STARK_FIELD_PRIME;
  return toFeltHex(normalized === 0n ? 1n : normalized);
}

function poseidonElements(elements) {
  return nonZeroFeltHex(hash.computePoseidonHashOnElements(elements.map(toBigIntFelt)));
}

function pointToAddress(point, domain) {
  let candidate = poseidonElements([domain, point.x, point.y]);

  while (true) {
    try {
      return normalizeStarknetAddress(candidate);
    } catch {
      candidate = poseidonElements([RETRY_ADDR_DOMAIN, candidate]);
    }
  }
}

function deriveNullifier(walletSecret, messageDomain) {
  const digest0 = hash.computePedersenHash(NULLIFIER_DOMAIN, toBigIntFelt(walletSecret));
  return toFeltHex(hash.computePedersenHash(digest0, toBigIntFelt(messageDomain)));
}

function deriveStealthAddress(walletSecret, stealthTweak) {
  const basePoint = ec.starkCurve.ProjectivePoint.BASE.multiply(toBigIntFelt(walletSecret));
  const tweakPoint = ec.starkCurve.ProjectivePoint.BASE.multiply(toBigIntFelt(stealthTweak));
  const stealthPoint = basePoint.add(tweakPoint).toAffine();
  const baseAddress = pointToAddress(basePoint.toAffine(), STEALTH_ADDR_DOMAIN);
  const stealthAddress = pointToAddress(stealthPoint, STEALTH_ADDR_DOMAIN);

  if (stealthAddress === baseAddress) {
    throw new Error("Stealth derivation collapsed back to the base address.");
  }

  return stealthAddress;
}

function verifyMerkleMembership(leafAddress, root, proofPath, leafIndex) {
  if (proofPath.length !== TREE_DEPTH) {
    return false;
  }

  let current = toBigIntFelt(leafAddress);
  let index = Number(leafIndex);

  for (const sibling of proofPath) {
    current =
      index % 2 === 0
        ? hash.computePedersenHash(current, toBigIntFelt(sibling))
        : hash.computePedersenHash(toBigIntFelt(sibling), current);
    index = Math.floor(index / 2);
  }

  return toBigIntFelt(current) === toBigIntFelt(root);
}

function buildWitnessSeedTypedData(chainId, claimantAddress, campaignId, eligibleRoot) {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
      ],
      WitnessSeed: [
        { name: "campaign_id", type: "felt" },
        { name: "claimant_address", type: "ContractAddress" },
        { name: "eligible_root", type: "felt" },
      ],
    },
    primaryType: "WitnessSeed",
    domain: {
      name: "ZUS_RELAYER",
      version: "1",
      chainId,
    },
    message: {
      campaign_id: campaignId,
      claimant_address: claimantAddress,
      eligible_root: eligibleRoot,
    },
  };
}

export function buildClaimAuthorizationTypedData(chainId, campaignId, claim) {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
      ],
      ClaimAuthorization: [
        { name: "campaign_id", type: "felt" },
        { name: "claimant_address", type: "ContractAddress" },
        { name: "message_domain", type: "felt" },
        { name: "eligible_root", type: "felt" },
        { name: "nullifier_hash", type: "felt" },
        { name: "stealth_address", type: "ContractAddress" },
      ],
    },
    primaryType: "ClaimAuthorization",
    domain: {
      name: "ZUS_RELAYER",
      version: "1",
      chainId,
    },
    message: {
      campaign_id: campaignId,
      claimant_address: claim.claimant_address,
      message_domain: claim.message_domain,
      eligible_root: claim.eligible_root,
      nullifier_hash: claim.nullifier_hash,
      stealth_address: claim.stealth_address,
    },
  };
}

export async function hashTextToFelt(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await getBrowserCrypto().subtle.digest("SHA-256", bytes);
  const digestBytes = new Uint8Array(digest);

  let value = 0n;
  for (const byte of digestBytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return `0x${(value % STARK_FIELD_PRIME).toString(16)}`;
}

export async function coerceTextOrNumericToFelt(value) {
  const trimmed = `${value ?? ""}`.trim();
  if (!trimmed) {
    throw new Error("Missing felt252 value.");
  }

  if (/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) {
    return toFeltHex(trimmed);
  }

  return hashTextToFelt(trimmed);
}

async function hydrateWalletSession(walletProvider, rpcUrl, silentMode) {
  const accounts = await walletProvider.request({
    type: "wallet_requestAccounts",
    params: { silent_mode: silentMode },
  });
  const address = accounts?.[0] ? normalizeStarknetAddress(accounts[0]) : "";

  if (!address) {
    return null;
  }

  const chainId = await walletProvider.request({ type: "wallet_requestChainId" });
  const walletAccount = createWalletAccount(rpcUrl, walletProvider, address);

  return {
    address,
    chainId: chainId ? String(chainId) : "",
    walletProvider,
    walletAccount,
    walletName: walletProvider.name || "",
    walletId: walletProvider.id || "",
  };
}

export async function connectStarknetWallet({ rpcUrl, silent = false } = {}) {
  const walletProvider = await connect({
    include: SUPPORTED_WALLETS,
    modalMode: silent ? "neverAsk" : "alwaysAsk",
    modalTheme: "dark",
  });

  if (!walletProvider) {
    return null;
  }

  return hydrateWalletSession(walletProvider, rpcUrl, silent);
}

export async function executeCampaignDeployment({
  rpcUrl,
  walletAccount,
  protocolAddress,
  payoutTokenAddress,
  verifierAddress,
  campaignId,
  eligibleRoot,
  messageDomain,
  payoutAmount,
  fundingAmount,
  metadataHash,
}) {
  const protocol = new Contract(zusProtocolAbi, protocolAddress, walletAccount);
  const token = new Contract(erc20Abi, payoutTokenAddress, walletAccount);

  const calls = [
    protocol.populate("create_campaign", {
      campaign_id: campaignId,
      verifier: verifierAddress,
      payout_token: payoutTokenAddress,
      eligible_root: eligibleRoot,
      message_domain: messageDomain,
      payout_amount: cairo.uint256(payoutAmount),
      metadata_hash: metadataHash,
    }),
    token.populate("approve", {
      spender: protocolAddress,
      amount: cairo.uint256(fundingAmount),
    }),
    protocol.populate("fund_campaign", {
      campaign_id: campaignId,
      amount: cairo.uint256(fundingAmount),
    }),
  ];

  const response = await walletAccount.execute(calls);
  await getRpcProvider(rpcUrl).waitForTransaction(response.transaction_hash);
  return response.transaction_hash;
}

export async function prepareRelayedClaim({
  walletAccount,
  chainId,
  claimPayload,
  campaignMessage,
}) {
  const claimantAddress = normalizeStarknetAddress(claimPayload.leaf_address);
  const campaignId = await coerceTextOrNumericToFelt(
    claimPayload.onchain_campaign_id || claimPayload.campaign_id,
  );
  const messageDomain = encodeMessageDomain(campaignMessage);
  const eligibleRoot = toFeltHex(claimPayload.merkle_root);
  const eligiblePath = claimPayload.proof.map((value) => toFeltHex(value));
  const eligibleIndex = Number(claimPayload.index);

  if (!Number.isInteger(eligibleIndex) || eligibleIndex < 0) {
    throw new Error("Invalid Merkle index returned by the campaign API.");
  }

  if (!verifyMerkleMembership(claimantAddress, eligibleRoot, eligiblePath, eligibleIndex)) {
    throw new Error("The campaign proof returned by the API failed local Merkle verification.");
  }

  const witnessSeedTypedData = buildWitnessSeedTypedData(
    chainId,
    claimantAddress,
    campaignId,
    eligibleRoot,
  );
  const witnessSeedSignature = await walletAccount.signMessage(witnessSeedTypedData);
  const walletSecret = poseidonElements([
    WITNESS_SEED_DOMAIN,
    campaignId,
    claimantAddress,
    ...witnessSeedSignature,
  ]);
  const stealthTweak = poseidonElements([
    STEALTH_SEED_DOMAIN,
    eligibleRoot,
    claimantAddress,
    ...witnessSeedSignature,
  ]);

  const claim = {
    claimant_address: claimantAddress,
    message_domain: toFeltHex(messageDomain),
    eligible_root: eligibleRoot,
    nullifier_hash: deriveNullifier(walletSecret, messageDomain),
    stealth_address: deriveStealthAddress(walletSecret, stealthTweak),
  };

  const authorizationTypedData = buildClaimAuthorizationTypedData(chainId, campaignId, claim);
  const authorizationSignature = await walletAccount.signMessage(authorizationTypedData);

  return {
    campaign_id: campaignId,
    claim,
    proof: [walletSecret, stealthTweak, toFeltHex(eligibleIndex), ...eligiblePath],
    authorization: {
      signature: authorizationSignature,
      typed_data: authorizationTypedData,
    },
  };
}
