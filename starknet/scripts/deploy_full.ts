/**
 * Full Starknet deployment script for the ZUS dev stack.
 *
 * It deploys:
 * - ZusProtocol
 * - ClaimVerifier
 * - MockErc20 payout token
 *
 * Then it mints test tokens to the deployer account so campaign funding works
 * immediately from the connected wallet.
 *
 * Required env:
 * - STARKNET_ACCOUNT_ADDRESS=0x...
 * - STARKNET_PRIVATE_KEY=0x...
 *
 * Optional env:
 * - STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_8
 * - STARKNET_TOKEN_NAME=ZUS_TEST
 * - STARKNET_TOKEN_SYMBOL=ZUS
 * - STARKNET_TOKEN_DECIMALS=18
 * - STARKNET_TOKEN_MINT_WEI=1000000000000000000000000
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  Account,
  CallData,
  Contract,
  RpcProvider,
  addAddressPadding,
  cairo,
  json,
  shortString,
} from "starknet";

type DeployResult = {
  address: string;
  classHash: string;
  transactionHash: string;
  artifact: string;
  casmArtifact: string;
};

type TokenMintRecord = {
  recipient: string;
  amount: string;
  transactionHash: string;
};

type DeploymentsFile = {
  network: string;
  rpcUrl: string;
  deployer: string;
  deployedAt: string;
  contracts: {
    zusProtocol: DeployResult;
    verifier: DeployResult;
    payoutToken: DeployResult;
  };
  tokenMint: TokenMintRecord;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STARKNET_DIR = resolve(__dirname, "..");
const TARGET_DIR = join(STARKNET_DIR, "target", "dev");
const DEPLOYMENTS_PATH = join(STARKNET_DIR, "deployments.json");
const DEFAULT_RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
const DEFAULT_TOKEN_NAME = "ZUS_TEST";
const DEFAULT_TOKEN_SYMBOL = "ZUS";
const DEFAULT_TOKEN_DECIMALS = 18;
const DEFAULT_TOKEN_MINT_WEI = "1000000000000000000000000";

const ZUS_PROTOCOL_ARTIFACT = join(
  TARGET_DIR,
  "zus_protocol_starknet_ZusProtocol.contract_class.json",
);
const VERIFIER_ARTIFACT = join(
  TARGET_DIR,
  "zus_protocol_starknet_ClaimVerifier.contract_class.json",
);
const MOCK_ERC20_ARTIFACT = join(
  TARGET_DIR,
  "zus_protocol_starknet_MockErc20.contract_class.json",
);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runScarbBuild(): void {
  run("scarb", ["build"], STARKNET_DIR);
}

function ensureArtifact(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Expected compiled artifact was not found: ${path}`);
  }
}

function compileCasmArtifact(sierraPath: string): string {
  const casmPath = sierraPath.replace(/\.contract_class\.json$/, ".compiled_contract_class.json");

  if (existsSync(casmPath)) {
    return casmPath;
  }

  const attempts: Array<[string, string[]]> = [
    ["starkli", ["sierra-compile", sierraPath, casmPath]],
    ["starknet-sierra-compile", [sierraPath, casmPath]],
  ];

  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      cwd: STARKNET_DIR,
      stdio: "inherit",
      env: process.env,
    });

    if (result.error) {
      continue;
    }

    if (result.status === 0 && existsSync(casmPath)) {
      return casmPath;
    }
  }

  throw new Error(
    [
      "Unable to compile CASM for declaration.",
      "Install either `starkli` or `starknet-sierra-compile`, then rerun this script.",
      `Missing CASM output for ${sierraPath}.`,
    ].join(" "),
  );
}

function loadCompiledContract(path: string): Record<string, unknown> {
  return json.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function loadCompiledAbi(path: string): object[] {
  const artifact = loadCompiledContract(path);
  const abi = artifact.abi;

  if (!Array.isArray(abi)) {
    throw new Error(`Could not find ABI in compiled contract artifact: ${path}`);
  }

  return abi as object[];
}

function pickClassHash(result: Record<string, unknown>): string {
  const value =
    result.class_hash ??
    result.classHash ??
    result.declare?.class_hash ??
    result.declare?.classHash;

  if (typeof value !== "string" || !value) {
    throw new Error(`Could not read class hash from declare result: ${JSON.stringify(result)}`);
  }

  return value;
}

function pickTransactionHash(result: Record<string, unknown>): string {
  const value =
    result.transaction_hash ??
    result.transactionHash ??
    result.deploy?.transaction_hash ??
    result.deploy?.transactionHash ??
    result.declare?.transaction_hash ??
    result.declare?.transactionHash;

  if (typeof value !== "string" || !value) {
    throw new Error(`Could not read transaction hash from result: ${JSON.stringify(result)}`);
  }

  return value;
}

function pickAddress(result: Record<string, unknown>): string {
  const value =
    result.contract_address ??
    result.contractAddress ??
    result.deploy?.contract_address ??
    result.deploy?.contractAddress ??
    (Array.isArray(result.contracts) ? result.contracts[0]?.address : undefined);

  if (typeof value !== "string" || !value) {
    throw new Error(`Could not read deployed contract address from result: ${JSON.stringify(result)}`);
  }

  return value;
}

function parseUint8Env(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${name} must be an integer between 0 and 255.`);
  }

  return value;
}

function parseBigIntEnv(name: string, fallback: string): bigint {
  const raw = process.env[name]?.trim() || fallback;
  try {
    const value = BigInt(raw);
    if (value <= 0n) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(`${name} must be a positive base-10 integer.`);
  }
}

async function declareAndDeploy(
  account: Account,
  provider: RpcProvider,
  artifactPath: string,
  constructorArgs: Record<string, unknown>,
): Promise<DeployResult> {
  ensureArtifact(artifactPath);
  const casmPath = compileCasmArtifact(artifactPath);

  const declareResult = await account.declareIfNot({
    contract: loadCompiledContract(artifactPath),
    casm: loadCompiledContract(casmPath),
  });

  const declareTxHash =
    typeof declareResult.transaction_hash === "string" ? declareResult.transaction_hash : "";
  if (declareTxHash) {
    await provider.waitForTransaction(declareTxHash);
  }

  const classHash = pickClassHash(declareResult as Record<string, unknown>);
  const deployResult = await account.deployContract({
    classHash,
    constructorCalldata: CallData.compile(constructorArgs),
  });

  const deployTxHash = pickTransactionHash(deployResult as Record<string, unknown>);
  await provider.waitForTransaction(deployTxHash);

  return {
    address: pickAddress(deployResult as Record<string, unknown>),
    classHash,
    transactionHash: deployTxHash,
    artifact: artifactPath,
    casmArtifact: casmPath,
  };
}

async function mintTokenToDeployer(
  account: Account,
  provider: RpcProvider,
  artifactPath: string,
  tokenAddress: string,
  recipient: string,
  amount: bigint,
): Promise<string> {
  const token = new Contract({
    abi: loadCompiledAbi(artifactPath),
    address: tokenAddress,
    providerOrAccount: account,
  });
  const invokeResult = await token.mint(recipient, cairo.uint256(amount));

  const txHash = pickTransactionHash(invokeResult as Record<string, unknown>);
  await provider.waitForTransaction(txHash);
  return txHash;
}

function writeDeploymentsFile(record: DeploymentsFile): void {
  const outputDir = dirname(DEPLOYMENTS_PATH);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(DEPLOYMENTS_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const rpcUrl = process.env.STARKNET_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const accountAddress = requireEnv("STARKNET_ACCOUNT_ADDRESS");
  const privateKey = requireEnv("STARKNET_PRIVATE_KEY");
  const normalizedDeployer = addAddressPadding(accountAddress);

  const tokenName = (process.env.STARKNET_TOKEN_NAME?.trim() || DEFAULT_TOKEN_NAME).toUpperCase();
  const tokenSymbol = (process.env.STARKNET_TOKEN_SYMBOL?.trim() || DEFAULT_TOKEN_SYMBOL).toUpperCase();
  const tokenDecimals = parseUint8Env("STARKNET_TOKEN_DECIMALS", DEFAULT_TOKEN_DECIMALS);
  const tokenMintWei = parseBigIntEnv("STARKNET_TOKEN_MINT_WEI", DEFAULT_TOKEN_MINT_WEI);

  console.log("Compiling Cairo contracts with scarb...");
  runScarbBuild();

  ensureArtifact(ZUS_PROTOCOL_ARTIFACT);
  ensureArtifact(VERIFIER_ARTIFACT);
  ensureArtifact(MOCK_ERC20_ARTIFACT);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const account = new Account({
    provider,
    address: accountAddress,
    signer: privateKey,
  });

  console.log("Declaring and deploying ZusProtocol...");
  const zusProtocol = await declareAndDeploy(account, provider, ZUS_PROTOCOL_ARTIFACT, {});

  console.log("Declaring and deploying ClaimVerifier...");
  const verifier = await declareAndDeploy(account, provider, VERIFIER_ARTIFACT, {});

  console.log("Declaring and deploying MockErc20...");
  const payoutToken = await declareAndDeploy(account, provider, MOCK_ERC20_ARTIFACT, {
    name: shortString.encodeShortString(tokenName),
    symbol: shortString.encodeShortString(tokenSymbol),
    decimals: tokenDecimals,
  });

  console.log(`Minting ${tokenMintWei} base units of ${tokenSymbol} to deployer...`);
  const mintTransactionHash = await mintTokenToDeployer(
    account,
    provider,
    MOCK_ERC20_ARTIFACT,
    payoutToken.address,
    normalizedDeployer,
    tokenMintWei,
  );

  const record: DeploymentsFile = {
    network: "starknet-sepolia",
    rpcUrl,
    deployer: normalizedDeployer,
    deployedAt: new Date().toISOString(),
    contracts: {
      zusProtocol,
      verifier,
      payoutToken,
    },
    tokenMint: {
      recipient: normalizedDeployer,
      amount: tokenMintWei.toString(),
      transactionHash: mintTransactionHash,
    },
  };

  writeDeploymentsFile(record);

  console.log("");
  console.log("Deployment successful.");
  console.log(`ZusProtocol: ${zusProtocol.address}`);
  console.log(`ClaimVerifier: ${verifier.address}`);
  console.log(`MockErc20: ${payoutToken.address}`);
  console.log(`Mint tx: ${mintTransactionHash}`);
  console.log(`Deployments file: ${DEPLOYMENTS_PATH}`);
}

main().catch((error) => {
  console.error("");
  console.error("Deployment failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
