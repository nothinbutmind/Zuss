# ZUS Protocol

Private reward distribution on Flow EVM.

ZUS lets a campaign creator fund a reward drop without exposing the recipient list onchain. A claimant proves eligibility with a zk proof, the circuit derives a one-time stealth address, and `ZusProtocol` pays that stealth address.

![ZUS TUI](https://i.ibb.co/q3SLCCwk/Screenshot-2026-03-22-at-5-10-34-PM.png)

## Flow EVM

1. The Rust API in `userslist/` creates a campaign and builds the Merkle tree.
2. The protocol stores the campaign root, verifier, message, and payout onchain.
3. The TUI fetches the claimant's Merkle path from the API.
4. Noir + Barretenberg generate a proof and public inputs.
5. `ZusProtocol` verifies the proof and pays the derived stealth address.

## TUI

The TUI in `tui/` is the offchain tool that drives the claim flow. It uses encrypted Foundry keystores plus `cast`, `nargo`, and `bb` to:

- resolve the wallet
- fetch claim inputs from the Rust API
- write `Prover.toml`
- generate the witness and proof
- call `previewClaim(...)`
- send `claim(...)` to `ZusProtocol`

For the current MVP, the TUI uses fixed demo values for `message` and `stealth_tweak`.

## Main Components

- `zus_addy/` - Noir circuit for Merkle membership, nullifier derivation, and stealth address derivation
- `userslist/` - Rust API for campaign creation and claim payloads
- `tui/` - Rust terminal app for proof generation and claiming
- `verifier/` - UltraHonk Solidity verifier
- `zusprotocol/` - protocol contract for campaigns, funding, and claims
- `frontend/` - React frontend

## Contracts

- `ZusProtocol.sol` manages campaigns, verifies claims, prevents nullifier reuse, and sends payouts
- `HonkVerifier.sol` verifies the UltraHonk proof generated from the Noir circuit

## Flow EVM Defaults

- Testnet RPC: `https://testnet.evm.nodes.onflow.org`
- Testnet chain ID: `545`
- Testnet explorer: `https://evm-testnet.flowscan.io`
- Mainnet RPC: `https://mainnet.evm.nodes.onflow.org`
- Mainnet chain ID: `747`
- Mainnet explorer: `https://evm.flowscan.io`
- Deployed address: `0x7d62843F6BC6763adBd5CfF2f17a7e2A05E44219`
- Testnet contract: [0xd86bDb09027b50524CCeE49557C8AF62Ae4C83bD](https://evm-testnet.flowscan.io/address/0xd86bDb09027b50524CCeE49557C8AF62Ae4C83bD?tab=contract)

Deployed verifier and protocol addresses are now expected to be configured per environment instead of relying on the old Avalanche/Fuji defaults.

## Notes

- Merkle paths stay offchain; only the root is committed onchain
- payouts are currently flat per campaign
- the shared verifier is reused across campaigns

See also:

- `verifier/README.md`
- `zusprotocol/README.md`
