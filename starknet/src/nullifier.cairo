use core::hash::HashStateTrait;
use core::pedersen::PedersenTrait;

const NULLIFIER_DOMAIN: felt252 = 'NULLIFIER_V1';

/// Derives a unique nullifier for a given wallet secret and campaign message.
///
/// The nullifier is intended to be:
/// - stable for the same wallet/campaign pair, so duplicate claims can be detected
/// - different across campaigns, so one wallet gets a distinct nullifier per campaign
/// - private, because the wallet secret is mixed into the hash preimage
pub fn derive_nullifier(wallet_secret: felt252, campaign_message: felt252) -> felt252 {
    // Start from a domain separator so this hash cannot be confused with other Pedersen-based
    // values in the protocol.
    let state = PedersenTrait::new(NULLIFIER_DOMAIN);

    // Mix in the wallet secret first so the nullifier is bound to exactly one claimant.
    let state = state.update(wallet_secret);

    // Mix in the campaign message so the same wallet derives a different nullifier for each
    // campaign domain and cannot reuse one nullifier across different reward drops.
    let state = state.update(campaign_message);

    // Finalize the Pedersen sponge to produce the felt252 nullifier stored onchain.
    state.finalize()
}
