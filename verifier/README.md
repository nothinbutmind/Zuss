# Shared Verifier Flow

This folder is for the shared onchain verifier flow.

The verifier is deployed once per circuit version, not once per campaign.

That means:
- campaigns can keep changing Merkle roots and metadata
- users can keep generating fresh proofs per campaign
- the onchain verifier address stays the same until the circuit changes

## Suggested MVP ownership

- protocol owner/operator generates the verifier artifacts
- protocol owner/operator deploys the verifier contract once
- campaign creation stores campaign data plus a verifier reference
- onchain claim logic verifies proofs against that shared verifier

## Generic scripts

`scripts/generate_shared_verifier.sh`

- takes a Noir circuit directory
- compiles the circuit with `nargo`
- writes a verification key with `bb`
- writes a Solidity verifier contract with `bb`

`scripts/deploy_shared_verifier.sh`

- takes a generated Solidity verifier file
- copies it into this Foundry workspace
- deploys it with `forge create`

## Example

Generate a verifier for the current Noir circuit:

```bash
./verifier/scripts/generate_shared_verifier.sh \
  --circuit-dir ./zus_addy
```

Deploy the generated verifier once:

```bash
./verifier/scripts/deploy_shared_verifier.sh \
  --verifier-sol ./verifier/generated/stealthdrop/Verifier.sol \
  --contract-name ZusVerifier \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

## Why this is generic

The scripts are generic at the circuit level.

You point them at a Noir package directory and they derive the package name from `Nargo.toml`, then generate or deploy artifacts for that package.

So the generic unit is:

- one verifier per Noir circuit/package version

Not:

- one verifier per campaign
