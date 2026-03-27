# Changelog

## Starknet Hackathon Submission

This repository now includes a full Starknet rebuild of ZUS Protocol under `starknet/`, plus the matching frontend and relayer integration needed to run the private rewards flow on Starknet instead of the original Avalanche/Noir stack.

### What Changed

#### 1. Full Cairo contract suite added in `starknet/`

The original protocol logic was rebuilt from scratch in Cairo for Starknet rather than reusing the Avalanche/EVM contracts.

New Starknet contract surface:

- `starknet/src/contracts/zus_protocol.cairo`
  - main campaign lifecycle contract
  - supports `create_campaign`, `fund_campaign`, `preview_claim`, `claim`, and owner withdrawals
  - stores campaign configuration, balances, and nullifier usage
- `starknet/src/contracts/campaign_registry.cairo`
  - registry-style metadata contract for campaign references and payload hashes
- `starknet/src/contracts/mock_erc20.cairo`
  - Cairo ERC20 used for local protocol tests
- `starknet/src/contracts/mock_verifier.cairo`
  - mock verifier contract used for deployment/testing support
- `starknet/src/interfaces/*.cairo`
  - Starknet interfaces for verifier and ERC20 interoperability
- `starknet/src/types.cairo`
  - shared Cairo structs for campaign config, claim inputs, previews, and registry records

Why this changed from Avalanche:

- The original version was built around Solidity/EVM assumptions.
- Starknet requires a Cairo-native contract model, Starknet ABI conventions, and Starknet `ContractAddress` types.
- Funding semantics also changed: instead of an EVM-style payable `createCampaign`, the Cairo version creates the campaign and then funds it through ERC20 transfers and `fund_campaign`.

#### 2. ZK-style claim circuit rebuilt in Cairo

The private claim flow was reimplemented as a Cairo circuit-style module split into reusable components:

- `starknet/src/stealth.cairo`
  - derives a one-time stealth address on the Stark curve
  - takes a base public key and a private stealth tweak
  - computes a fresh one-time destination and asserts it differs from the base address
- `starknet/src/nullifier.cairo`
  - derives a per-wallet, per-campaign nullifier using Pedersen hashing
  - prevents the same wallet from claiming twice for the same campaign
- `starknet/src/merkle.cairo`
  - verifies fixed-depth-12 Merkle membership using Pedersen hash
- `starknet/src/circuit.cairo`
  - combines claimant eligibility, nullifier derivation, and stealth payout derivation into one entry point
- `starknet/src/verifier.cairo`
  - replays the circuit logic against the packed witness and checks that public outputs match the submitted claim

Important protocol change from the original Avalanche/Noir version:

- The old system was described as a Noir/ZK proof flow coupled to Avalanche deployment.
- On Starknet, the proof path is represented as Cairo witness verification logic, and the claim inputs now explicitly include the claimant wallet address.
- Merkle membership now proves that the real eligible wallet address is in the campaign tree, while the payout still goes to the derived stealth address.
- This keeps the reward destination unlinkable while preserving eligibility checks on the actual claimant identity.

Why:

- Starknet needed a Cairo-native proof boundary instead of the original Noir/Avalanche proving pipeline.
- Claimant address inclusion was necessary to support relayed claims safely, since the relayer is the on-chain caller and should not become the identity being proven.

#### 3. snforge test suite added and passing

The Starknet rebuild includes a working `snforge` test suite in `starknet/src/lib.cairo`.

Passing coverage includes 7 tests:

1. stealth address derivation changes the base address
2. nullifier generation is unique per campaign
3. Merkle proof verification passes for a valid leaf
4. creating a campaign stores the expected configuration
5. funding a campaign updates the balance
6. a successful claim pays the stealth address and marks the nullifier used
7. a double-claim attempt fails

Why this matters:

- The original repo did not have a Starknet-native test harness.
- The Cairo rebuild needed proof that the contract logic, nullifier handling, Merkle checks, and payout flow all behave correctly in Starknet Foundry.
- This gives the hackathon submission a self-contained verification story on Starknet instead of relying on Avalanche/Noir-era behavior.

#### 4. Relayer server added to hide the claimant wallet

A new relayer service was added in `starknet/relayer/`.

New files:

- `starknet/relayer/server.js`
  - accepts off-chain claim submissions from users
  - verifies the claimant's off-chain authorization signature
  - submits the `claim(...)` transaction from the relayer's own Starknet account
  - returns the on-chain transaction hash
- `starknet/package.json`
  - includes a `relayer` script to run the service

What changed from the original version:

- The previous claim flow assumed the claimant wallet would submit the claim transaction directly.
- That leaks participation because the eligible wallet appears as the on-chain caller.
- The new relayer pattern keeps the claimant wallet off-chain:
  - the user generates the witness/proof package locally
  - signs an off-chain authorization payload
  - sends that package to the relayer API
  - the relayer submits the actual Starknet transaction
  - the payout still goes only to the stealth address

Why:

- This is a major privacy improvement for a rewards protocol.
- It preserves campaign eligibility guarantees while preventing the claimant wallet from being trivially linked to the claim transaction on-chain.

#### 5. Frontend updated from EVM/Avalanche flow to Starknet

The React frontend in `frontend/` was updated to use Starknet instead of the previous EVM wallet and contract path.

Frontend changes:

- `frontend/starknet.js`
  - new Starknet client helpers
  - address normalization/validation
  - Starknet wallet connection
  - campaign deployment helpers
  - local claim witness/proof preparation
  - off-chain relayer authorization signing
- `frontend/App.jsx`
  - wallet connection replaced with Starknet wallet handling
  - supports Starknet wallet events and reconnection
- `frontend/ZusCampaigns.jsx`
  - contract calls migrated from EVM transaction encoding to Starknet multicalls
  - campaign creation now targets Cairo `create_campaign`, ERC20 `approve`, and `fund_campaign`
- `frontend/ZusProtocol_Detail.jsx`
  - eligibility lookup kept intact
  - direct wallet claim submission replaced with relayer submission flow
- `frontend/config.js`
  - moved from Flow/Avalanche-style config to Starknet RPC, explorer, and relayer configuration
- `frontend/zusProtocolAbi.js`
  - replaced Solidity ABI assumptions with Starknet/Cairo ABI fragments

Wallet support added:

- Argent X
- Braavos

What changed from the original Avalanche/Noir frontend:

- The original frontend assumed `window.ethereum`, EVM addresses, viem, chain switching, and EVM calldata encoding.
- The updated frontend uses `starknet.js` and `@starknet-io/get-starknet`.
- Direct EVM wallet transaction submission was removed for claims.
- Claim creation and funding now follow the Starknet/Cairo protocol shape.

Why:

- Starknet wallets and transaction semantics are different from Avalanche/EVM wallets.
- The submission needed native Starknet wallet support rather than an EVM compatibility layer.
- Relayed claims required the frontend to produce an off-chain proof package instead of sending the claim on-chain from the user wallet.

#### 6. Deployment tooling added for Starknet testnet

Deployment automation was added in `starknet/scripts/deploy.ts`.

The deployment script:

- runs `scarb build`
- compiles the deployable Cairo artifacts
- declares and deploys `ZusProtocol`
- declares and deploys the verifier contract
- writes deployment outputs to `starknet/deployments.json`
- prints deployed addresses on success

What changed from the original version:

- The original Avalanche/Noir setup did not include a Starknet deployment workflow.
- The hackathon submission required a reproducible way to deploy Cairo contracts to Starknet testnet.

Why:

- A Starknet build is not complete without Starknet deployment tooling.
- The script makes the submission easier to demo, redeploy, and verify.

### Summary of the migration

This hackathon work is not a thin port. It is a full protocol adaptation from an Avalanche/Noir design to a Starknet/Cairo architecture:

- Solidity/EVM contract assumptions were replaced with Cairo contracts.
- EVM wallet integration was replaced with native Starknet wallet support.
- Avalanche-style direct claim submission was replaced with a privacy-preserving relayer pattern.
- Noir-era proof concepts were preserved at the protocol level, but rebuilt as Cairo modules for stealth addresses, nullifiers, and Merkle verification.
- The Starknet version is now testable, deployable, and integrated into the frontend for an end-to-end private claim flow.
