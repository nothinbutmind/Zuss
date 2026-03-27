#[starknet::contract]
mod MockVerifier {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use zus_protocol_starknet::interfaces::verifier::IZusClaimVerifier;
    use zus_protocol_starknet::libraries::claims::compute_claim_digest;
    use zus_protocol_starknet::types::ClaimPublicInputs;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        should_verify: bool,
        expected_digest: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        VerificationModeChanged: VerificationModeChanged,
        ExpectedDigestChanged: ExpectedDigestChanged,
    }

    #[derive(Drop, starknet::Event)]
    struct VerificationModeChanged {
        value: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct ExpectedDigestChanged {
        digest: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_owner: ContractAddress) {
        self.owner.write(initial_owner);
        self.should_verify.write(true);
        self.expected_digest.write(0);
    }

    #[external(v0)]
    fn set_should_verify(ref self: ContractState, value: bool) {
        assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
        self.should_verify.write(value);
        self.emit(Event::VerificationModeChanged(VerificationModeChanged { value }));
    }

    #[external(v0)]
    fn set_expected_digest(ref self: ContractState, digest: felt252) {
        assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
        self.expected_digest.write(digest);
        self.emit(Event::ExpectedDigestChanged(ExpectedDigestChanged { digest }));
    }

    #[abi(embed_v0)]
    impl VerifierImpl of IZusClaimVerifier<ContractState> {
        fn verify_claim(
            self: @ContractState,
            campaign_id: felt252,
            claimant: ContractAddress,
            claim: ClaimPublicInputs,
            proof: Span<felt252>,
        ) -> bool {
            let _ = claimant;
            let _ = proof;
            if !self.should_verify.read() {
                return false;
            };

            let expected = self.expected_digest.read();
            if expected == 0 {
                return true;
            };

            compute_claim_digest(campaign_id, claim) == expected
        }
    }
}
