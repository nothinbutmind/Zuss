use core::ec::{EcPointTrait, stark_curve};
use starknet::ContractAddress;
use zus_protocol_starknet::merkle::verify_membership;
use zus_protocol_starknet::nullifier::derive_nullifier;
use zus_protocol_starknet::stealth::{base_public_key_to_address, derive_stealth_address};

#[derive(Copy, Drop, Serde)]
pub struct CircuitOutputs {
    pub nullifier: felt252,
    pub stealth_address: ContractAddress,
}

/// Main protocol circuit-style entry point.
///
/// Inputs:
/// - `wallet_secret`: private wallet scalar used to derive the claimant public key
/// - `message`: public campaign/domain message
/// - `eligible_root`: public Merkle root committed by the campaign
/// - `ephemeral_pubkey_x` / `ephemeral_pubkey_y`: public ephemeral point used to privately derive
///   the stealth tweak without sending that tweak directly
/// - `eligible_path`: private Merkle authentication path
/// - `eligible_index`: private leaf index
///
/// Outputs:
/// - `nullifier`: wallet-and-campaign bound nullifier used for replay protection
/// - `stealth_address`: one-time payout address derived from the wallet pubkey and tweak
pub fn main(
    wallet_secret: felt252,
    message: felt252,
    eligible_root: felt252,
    ephemeral_pubkey_x: felt252,
    ephemeral_pubkey_y: felt252,
    eligible_path: Span<felt252>,
    eligible_index: usize,
) -> CircuitOutputs {
    assert(wallet_secret != 0, 'ZERO_WALLET_SECRET');

    // Derive the claimant's public key on the STARK curve by multiplying the generator by the
    // private wallet scalar. This mirrors the way the proving system binds claims to a wallet.
    let generator = EcPointTrait::new(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap();
    let public_key = generator.mul(wallet_secret);
    let public_key_nz = public_key.try_into().unwrap();
    let (pubkey_x, pubkey_y) = public_key_nz.coordinates();

    // Derive the eligible base address directly from the witness secret. This is the address that
    // must be present in the Merkle tree, so the proof binds eligibility to the same secret that
    // also determines the nullifier and stealth payout destination.
    let eligible_address = base_public_key_to_address(pubkey_x, pubkey_y);
    let eligible_leaf: felt252 = eligible_address.into();
    let eligible = verify_membership(eligible_leaf, eligible_root, eligible_path, eligible_index);
    assert(eligible, 'NOT_ELIGIBLE');

    // Bind the claim to this wallet and campaign message so the same wallet cannot claim twice for
    // the same campaign.
    let nullifier = derive_nullifier(wallet_secret, message);

    // Derive the one-time payout destination from the wallet pubkey plus an ephemeral public key.
    // The actual tweak stays implicit and is recomputed inside the circuit from the private wallet
    // secret plus the public claim context.
    let stealth_address = derive_stealth_address(
        pubkey_x,
        pubkey_y,
        wallet_secret,
        eligible_address,
        message,
        eligible_root,
        ephemeral_pubkey_x,
        ephemeral_pubkey_y,
    );

    CircuitOutputs { nullifier, stealth_address }
}
