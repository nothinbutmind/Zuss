import { createServer } from "node:http";
import {
  Account,
  Contract as StarknetContract,
  RpcProvider,
  addAddressPadding,
  json,
  validateAndParseAddress,
} from "starknet";

const DEFAULT_PORT = 4000;
const DEFAULT_STARKNET_RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
const ZUS_PROTOCOL_ABI = [
  {
    type: "struct",
    name: "zus_protocol_starknet::types::ClaimPublicInputs",
    members: [
      { name: "message_domain", type: "core::felt252" },
      { name: "eligible_root", type: "core::felt252" },
      { name: "ephemeral_pubkey_x", type: "core::felt252" },
      { name: "ephemeral_pubkey_y", type: "core::felt252" },
      { name: "nullifier_hash", type: "core::felt252" },
      {
        name: "stealth_address",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
  },
  {
    type: "interface",
    name: "zus_protocol_starknet::contracts::zus_protocol::IZusProtocol",
    items: [
      {
        type: "function",
        name: "claim",
        inputs: [
          { name: "campaign_id", type: "core::felt252" },
          {
            name: "claim",
            type: "zus_protocol_starknet::types::ClaimPublicInputs",
          },
          { name: "proof", type: "core::array::Span::<core::felt252>" },
        ],
        outputs: [],
        state_mutability: "external",
      },
    ],
  },
];

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
    message_domain: `${claim.message_domain}`,
    eligible_root: `${claim.eligible_root}`,
    ephemeral_pubkey_x: `${claim.ephemeral_pubkey_x}`,
    ephemeral_pubkey_y: `${claim.ephemeral_pubkey_y}`,
    nullifier_hash: `${claim.nullifier_hash}`,
    stealth_address: normalizeStarknetAddress(claim.stealth_address),
  };
}

async function relayStarknetClaim(body, context) {
  validateStarknetProof(body.proof);

  const claim = validateStarknetClaim(body.claim);

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
  const starknetProtocolAbi = ZUS_PROTOCOL_ABI;
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
