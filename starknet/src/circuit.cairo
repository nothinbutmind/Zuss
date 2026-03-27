use core::ec::{EcPointTrait, stark_curve};
use starknet::ContractAddress;
use zus_protocol_starknet::merkle::verify_membership;
use zus_protocol_starknet::nullifier::derive_nullifier;
use zus_protocol_starknet::stealth::derive_stealth_address;

#[derive(Copy, Drop, Serde)]
pub struct CircuitOutputs {
    pub nullifier: felt252,
    pub stealth_address: ContractAddress,
}

/// Main protocol circuit-style entry point.
///
/// Inputs:
/// - `wallet_secret`: private wallet scalar used to derive the claimant public key
/// - `stealth_tweak`: private one-time scalar used to derive the stealth destination
/// - `message`: public campaign/domain message
/// - `eligible_root`: public Merkle root committed by the campaign
/// - `eligible_path`: private Merkle authentication path
/// - `eligible_index`: private leaf index
///
/// Outputs:
/// - `nullifier`: wallet-and-campaign bound nullifier used for replay protection
/// - `stealth_address`: one-time payout address derived from the wallet pubkey and tweak
pub fn main(
    wallet_secret: felt252,
    stealth_tweak: felt252,
    claimant_address: ContractAddress,
    message: felt252,
    eligible_root: felt252,
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

    // The Merkle tree stores eligibility by the claimant's real wallet address. That address stays
    // public in the proof inputs, while the relayer becomes the onchain caller and the payout still
    // lands on a fresh stealth address.
    let claimant_leaf: felt252 = claimant_address.into();
    let eligible = verify_membership(claimant_leaf, eligible_root, eligible_path, eligible_index);
    assert(eligible, 'NOT_ELIGIBLE');

    // Bind the claim to this wallet and campaign message so the same wallet cannot claim twice for
    // the same campaign.
    let nullifier = derive_nullifier(wallet_secret, message);

    // Derive the one-time payout destination from the wallet pubkey and the private stealth tweak.
    let stealth_address = derive_stealth_address(pubkey_x, pubkey_y, stealth_tweak);

    CircuitOutputs { nullifier, stealth_address }
}
