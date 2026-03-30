# ZUS Protocol on Starknet

Fresh Starknet/Cairo rebuild of the ZUS protocol inside `starknet/`, with no dependency on the existing Solidity, Noir, or Rust implementation files elsewhere in the repo.

## What this rebuild covers

- campaign funding and payout accounting in Cairo
- verifier-gated private reward claims
- stealth payout recipients represented as Starknet contract addresses
- nullifier tracking to prevent double claiming
- Merkle proof utilities for eligibility verification
- a metadata registry contract for campaign discovery
- a real claim verifier wrapper plus a mock ERC20 for local testing

## Starknet design choices

This rebuild keeps the original protocol goals, but adapts them to Starknet primitives:

- payouts are token-based, using an ERC20 dispatcher, because Starknet does not use EVM-style native `payable` flows
- stealth recipients are Starknet `ContractAddress` values, which can be counterfactually derived offchain and funded before deployment
- the protocol keeps only campaign configuration, balances, and spent nullifiers onchain
- zk verification is exposed through `IZusClaimVerifier`, with the onchain claim verifier wrapper delegating into the Cairo verifier logic

## Layout

- `../contracts/starknet/zus_protocol.cairo` - main protocol contract
- `../contracts/starknet/campaign_registry.cairo` - campaign metadata registry
- `../contracts/starknet/claim_verifier.cairo` - onchain verifier wrapper
- `../contracts/starknet/mock_erc20.cairo` - test token
- `src/interfaces/` - Starknet interfaces
- `src/libraries/` - claim hashing and Merkle helpers
- `src/types.cairo` - shared structs

## Claim model

The verifier-facing public inputs are modeled as:

- `message_domain`: felt that scopes the proof domain to this campaign family
- `eligible_root`: Merkle root committed onchain for the campaign
- `nullifier_hash`: one-time nullifier derived offchain inside the zk circuit
- `stealth_address`: one-time Starknet recipient for the payout

The protocol contract:

1. loads the campaign
2. checks the message domain and root
3. rejects reused nullifiers
4. verifies the proof through the verifier adapter
5. marks the nullifier as spent
6. transfers the ERC20 payout to the stealth address

## Merkle proofs

The Merkle helper library is included in this workspace so the prover/verifier stack can share one canonical folding rule. In a production deployment, the offchain prover circuit and the onchain verifier adapter must use the exact same leaf and pair hashing rules.

## Tooling

This workspace is structured to work with `scarb` and `snforge`, and the Cairo workspace has been compiled locally in this environment.
