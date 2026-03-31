use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct CampaignConfig {
    pub owner: ContractAddress,
    pub verifier: ContractAddress,
    pub payout_token: ContractAddress,
    pub eligible_root: felt252,
    pub message_domain: felt252,
    pub payout_amount: u256,
    pub balance: u256,
    pub metadata_hash: felt252,
    pub exists: bool,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ClaimPublicInputs {
    pub message_domain: felt252,
    pub eligible_root: felt252,
    pub ephemeral_pubkey_x: felt252,
    pub ephemeral_pubkey_y: felt252,
    pub nullifier_hash: felt252,
    pub stealth_address: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct ClaimPreview {
    pub eligible_root: felt252,
    pub nullifier_hash: felt252,
    pub stealth_address: ContractAddress,
    pub payout_amount: u256,
    pub campaign_balance: u256,
    pub already_claimed: bool,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct RegistryCampaign {
    pub creator: ContractAddress,
    pub protocol_campaign_id: felt252,
    pub merkle_root: felt252,
    pub leaf_count: u32,
    pub depth: u8,
    pub hash_algorithm_id: felt252,
    pub leaf_encoding_id: felt252,
    pub metadata_hash: felt252,
    pub payload_hash: felt252,
    pub exists: bool,
}
