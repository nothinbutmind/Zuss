# ZUS Protocol Documentation

## Project Overview

ZUS Protocol is a **Fresh Code** hackathon project focused on a clear problem in onchain finance: reward distribution is usually fully public. In most airdrops, rebate systems, and campaign-based payouts, recipient lists and claim activity become visible onchain forever. That creates unnecessary privacy leakage for users and weakens the ability of projects to run rewards programs without exposing sensitive wallet-level metadata.

ZUS solves this by enabling **private reward distribution on Flow EVM**. Instead of publishing the full recipient list, a campaign creator stores only a campaign commitment onchain. Users then prove eligibility through a zero-knowledge flow and claim rewards without revealing the full distribution graph publicly. This makes the system verifiable and auditable while protecting recipient privacy.

## Filecoin Challenge Overview

For the Filecoin track, ZUS should be presented as a **Filecoin-backed coordination and state layer for private reward agents and multi-chain claim execution**. The core idea is that campaign metadata, recipient sets, Merkle roots, and claim reconstruction data are published to and recovered from Filecoin-backed storage, while Flow EVM and Starknet handle the final payout execution. This gives the project a decentralized data layer that independent clients can discover, verify, replay, and coordinate around without relying on a centralized database.

In challenge-language terms, ZUS aligns most closely with:

- `Onchain Agent Registry`, because campaign metadata, execution context, and logs can be reconstructed from Filecoin-backed records and shared across multiple clients
- `Agent Reputation & Portable Identity`, because claim state and eligibility history are portable, verifiable, and reconstructible from published Filecoin data

The strongest Filecoin submission framing is:

`ZUS uses Filecoin as the persistent state and discovery layer for private reward coordination, allowing independent clients, relayers, and operator tools to reconstruct campaign truth from decentralized storage while claims execute on Flow EVM or Starknet.`

## Filecoin Requirement Fit

Against the Filecoin sponsor requirements, the current repo maps as follows:

- `Deploy to Filecoin Calibration Testnet`: yes, through the Filecoin campaign publishing and lookup flow in `userslist/`
- `Working demo`: yes, through the React frontend and the Rust TUI
- `Open-source GitHub submission`: yes
- `Demo video`: still required for final submission packaging

One requirement still needs to be handled explicitly before claiming full sponsor compliance:

- `Synapse SDK or Filecoin Pin in a meaningful way`: the current implementation uses a direct Filecoin RPC publishing and retrieval flow rather than an explicit Synapse SDK or Filecoin Pin integration. For final sponsor qualification, the Filecoin publish/retrieve path should be switched or wrapped to use one of those required tools directly.

## Where Filecoin Is Used In The Repo

The Filecoin-specific logic already exists in concrete parts of the codebase:

- `userslist/src/filecoin.rs`
  This is the Filecoin client layer. It serializes campaign payloads, posts campaign data to Filecoin testnet, fetches transactions back from Filecoin, decodes calldata, and reconstructs published campaign records.
- `userslist/src/merkle.rs`
  This layer rebuilds recipient sets, Merkle paths, and claim payloads from the published Filecoin campaign data, so the app can verify the same campaign state without a separate database.
- `userslist/src/main.rs`
  This exposes the API routes that the frontend and TUI use to create campaigns, fetch Filecoin-backed campaign records, and resolve claim payloads.
- `tui/src/main.rs` and `tui/src/types.rs`
  The TUI includes Filecoin transaction explorer and Filecoin claim lookup actions, letting an operator or claimant reconstruct campaign truth directly from a Filecoin transaction hash.
- `frontend/App.jsx`
  The UI frames Filecoin as the shared off-chain state layer for campaign and Merkle data across the Flow and Starknet execution paths.

## Architecture

ZUS is built as an end-to-end stack:

- A **Rust backend** creates campaigns, builds Merkle trees, and serves claim data.
- A **Noir circuit** defines the zero-knowledge logic for membership verification, nullifier generation, and stealth address derivation.
- **Barretenberg** is used for proof generation.
- Onchain contracts on **Flow EVM** verify claims, prevent nullifier reuse, and execute payouts.
- A **React frontend** provides campaign creation and reward browsing.
- A **Rust TUI** supports the proof-driven claim flow.

The project also includes campaign-linked storage and registry-style flows aligned with **Filecoin**, extending the design beyond simple contract interaction into broader data-backed reward infrastructure.

## Hackathon Tracks

This project is targeting the following tracks and challenge categories:

- `Fresh Code`
- `Flow: The Future of Finance`
- `Filecoin`
- `Crypto`
- `Crecimiento`

## Sponsor Integrations

The core sponsor integrations in ZUS are:

- **Flow** for onchain execution, campaign funding, and reward distribution
- **Filecoin** for campaign publishing, payload recovery, Merkle reconstruction, and decentralized campaign truth

## Recommended Submission Copy

If this project is being submitted under the Filecoin challenge, the cleanest challenge overview is:

`ZUS turns Filecoin into the shared state layer for private reward coordination. Campaign metadata, recipient sets, and Merkle proof data are published to Filecoin Calibration so independent clients can discover and reconstruct campaign truth, while Flow EVM and Starknet handle payout execution. This makes reward infrastructure portable, verifiable, and privacy-preserving across multiple execution environments.`

## Summary

ZUS demonstrates how reward infrastructure can be private, practical, and user-friendly without sacrificing onchain verification. It is designed for use cases like private airdrops, loyalty campaigns, gated rebates, and stealth claim systems, showing how Flow EVM can support the future of finance with privacy-first distribution primitives and a complete working product built from fresh code.
