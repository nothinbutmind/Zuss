import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  Contract as StarknetContract,
  RpcProvider,
  addAddressPadding,
  json,
  validateAndParseAddress,
} from "starknet";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STARKNET_DIR = resolve(__dirname, "..");
const TARGET_DIR = join(STARKNET_DIR, "target", "dev");
const PROTOCOL_ARTIFACT = join(TARGET_DIR, "zus_protocol_starknet_ZusProtocol.contract_class.json");
const DEFAULT_PORT = 4000;
const DEFAULT_STARKNET_RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function jsonResponse(statusCode, payload) {
  return Response.json(payload, {
    status: statusCode,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function normalizeStarknetAddress(value) {
  return addAddressPadding(validateAndParseAddress(`${value}`.trim()));
}

function validateStarknetProof(proof) {
  if (!Array.isArray(proof) || proof.length !== 14) {
    throw new Error("Starknet proof must be an array of 14 felt252 values.");
  }
}

function validateStarknetClaim(claim) {
  if (!claim || typeof claim !== "object") {
    throw new Error("Claim payload is required.");
  }

  return {
    claimant_address: normalizeStarknetAddress(claim.claimant_address),
    message_domain: `${claim.message_domain}`,
    eligible_root: `${claim.eligible_root}`,
    ephemeral_pubkey_x: `${claim.ephemeral_pubkey_x}`,
    ephemeral_pubkey_y: `${claim.ephemeral_pubkey_y}`,
    nullifier_hash: `${claim.nullifier_hash}`,
    stealth_address: normalizeStarknetAddress(claim.stealth_address),
  };
}

function buildStarknetAuthorizationTypedData(chainId, campaignId, claim) {
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
        { name: "ephemeral_pubkey_x", type: "felt" },
        { name: "ephemeral_pubkey_y", type: "felt" },
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
      campaign_id: `${campaignId}`,
      claimant_address: claim.claimant_address,
      message_domain: claim.message_domain,
      eligible_root: claim.eligible_root,
      ephemeral_pubkey_x: claim.ephemeral_pubkey_x,
      ephemeral_pubkey_y: claim.ephemeral_pubkey_y,
      nullifier_hash: claim.nullifier_hash,
      stealth_address: claim.stealth_address,
    },
  };
}

function loadStarknetProtocolAbi() {
  if (!existsSync(PROTOCOL_ARTIFACT)) {
    throw new Error(
      `Protocol artifact not found at ${PROTOCOL_ARTIFACT}. Run 'scarb build' in starknet/ before starting the relayer.`,
    );
  }

  const artifact = json.parse(readFileSync(PROTOCOL_ARTIFACT, "utf8"));
  return artifact.abi;
}

async function relayStarknetClaim(body, context) {
  validateStarknetProof(body.proof);

  if (!Array.isArray(body.authorization?.signature)) {
    throw new Error("authorization.signature is required for Starknet claims.");
  }

  const claim = validateStarknetClaim(body.claim);
  const chainId = body.authorization?.typed_data?.domain?.chainId || context.chainId;
  const authorizationTypedData = buildStarknetAuthorizationTypedData(chainId, body.campaign_id, claim);
  const isAuthorized = await context.provider.verifyMessageInStarknet(
    authorizationTypedData,
    body.authorization.signature,
    claim.claimant_address,
  );

  if (!isAuthorized) {
    return jsonResponse(403, { error: "Claim authorization signature is invalid." });
  }

  const protocol = new StarknetContract(context.protocolAbi, context.protocolAddress, context.relayerAccount);
  const invoke = await protocol.invoke("claim", {
    campaign_id: `${body.campaign_id}`,
    claim,
    proof: body.proof.map((value) => `${value}`),
  });

  return jsonResponse(200, {
    chain: "starknet",
    transaction_hash: invoke.transaction_hash,
    relayed_by: context.relayerAccount.address,
    stealth_address: claim.stealth_address,
    claimant_address: claim.claimant_address,
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const starknetProvider = new RpcProvider({
    nodeUrl: process.env.STARKNET_RPC_URL?.trim() || DEFAULT_STARKNET_RPC_URL,
  });
  const starknetProtocolAddress = normalizeStarknetAddress(requireEnv("ZUS_PROTOCOL_ADDRESS"));
  const starknetRelayerAddress = normalizeStarknetAddress(requireEnv("RELAYER_ACCOUNT_ADDRESS"));
  const starknetRelayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY");
  const starknetProtocolAbi = loadStarknetProtocolAbi();
  const starknetChainId = process.env.STARKNET_CHAIN_ID?.trim() || "SN_SEPOLIA";
  const starknetRelayerAccount = new Account({
    provider: starknetProvider,
    address: starknetRelayerAddress,
    signer: starknetRelayerPrivateKey,
  });
  const port = Number.parseInt(process.env.PORT || `${DEFAULT_PORT}`, 10);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        const optionsResponse = jsonResponse(204, {});
        response.writeHead(optionsResponse.status, Object.fromEntries(optionsResponse.headers));
        response.end();
        return;
      }

      if (request.url === "/health" && request.method === "GET") {
        const health = jsonResponse(200, { status: "ok" });
        response.writeHead(health.status, Object.fromEntries(health.headers));
        response.end(await health.text());
        return;
      }

      if (request.url === "/relay-claim" && request.method === "POST") {
        const body = await readBody(request);
        const relayResponse = await relayStarknetClaim(body, {
          provider: starknetProvider,
          protocolAbi: starknetProtocolAbi,
          protocolAddress: starknetProtocolAddress,
          relayerAccount: starknetRelayerAccount,
          chainId: starknetChainId,
        });

        response.writeHead(relayResponse.status, Object.fromEntries(relayResponse.headers));
        response.end(await relayResponse.text());
        return;
      }

      const notFound = jsonResponse(404, { error: "Not found." });
      response.writeHead(notFound.status, Object.fromEntries(notFound.headers));
      response.end(await notFound.text());
    } catch (error) {
      const failure = jsonResponse(500, {
        error: error instanceof Error ? error.message : "Unexpected relayer error.",
      });
      response.writeHead(failure.status, Object.fromEntries(failure.headers));
      response.end(await failure.text());
    }
  });

  server.listen(port, () => {
    console.log(`ZUS relayer listening on http://127.0.0.1:${port}`);
    console.log(`Starknet protocol: ${starknetProtocolAddress}`);
    console.log(`Relayer account: ${starknetRelayerAddress}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
