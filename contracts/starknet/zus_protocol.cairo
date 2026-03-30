use starknet::ContractAddress;
use zus_protocol_starknet::types::{CampaignConfig, ClaimPreview, ClaimPublicInputs};

#[starknet::interface]
pub trait IZusProtocol<TContractState> {
    fn create_campaign(
        ref self: TContractState,
        campaign_id: felt252,
        verifier: ContractAddress,
        payout_token: ContractAddress,
        eligible_root: felt252,
        message_domain: felt252,
        payout_amount: u256,
        metadata_hash: felt252,
    );

    fn fund_campaign(ref self: TContractState, campaign_id: felt252, amount: u256);

    fn get_campaign(self: @TContractState, campaign_id: felt252) -> CampaignConfig;

    fn is_nullifier_used(
        self: @TContractState, campaign_id: felt252, nullifier_hash: felt252,
    ) -> bool;

    fn preview_claim(
        self: @TContractState, campaign_id: felt252, claim: ClaimPublicInputs,
    ) -> ClaimPreview;

    fn claim(
        ref self: TContractState, campaign_id: felt252, claim: ClaimPublicInputs, proof: Span<felt252>,
    );

    fn withdraw_campaign_balance(
        ref self: TContractState, campaign_id: felt252, recipient: ContractAddress, amount: u256,
    );
}

#[starknet::contract]
mod ZusProtocol {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::IZusProtocol;
    use zus_protocol_starknet::interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use zus_protocol_starknet::libraries::claims::assert_valid_claim;
    use zus_protocol_starknet::types::{CampaignConfig, ClaimPreview, ClaimPublicInputs};
    use zus_protocol_starknet::verifier::verify_claim as verify_local_claim;

    const ZERO_ADDRESS: ContractAddress = 0.try_into().unwrap();

    #[storage]
    struct Storage {
        campaigns: Map<felt252, CampaignConfig>,
        nullifiers: Map<(felt252, felt252), bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CampaignCreated: CampaignCreated,
        CampaignFunded: CampaignFunded,
        Claimed: Claimed,
        CampaignWithdrawn: CampaignWithdrawn,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignCreated {
        campaign_id: felt252,
        owner: ContractAddress,
        verifier: ContractAddress,
        payout_token: ContractAddress,
        eligible_root: felt252,
        message_domain: felt252,
        payout_amount: u256,
        metadata_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignFunded {
        campaign_id: felt252,
        funder: ContractAddress,
        amount: u256,
        new_balance: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        campaign_id: felt252,
        caller: ContractAddress,
        stealth_address: ContractAddress,
        nullifier_hash: felt252,
        payout_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignWithdrawn {
        campaign_id: felt252,
        recipient: ContractAddress,
        amount: u256,
        remaining_balance: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl ZusProtocolImpl of IZusProtocol<ContractState> {
        fn create_campaign(
            ref self: ContractState,
            campaign_id: felt252,
            verifier: ContractAddress,
            payout_token: ContractAddress,
            eligible_root: felt252,
            message_domain: felt252,
            payout_amount: u256,
            metadata_hash: felt252,
        ) {
            assert(campaign_id != 0, 'BAD_ID');
            assert(verifier != ZERO_ADDRESS, 'BAD_VERIFIER');
            assert(payout_token != ZERO_ADDRESS, 'BAD_TOKEN');
            assert(eligible_root != 0, 'BAD_ROOT');
            assert(!u256_is_zero(payout_amount), 'BAD_PAYOUT');
            assert(!self.campaigns.read(campaign_id).exists, 'EXISTS');

            let owner = get_caller_address();
            let campaign = CampaignConfig {
                owner,
                verifier,
                payout_token,
                eligible_root,
                message_domain,
                payout_amount,
                balance: u256_zero(),
                metadata_hash,
                exists: true,
            };

            self.campaigns.write(campaign_id, campaign);
            self.emit(
                Event::CampaignCreated(
                    CampaignCreated {
                        campaign_id,
                        owner,
                        verifier,
                        payout_token,
                        eligible_root,
                        message_domain,
                        payout_amount,
                        metadata_hash,
                    },
                ),
            );
        }

        fn fund_campaign(ref self: ContractState, campaign_id: felt252, amount: u256) {
            assert(!u256_is_zero(amount), 'BAD_AMOUNT');

            let campaign = load_campaign(@self, campaign_id);
            let updated_balance = campaign.balance + amount;
            let token = IERC20Dispatcher { contract_address: campaign.payout_token };
            let caller = get_caller_address();
            let protocol = get_contract_address();

            assert(token.transfer_from(caller, protocol, amount), 'TRANSFER_FROM');
            self.campaigns.write(campaign_id, rewrite_campaign(campaign, updated_balance));
            self.emit(
                Event::CampaignFunded(
                    CampaignFunded {
                        campaign_id,
                        funder: caller,
                        amount,
                        new_balance: updated_balance,
                    },
                ),
            );
        }

        fn get_campaign(self: @ContractState, campaign_id: felt252) -> CampaignConfig {
            load_campaign(self, campaign_id)
        }

        fn is_nullifier_used(self: @ContractState, campaign_id: felt252, nullifier_hash: felt252) -> bool {
            self.nullifiers.read((campaign_id, nullifier_hash))
        }

        fn preview_claim(self: @ContractState, campaign_id: felt252, claim: ClaimPublicInputs) -> ClaimPreview {
            let campaign = load_campaign(self, campaign_id);
            assert_valid_claim(campaign, claim);

            ClaimPreview {
                eligible_root: claim.eligible_root,
                nullifier_hash: claim.nullifier_hash,
                stealth_address: claim.stealth_address,
                payout_amount: campaign.payout_amount,
                campaign_balance: campaign.balance,
                already_claimed: self.nullifiers.read((campaign_id, claim.nullifier_hash)),
            }
        }

        fn claim(ref self: ContractState, campaign_id: felt252, claim: ClaimPublicInputs, proof: Span<felt252>) {
            let campaign = load_campaign(@self, campaign_id);
            assert_valid_claim(campaign, claim);

            let nullifier_key = (campaign_id, claim.nullifier_hash);
            assert(!self.nullifiers.read(nullifier_key), 'NULLIFIER_USED');
            assert(campaign.balance >= campaign.payout_amount, 'INSUFFICIENT_BALANCE');

            let caller = get_caller_address();
            let _ = caller;
            let _ = campaign.verifier;
            let verified = verify_local_claim(claim, proof);
            assert(verified, 'INVALID_PROOF');

            let updated_balance = campaign.balance - campaign.payout_amount;
            self.nullifiers.write(nullifier_key, true);
            self.campaigns.write(campaign_id, rewrite_campaign(campaign, updated_balance));

            let token = IERC20Dispatcher { contract_address: campaign.payout_token };
            assert(token.transfer(claim.stealth_address, campaign.payout_amount), 'TRANSFER');

            self.emit(
                Event::Claimed(
                    Claimed {
                        campaign_id,
                        caller,
                        stealth_address: claim.stealth_address,
                        nullifier_hash: claim.nullifier_hash,
                        payout_amount: campaign.payout_amount,
                    },
                ),
            );
        }

        fn withdraw_campaign_balance(
            ref self: ContractState, campaign_id: felt252, recipient: ContractAddress, amount: u256,
        ) {
            assert(recipient != ZERO_ADDRESS, 'BAD_RECIPIENT');

            let campaign = load_campaign(@self, campaign_id);
            assert(campaign.owner == get_caller_address(), 'NOT_OWNER');
            assert(campaign.balance >= amount, 'INSUFFICIENT_BALANCE');

            let updated_balance = campaign.balance - amount;
            self.campaigns.write(campaign_id, rewrite_campaign(campaign, updated_balance));

            let token = IERC20Dispatcher { contract_address: campaign.payout_token };
            assert(token.transfer(recipient, amount), 'TRANSFER');

            self.emit(
                Event::CampaignWithdrawn(
                    CampaignWithdrawn {
                        campaign_id,
                        recipient,
                        amount,
                        remaining_balance: updated_balance,
                    },
                ),
            );
        }
    }

    fn load_campaign(self: @ContractState, campaign_id: felt252) -> CampaignConfig {
        assert(campaign_id != 0, 'BAD_ID');
        let campaign = self.campaigns.read(campaign_id);
        assert(campaign.exists, 'MISSING');
        campaign
    }

    fn rewrite_campaign(campaign: CampaignConfig, balance: u256) -> CampaignConfig {
        CampaignConfig {
            owner: campaign.owner,
            verifier: campaign.verifier,
            payout_token: campaign.payout_token,
            eligible_root: campaign.eligible_root,
            message_domain: campaign.message_domain,
            payout_amount: campaign.payout_amount,
            balance,
            metadata_hash: campaign.metadata_hash,
            exists: campaign.exists,
        }
    }

    fn u256_zero() -> u256 {
        0
    }

    fn u256_is_zero(value: u256) -> bool {
        value == u256_zero()
    }
}
