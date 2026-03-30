pub mod contracts {
    pub mod campaign_registry;
    pub mod claim_verifier;
    pub mod mock_erc20;
    pub mod zus_protocol;
}

pub mod circuit;
pub mod interfaces {
    pub mod erc20;
    pub mod verifier;
}

pub mod libraries {
    pub mod claims;
    pub mod merkle;
}

pub mod merkle;
pub mod nullifier;
pub mod stealth;
pub mod verifier;

pub mod types;

#[cfg(test)]
mod tests {
    use core::array::{ArrayTrait, SpanTrait};
    use core::ec::{EcPointTrait, stark_curve};
    use core::pedersen::pedersen;
    use core::serde::Serde;
    use snforge_std::{
        ContractClassTrait, DeclareResultTrait, declare, map_entry_address, start_cheat_caller_address,
        stop_cheat_caller_address, store,
    };
    use starknet::ContractAddress;
    use zus_protocol_starknet::circuit;
    use zus_protocol_starknet::contracts::zus_protocol::{IZusProtocolDispatcher, IZusProtocolDispatcherTrait};
    use zus_protocol_starknet::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use zus_protocol_starknet::merkle::verify_membership;
    use zus_protocol_starknet::nullifier::derive_nullifier;
    use zus_protocol_starknet::stealth::{base_public_key_to_address, derive_stealth_address};

    const TREE_DEPTH: usize = 12;
    const OWNER: ContractAddress = 0x111.try_into().unwrap();
    const CLAIMANT: ContractAddress = 0x222.try_into().unwrap();
    const MESSAGE: felt252 = 'ZUS_CLAIM';
    const CAMPAIGN_ID: felt252 = 0xCAFE;
    const PAYOUT: u256 = 100;
    const FUNDING: u256 = 500;
    const WALLET_SECRET: felt252 = 123456789;
    const EPHEMERAL_SECRET: felt252 = 987654321;

    #[derive(Drop)]
    struct ClaimFixture {
        root: felt252,
        proof: Array<felt252>,
        claim_proof: Array<felt252>,
        eligible_index: usize,
        ephemeral_pubkey_x: felt252,
        ephemeral_pubkey_y: felt252,
        nullifier: felt252,
        stealth_address: ContractAddress,
    }

    #[test]
    fn stealth_address_derivation_changes_the_base_address() {
        let fixture = build_claim_fixture();
        let (pubkey_x, pubkey_y) = wallet_public_key(WALLET_SECRET);
        let base_address = base_public_key_to_address(pubkey_x, pubkey_y);
        let stealth_address = derive_stealth_address(
            pubkey_x,
            pubkey_y,
            WALLET_SECRET,
            CLAIMANT,
            MESSAGE,
            fixture.root,
            fixture.ephemeral_pubkey_x,
            fixture.ephemeral_pubkey_y,
        );

        assert(base_address != stealth_address, 'same address');
    }

    #[test]
    fn nullifier_generation_is_unique_per_campaign() {
        let n1 = derive_nullifier(WALLET_SECRET, MESSAGE);
        let n2 = derive_nullifier(WALLET_SECRET, 'OTHER_MSG');
        let n3 = derive_nullifier(WALLET_SECRET, MESSAGE);

        assert(n1 != n2, 'same campaign nullifier');
        assert(n1 == n3, 'unstable nullifier');
    }

    #[test]
    fn merkle_proof_verification_passes_for_valid_leaf() {
        let fixture = build_claim_fixture();
        let leaf: felt252 = CLAIMANT.into();

        assert(verify_membership(leaf, fixture.root, fixture.proof.span(), fixture.eligible_index), 'invalid proof');
    }

    #[test]
    fn creating_a_campaign_stores_the_expected_configuration() {
        let fixture = build_claim_fixture();
        let protocol = deploy_protocol();

        start_cheat_caller_address(protocol.contract_address, OWNER);
        protocol.create_campaign(CAMPAIGN_ID, OWNER, OWNER, fixture.root, MESSAGE, PAYOUT, 77);
        stop_cheat_caller_address(protocol.contract_address);

        let campaign = protocol.get_campaign(CAMPAIGN_ID);
        assert(campaign.owner == OWNER, 'wrong owner');
        assert(campaign.eligible_root == fixture.root, 'wrong root');
        assert(campaign.message_domain == MESSAGE, 'wrong message');
        assert(campaign.payout_amount == PAYOUT, 'wrong payout');
    }

    #[test]
    fn funding_a_campaign_updates_the_balance() {
        let fixture = build_claim_fixture();
        let protocol = deploy_protocol();
        let token = deploy_token();

        seed_token_state(token.contract_address, OWNER, protocol.contract_address, FUNDING);

        start_cheat_caller_address(protocol.contract_address, OWNER);
        protocol.create_campaign(CAMPAIGN_ID, OWNER, token.contract_address, fixture.root, MESSAGE, PAYOUT, 77);
        protocol.fund_campaign(CAMPAIGN_ID, FUNDING);
        stop_cheat_caller_address(protocol.contract_address);

        let campaign = protocol.get_campaign(CAMPAIGN_ID);
        assert(campaign.balance == FUNDING, 'wrong funded balance');
    }

    #[test]
    fn successful_claim_pays_the_stealth_address_and_marks_the_nullifier_used() {
        let fixture = build_claim_fixture();
        let protocol = deploy_protocol();
        let token = deploy_token();

        seed_token_state(token.contract_address, OWNER, protocol.contract_address, FUNDING);

        start_cheat_caller_address(protocol.contract_address, OWNER);
        protocol.create_campaign(CAMPAIGN_ID, OWNER, token.contract_address, fixture.root, MESSAGE, PAYOUT, 77);
        protocol.fund_campaign(CAMPAIGN_ID, FUNDING);
        stop_cheat_caller_address(protocol.contract_address);

        start_cheat_caller_address(protocol.contract_address, CLAIMANT);
        protocol.claim(
            CAMPAIGN_ID,
            zus_protocol_starknet::types::ClaimPublicInputs {
                claimant_address: CLAIMANT,
                message_domain: MESSAGE,
                eligible_root: fixture.root,
                ephemeral_pubkey_x: fixture.ephemeral_pubkey_x,
                ephemeral_pubkey_y: fixture.ephemeral_pubkey_y,
                nullifier_hash: fixture.nullifier,
                stealth_address: fixture.stealth_address,
            },
            fixture.claim_proof.span(),
        );
        stop_cheat_caller_address(protocol.contract_address);

        assert(protocol.is_nullifier_used(CAMPAIGN_ID, fixture.nullifier), 'nullifier missing');
        assert(token.balance_of(fixture.stealth_address) == PAYOUT, 'stealth unpaid');
    }

    #[test]
    #[should_panic]
    fn double_claim_attempt_fails() {
        let fixture = build_claim_fixture();
        let protocol = deploy_protocol();
        let token = deploy_token();

        seed_token_state(token.contract_address, OWNER, protocol.contract_address, FUNDING);

        start_cheat_caller_address(protocol.contract_address, OWNER);
        protocol.create_campaign(CAMPAIGN_ID, OWNER, token.contract_address, fixture.root, MESSAGE, PAYOUT, 77);
        protocol.fund_campaign(CAMPAIGN_ID, FUNDING);
        stop_cheat_caller_address(protocol.contract_address);

        start_cheat_caller_address(protocol.contract_address, CLAIMANT);
        protocol.claim(
            CAMPAIGN_ID,
            zus_protocol_starknet::types::ClaimPublicInputs {
                claimant_address: CLAIMANT,
                message_domain: MESSAGE,
                eligible_root: fixture.root,
                ephemeral_pubkey_x: fixture.ephemeral_pubkey_x,
                ephemeral_pubkey_y: fixture.ephemeral_pubkey_y,
                nullifier_hash: fixture.nullifier,
                stealth_address: fixture.stealth_address,
            },
            fixture.claim_proof.span(),
        );
        protocol.claim(
            CAMPAIGN_ID,
            zus_protocol_starknet::types::ClaimPublicInputs {
                claimant_address: CLAIMANT,
                message_domain: MESSAGE,
                eligible_root: fixture.root,
                ephemeral_pubkey_x: fixture.ephemeral_pubkey_x,
                ephemeral_pubkey_y: fixture.ephemeral_pubkey_y,
                nullifier_hash: fixture.nullifier,
                stealth_address: fixture.stealth_address,
            },
            fixture.claim_proof.span(),
        );
    }

    fn deploy_protocol() -> IZusProtocolDispatcher {
        let contract = declare("ZusProtocol").unwrap().contract_class();
        let calldata = array![];
        let (address, _) = contract.deploy(@calldata).unwrap();
        IZusProtocolDispatcher { contract_address: address }
    }

    fn deploy_token() -> IERC20Dispatcher {
        let contract = declare("MockErc20").unwrap().contract_class();
        let calldata = array!['ZusToken', 'ZUS', 18];
        let (address, _) = contract.deploy(@calldata).unwrap();
        IERC20Dispatcher { contract_address: address }
    }

    fn seed_token_state(token: ContractAddress, owner: ContractAddress, protocol: ContractAddress, amount: u256) {
        let mut serialized = array![];
        amount.serialize(ref serialized);

        let balance_slot = map_entry_address(selector!("balances"), array![owner.into()].span());
        let allowance_slot = map_entry_address(
            selector!("allowances"),
            array![owner.into(), protocol.into()].span(),
        );

        store(token, balance_slot, serialized.span());
        store(token, allowance_slot, serialized.span());
        store(token, selector!("total_supply"), serialized.span());
    }

    fn build_claim_fixture() -> ClaimFixture {
        let eligible_index = 5;
        let leaf: felt252 = CLAIMANT.into();
        let proof = sample_merkle_path();
        let root = compute_root(leaf, eligible_index, proof.span());
        let (ephemeral_pubkey_x, ephemeral_pubkey_y) = wallet_public_key(EPHEMERAL_SECRET);
        let outputs = circuit::main(
            WALLET_SECRET,
            CLAIMANT,
            MESSAGE,
            root,
            ephemeral_pubkey_x,
            ephemeral_pubkey_y,
            proof.span(),
            eligible_index,
        );

        let mut claim_proof = array![WALLET_SECRET, eligible_index.into()];
        claim_proof.append_span(proof.span());

        ClaimFixture {
            root,
            proof,
            claim_proof,
            eligible_index,
            ephemeral_pubkey_x,
            ephemeral_pubkey_y,
            nullifier: outputs.nullifier,
            stealth_address: outputs.stealth_address,
        }
    }

    fn wallet_public_key(wallet_secret: felt252) -> (felt252, felt252) {
        let generator = EcPointTrait::new(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap();
        let public_key = generator.mul(wallet_secret);
        let public_key_nz = public_key.try_into().unwrap();
        public_key_nz.coordinates()
    }

    fn sample_merkle_path() -> Array<felt252> {
        array![11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 333]
    }

    fn compute_root(leaf: felt252, leaf_index: usize, proof: Span<felt252>) -> felt252 {
        let mut current_hash = leaf;
        let mut current_index = leaf_index;
        let mut level = 0;

        loop {
            if level == TREE_DEPTH {
                break;
            };

            let sibling = *proof.at(level);
            if current_index % 2 == 0 {
                current_hash = pedersen(current_hash, sibling);
            } else {
                current_hash = pedersen(sibling, current_hash);
            };

            current_index = current_index / 2;
            level += 1;
        };

        current_hash
    }
}
