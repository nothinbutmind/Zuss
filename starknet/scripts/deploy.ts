/**
 * ZUS Starknet deployment script.
 *
 * How to run:
 * 1. Export the deployer credentials:
 *    - STARKNET_ACCOUNT_ADDRESS=0x...
 *    - STARKNET_PRIVATE_KEY=0x...
 *    - Optional: STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_8
 * 2. Install the local JS dependency once:
 *    `cd starknet && pnpm install`
 * 3. Make sure the Cairo toolchain is on your PATH so `scarb build` works.
 *    If you installed via `asdf`, one option is:
 *    `export PATH="$HOME/.asdf/shims:$PATH"`
 * 4. Run the script from the `starknet/` folder with Node 22+:
 *    `pnpm deploy:testnet`
 *
 * The script will:
 * - compile the Cairo workspace
 * - compile CASM artifacts for deployable contracts
 * - declare and deploy `ZusProtocol`
 * - declare and deploy `ClaimVerifier`
 * - save the deployment record to `starknet/deployments.json`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Account, CallData, RpcProvider, addAddressPadding, json } from "starknet";

type DeployResult = {
  address: string;
  classHash: string;
  transactionHash: string;
  artifact: string;
  casmArtifact: string;
};

type DeploymentsFile = {
  network: string;
  rpcUrl: string;
  deployer: string;
  deployedAt: string;
  contracts: {
    zusProtocol: DeployResult;
    verifier: DeployResult;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STARKNET_DIR = resolve(__dirname, "..");
const TARGET_DIR = join(STARKNET_DIR, "target", "dev");
const DEPLOYMENTS_PATH = join(STARKNET_DIR, "deployments.json");
const DEFAULT_RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";

const ZUS_PROTOCOL_ARTIFACT = join(
  TARGET_DIR,
  "zus_protocol_starknet_ZusProtocol.contract_class.json",
);
const VERIFIER_ARTIFACT = join(
  TARGET_DIR,
  "zus_protocol_starknet_ClaimVerifier.contract_class.json",
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

function loadCompiledContract(path: string): object {
  return json.parse(readFileSync(path, "utf8"));
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

  console.log("Compiling Cairo contracts with scarb...");
  runScarbBuild();

  ensureArtifact(ZUS_PROTOCOL_ARTIFACT);
  ensureArtifact(VERIFIER_ARTIFACT);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const account = new Account({
    provider,
    address: accountAddress,
    signer: privateKey,
  });
  const normalizedDeployer = addAddressPadding(accountAddress);

  console.log("Declaring and deploying ZusProtocol...");
  const zusProtocol = await declareAndDeploy(account, provider, ZUS_PROTOCOL_ARTIFACT, {});

  console.log("Declaring and deploying ClaimVerifier...");
  const verifier = await declareAndDeploy(account, provider, VERIFIER_ARTIFACT, {});

  const record: DeploymentsFile = {
    network: "starknet-sepolia",
    rpcUrl,
    deployer: normalizedDeployer,
    deployedAt: new Date().toISOString(),
    contracts: {
      zusProtocol,
      verifier,
    },
  };

  writeDeploymentsFile(record);

  console.log("");
  console.log("Deployment successful.");
  console.log(`ZusProtocol: ${zusProtocol.address}`);
  console.log(`ClaimVerifier: ${verifier.address}`);
  console.log(`Deployments file: ${DEPLOYMENTS_PATH}`);
}

main().catch((error) => {
  console.error("");
  console.error("Deployment failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
