#[starknet::contract]
mod ClaimVerifier {
    use starknet::ContractAddress;
    use zus_protocol_starknet::interfaces::verifier::IZusClaimVerifier;
    use zus_protocol_starknet::types::ClaimPublicInputs;
    use zus_protocol_starknet::verifier::verify_claim as verify_claim_locally;

    #[storage]
    struct Storage {}

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl VerifierImpl of IZusClaimVerifier<ContractState> {
        fn verify_claim(
            self: @ContractState,
            campaign_id: felt252,
            claimant: ContractAddress,
            claim: ClaimPublicInputs,
            proof: Span<felt252>,
        ) -> bool {
            let _ = self;
            let _ = campaign_id;
            let _ = claimant;
            verify_claim_locally(claim, proof)
        }
    }
}
