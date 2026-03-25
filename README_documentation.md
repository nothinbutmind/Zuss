# ZUS Protocol Documentation

## Project Overview

ZUS Protocol is a **Fresh Code** hackathon project focused on a clear problem in onchain finance: reward distribution is usually fully public. In most airdrops, rebate systems, and campaign-based payouts, recipient lists and claim activity become visible onchain forever. That creates unnecessary privacy leakage for users and weakens the ability of projects to run rewards programs without exposing sensitive wallet-level metadata.

ZUS solves this by enabling **private reward distribution on Flow EVM**. Instead of publishing the full recipient list, a campaign creator stores only a campaign commitment onchain. Users then prove eligibility through a zero-knowledge flow and claim rewards without revealing the full distribution graph publicly. This makes the system verifiable and auditable while protecting recipient privacy.

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
- **Filecoin** for campaign-linked external storage and registry-style data references

## Summary

ZUS demonstrates how reward infrastructure can be private, practical, and user-friendly without sacrificing onchain verification. It is designed for use cases like private airdrops, loyalty campaigns, gated rebates, and stealth claim systems, showing how Flow EVM can support the future of finance with privacy-first distribution primitives and a complete working product built from fresh code.
