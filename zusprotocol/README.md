# Zus Protocol MVP

This package wraps the shared verifier with campaign-level payout logic.

The verifier only answers `true` or `false`, but the proof already carries:

- the expected `eligible_root`
- the nullifier point bytes
- the derived `stealth_address`

So the protocol contract does this:

1. create a campaign with verifier/root/message/payout
2. keep Merkle leaves, indexes, and paths offchain in the Rust API
3. decode the public inputs on claim
4. check the campaign root and message domain
5. call the shared verifier
6. mark the campaign nullifier as spent
7. pay the decoded stealth address from that campaign balance

## Current shape

This contract is intentionally minimal onchain:

- one deployed manager contract
- many campaigns stored by `campaignId`
- one verifier/root/message/payout per campaign
- Merkle proofs and leaf metadata stay in the Rust API

That matches your API split better: PostgreSQL/Rust keeps the bulky claim data, and Solidity only keeps the campaign config plus balances/nullifier usage.

## Important MVP constraint

The current Noir circuit does **not** bind an amount into the proof.

Because of that, each campaign in [ZusProtocol.sol](./src/ZusProtocol.sol) pays one fixed native-token amount per valid claim.

If you want variable amounts per recipient later, the circuit needs to bind the leaf payload, not just address membership.

If you want many campaigns, make the proof domain campaign-specific too.
Right now the nullifier uses `message || compressed_pubkey`, so reusing the same message across campaigns would couple their nullifier space together.

## Run tests

```bash
cd zusprotocol
forge test --offline
```

## Deploy

Deploy the manager contract once:

```bash
cd zusprotocol
./scripts/deploy_zusprotocol.sh \
  --rpc-url https://testnet.evm.nodes.onflow.org \
  --private-key "$PRIVATE_KEY"
```

Then create a campaign using your Rust API campaign UUID or a raw bytes32 id:

```bash
./scripts/create_campaign.sh \
  --protocol 0xYourZusProtocol \
  --campaign-uuid 12345678-1234-1234-1234-123456789abc \
  --eligible-root 8802187165556453190189996805815222062110494360811300334886617400244789607678 \
  --payout-wei 1000000000000000 \
  --funding-wei 5000000000000000 \
  --rpc-url https://testnet.evm.nodes.onflow.org \
  --verifier 0xYourVerifier \
  --private-key "$PRIVATE_KEY"
```

That example creates one campaign that pays `0.001 FLOW` per valid claim and pre-funds it with `0.005 FLOW`.

The message defaults to `ZUSMVP01`. On Flow EVM, pass the deployed verifier address explicitly or set `ZUS_VERIFIER_ADDRESS`.
You can override either if you spin a new proof domain:

```bash
./scripts/create_campaign.sh \
  --protocol 0xYourZusProtocol \
  --campaign-id 0xYourBytes32CampaignId \
  --eligible-root 0xYourRoot \
  --payout-wei 1000000000000000 \
  --verifier 0xYourVerifier \
  --message ZUSMVP01 \
  --rpc-url https://testnet.evm.nodes.onflow.org \
  --private-key "$PRIVATE_KEY"
```

## Claim

Once a campaign exists and you have generated the Noir proof artifacts, you can preview and send the claim with:

```bash
./scripts/claim_campaign.sh \
  --protocol 0xYourZusProtocol \
  --campaign-uuid 12345678-1234-1234-1234-123456789abc \
  --rpc-url https://testnet.evm.nodes.onflow.org \
  --private-key "$PRIVATE_KEY"
```

By default that script reads:

- `../verifier/generated/stealthdrop/proof_test/proof`
- `../verifier/generated/stealthdrop/proof_test/public_inputs`

## Full API E2E Demo

If your Rust API is live, there is also a single named demo flow that goes through the API first:

```bash
./scripts/e2e_api_campaign_demo.sh \
  --protocol 0xYourZusProtocol \
  --rpc-url https://testnet.evm.nodes.onflow.org \
  --private-key "$PRIVATE_KEY" \
  --api-base-url http://127.0.0.1:3000 \
  --verifier 0xYourVerifier \
  --test-name "Flow EVM API E2E Demo"
```

That script:

1. creates a campaign in the Rust API with your chosen test name
2. reads back `campaign_id`, `onchain_campaign_id`, and `merkle_root`
3. creates the matching onchain campaign
4. fetches the Rust API claim payload for the demo recipient
5. writes `zus_addy/Prover.toml`
6. runs `nargo execute`
7. runs `bb prove`
8. sends `claim(...)` to `ZusProtocol`

The default demo recipient is the public Anvil test wallet already used in this repo, so the whole flow is deterministic for MVP testing.
