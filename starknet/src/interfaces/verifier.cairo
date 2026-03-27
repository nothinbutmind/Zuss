use starknet::ContractAddress;
use zus_protocol_starknet::types::ClaimPublicInputs;

#[starknet::interface]
pub trait IZusClaimVerifier<TState> {
    fn verify_claim(
        self: @TState,
        campaign_id: felt252,
        claimant: ContractAddress,
        claim: ClaimPublicInputs,
        proof: Span<felt252>,
    ) -> bool;
}

