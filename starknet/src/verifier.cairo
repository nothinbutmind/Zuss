use core::array::SpanTrait;
use zus_protocol_starknet::circuit;
use zus_protocol_starknet::types::ClaimPublicInputs;

pub const TREE_DEPTH: usize = 12;
pub const PROOF_INPUTS_LEN: usize = 2 + TREE_DEPTH;

/// Verifies a claim by replaying the main circuit entry point over the private witness values
/// packed into `proof` and comparing the derived outputs against the public claim inputs.
///
/// Witness layout inside `proof`:
/// - `proof[0]`: wallet secret
/// - `proof[1]`: eligible leaf index
/// - `proof[2..14]`: Merkle authentication path of fixed depth 12
pub fn verify_claim(claim: ClaimPublicInputs, proof: Span<felt252>) -> bool {
    // Reject malformed witness payloads before any deeper verification work.
    if proof.len() != PROOF_INPUTS_LEN {
        return false;
    };

    let wallet_secret = *proof.at(0);
    let Some(eligible_index) = (*proof.at(1)).try_into() else {
        return false;
    };

    // Reject zero secrets here so the circuit path stays in the valid proving domain.
    if wallet_secret == 0 {
        return false;
    };

    // Slice out the fixed-depth Merkle authentication path and feed the witness into the
    // same circuit entry point used to derive the public claim outputs.
    let eligible_path = proof.slice(2, TREE_DEPTH);
    let outputs = circuit::main(
        wallet_secret,
        claim.claimant_address,
        claim.message_domain,
        claim.eligible_root,
        claim.ephemeral_pubkey_x,
        claim.ephemeral_pubkey_y,
        eligible_path,
        eligible_index,
    );

    // The proof is valid only if both public outputs exactly match the values provided to the
    // protocol call.
    outputs.nullifier == claim.nullifier_hash && outputs.stealth_address == claim.stealth_address
}
