use starknet::ContractAddress;
use zus_protocol_starknet::types::{CampaignConfig, ClaimPublicInputs};

const ZERO_ADDRESS: ContractAddress = 0.try_into().unwrap();

fn mix2(a: felt252, b: felt252) -> felt252 {
    // Keep the hash rule simple and deterministic at the protocol layer.
    // A production prover/verifier pair should replace this with Poseidon or
    // whichever hash function the zk circuit uses.
    ((a * 1315423911) + (b * 2654435761) + 0x5a5a5a) 
}

pub fn compute_claim_digest(campaign_id: felt252, claim: ClaimPublicInputs) -> felt252 {
    let digest_0 = mix2(campaign_id, claim.message_domain);
    let digest_1 = mix2(digest_0, claim.eligible_root);
    let digest_2 = mix2(digest_1, claim.ephemeral_pubkey_x);
    let digest_3 = mix2(digest_2, claim.ephemeral_pubkey_y);
    let digest_4 = mix2(digest_3, claim.nullifier_hash);
    mix2(digest_4, claim.stealth_address.into())
}

pub fn assert_valid_claim(config: CampaignConfig, claim: ClaimPublicInputs) {
    assert(config.exists, 'CAMPAIGN_MISSING');
    assert(claim.message_domain == config.message_domain, 'BAD_DOMAIN');
    assert(claim.eligible_root == config.eligible_root, 'BAD_ROOT');
    assert(claim.nullifier_hash != 0, 'BAD_NULLIFIER');
    assert(claim.ephemeral_pubkey_x != 0, 'BAD_EPHEM_X');
    assert(claim.ephemeral_pubkey_y != 0, 'BAD_EPHEM_Y');
    assert(claim.stealth_address != ZERO_ADDRESS, 'BAD_STEALTH');
}
