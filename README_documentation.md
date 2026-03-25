# ZUS Protocol Documentation

## Project Overview

ZUS Protocol is a **Fresh Code** submission focused on a simple but important problem: most onchain reward systems expose too much. Traditional airdrops, rebates, and campaign distributions often publish recipient lists, wallet relationships, and claim activity in public, turning reward programs into a source of permanent user metadata leakage. For communities, brands, and protocols, that creates a tradeoff between transparency and privacy that should not exist.

ZUS solves this by enabling **private reward distribution on Flow EVM**. A campaign creator can fund a reward drop without exposing the full recipient list onchain. Instead of publishing every eligible address, ZUS stores only the campaign commitment and uses **zero-knowledge proofs** to verify eligibility at claim time. The claimant proves inclusion in the campaign set, the system derives a one-time stealth destination, and the protocol pays out without revealing the full distribution graph publicly. This preserves verifiability while minimizing sensitive onchain data.

## Architecture

ZUS combines several layers:

- A **Rust backend** creates campaigns, builds Merkle trees, and serves claim data.
- A **Noir circuit** defines the zero-knowledge logic for membership verification, nullifier generation, and stealth address derivation.
- **Barretenberg** is used for proof generation.
- Onchain contracts on **Flow EVM** handle campaign storage, proof verification, nullifier protection, and payout execution.
- A **React frontend** provides campaign creation and reward browsing.
- A **Rust TUI** supports the proof-driven claim flow.

The app also includes campaign-linked storage and registry-style flows aligned with **Filecoin**, while the privacy-preserving reward design supports confidential finance use cases aligned with **Zama**.

## Hackathon Tracks

This project is targeting the following tracks and sponsor bounties:

- `Fresh Code`
- `Flow: The Future of Finance`
- `Filecoin`
- `Zama: Confidential Onchain Finance`
- `Starknet`
- `Crypto`
- `Crecimiento`

## Sponsor Integrations

The core integrated sponsor technologies are:

- **Flow** for onchain execution and reward distribution
- **Filecoin** for campaign-linked external data references
- **Zama-aligned confidential finance concepts** through privacy-preserving rewards

## Summary

ZUS demonstrates how modern onchain finance can be private, practical, and user-friendly without sacrificing auditability. It is designed for use cases like private airdrops, loyalty campaigns, gated rebates, and stealth claim systems, showing how Flow EVM can power privacy-first consumer and community experiences with a complete end-to-end product.
