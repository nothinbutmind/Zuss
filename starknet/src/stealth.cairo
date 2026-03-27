use core::ec::{EcPoint, EcPointTrait, NonZeroEcPoint, stark_curve};
use core::hash::HashStateTrait;
use core::poseidon::PoseidonTrait;
use starknet::ContractAddress;

const STEALTH_ADDR_DOMAIN: felt252 = 'STEALTH_ADDR';
const RETRY_ADDR_DOMAIN: felt252 = 'STEALTH_RETRY';

/// Derives a one-time Starknet stealth address from a base public key and a private stealth tweak.
///
/// The flow mirrors stealth-address schemes used in other ecosystems:
/// 1. Parse the base public key as a point on the STARK curve.
/// 2. Compute `stealth_tweak * G`, where `G` is the STARK-curve generator.
/// 3. Add that tweak point to the base public key to obtain a fresh one-time stealth pubkey.
/// 4. Hash the resulting pubkey coordinates into a Starknet `ContractAddress`.
/// 5. Assert that the stealth address is different from the address derived from the base pubkey.
pub fn derive_stealth_address(
    base_pubkey_x: felt252, base_pubkey_y: felt252, stealth_tweak: felt252,
) -> ContractAddress {
    // The tweak must be non-zero or the derived pubkey would collapse back to the base pubkey.
    assert(stealth_tweak != 0, 'ZERO_TWEAK');

    // Parse the caller-provided public key coordinates and reject points that are not on the
    // STARK curve.
    let base_pubkey_nz = match EcPointTrait::new_nz(base_pubkey_x, base_pubkey_y) {
        Option::Some(point) => point,
        Option::None => panic!("BAD_BASE_PUBKEY"),
    };
    let base_pubkey: EcPoint = base_pubkey_nz.into();

    // Convert the base pubkey into its canonical address form so we can later prove that the
    // stealth destination is unlinkable at the address layer.
    let base_address = base_public_key_to_address(base_pubkey_x, base_pubkey_y);

    // Build the standard STARK-curve generator and multiply it by the private stealth tweak.
    // This produces a one-time offset point known only to the claimant.
    let generator = generator_point();
    let tweak_point = generator.mul(stealth_tweak);

    // Add the tweak point to the base public key. This is the core stealth-address step:
    // the same base pubkey plus a fresh secret tweak gives a fresh one-time pubkey.
    let stealth_pubkey = base_pubkey + tweak_point;
    let stealth_pubkey_nz: NonZeroEcPoint = match stealth_pubkey.try_into() {
        Option::Some(point) => point,
        Option::None => panic!("ZERO_STEALTH_PUBKEY"),
    };

    // Hash the one-time pubkey into a Starknet contract address. If the first hash candidate
    // falls outside the valid address range, we deterministically rehash until it fits.
    let stealth_address = point_to_address(stealth_pubkey_nz, STEALTH_ADDR_DOMAIN);

    // A valid stealth destination must not resolve to the same address as the original base pubkey.
    assert(stealth_address != base_address, 'STEALTH_EQ_BASE');

    stealth_address
}

/// Converts a base public key directly into its canonical address form.
pub fn base_public_key_to_address(base_pubkey_x: felt252, base_pubkey_y: felt252) -> ContractAddress {
    let point = EcPointTrait::new_nz(base_pubkey_x, base_pubkey_y).unwrap();
    point_to_address(point, STEALTH_ADDR_DOMAIN)
}

/// Returns the canonical generator point for the STARK curve.
fn generator_point() -> EcPoint {
    EcPointTrait::new(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap()
}

/// Hashes a non-zero STARK-curve point into a valid Starknet contract address.
fn point_to_address(point: NonZeroEcPoint, domain: felt252) -> ContractAddress {
    let (x, y) = point.coordinates();
    let mut candidate = PoseidonTrait::new().update(domain).update(x).update(y).finalize();

    loop {
        match candidate.try_into() {
            Some(address) => {
                return address;
            },
            None => {
                candidate = PoseidonTrait::new()
                    .update(RETRY_ADDR_DOMAIN)
                    .update(candidate)
                    .finalize();
            },
        };
    };
}
