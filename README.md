# ZUS Protocol

Private rewards across Filecoin and Starknet.

`Keywords:` privacy, private payments, confidential claims, zk proofs, stealth addresses, nullifiers, Merkle proofs, relayer, Filecoin, Starknet, Cairo, React, Argent X, Braavos

## What It Is

ZUS is one app with:

- `Filecoin` as the shared campaign data and Merkle storage layer
- `Starknet` as the Cairo private-payment path

## Privacy Features

- `zk eligibility flow`
- `stealth payout addresses`
- `nullifiers`
- `Merkle membership proofs`
- `relayed claims`
- `local recovery note flow`

## Stack

- `frontend/` : unified React app
- `userslist/` : Rust API + Filecoin-backed campaign publishing and claim data
- `contracts/starknet/` : Starknet Cairo protocol contracts
- `starknet/` : Cairo workspace, relayer, deploy scripts
- `tui/` : local proving, claim tooling, and stealth recovery

## Chain Roles

- `Filecoin` stores and reconstructs campaign metadata, recipient sets, and Merkle data
- `Starknet` runs the Cairo verifier, stealth address flow, nullifier checks, and relayed private claim path

## Local Dev

```bash
cd starknet
npm install

cd ../frontend
pnpm install
pnpm run dev
```

For the full flow, you also need env vars for:

- `Filecoin`
- `Starknet`
- `relayer accounts`

## Docs

- DeepWiki: [https://deepwiki.com/nothinbutmind/ZUS_Protocol](https://deepwiki.com/nothinbutmind/ZUS_Protocol)
- Extended notes: [README_documentation.md](README_documentation.md)
