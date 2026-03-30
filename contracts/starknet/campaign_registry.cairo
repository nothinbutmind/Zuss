use zus_protocol_starknet::types::RegistryCampaign;

#[starknet::interface]
pub trait ICampaignRegistry<TContractState> {
    fn register_campaign(
        ref self: TContractState,
        campaign_id: felt252,
        protocol_campaign_id: felt252,
        merkle_root: felt252,
        leaf_count: u32,
        depth: u8,
        hash_algorithm_id: felt252,
        leaf_encoding_id: felt252,
        metadata_hash: felt252,
        payload_hash: felt252,
    );

    fn update_payload_hash(ref self: TContractState, campaign_id: felt252, payload_hash: felt252);

    fn get_campaign(self: @TContractState, campaign_id: felt252) -> RegistryCampaign;
}

#[starknet::contract]
mod CampaignRegistry {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::ICampaignRegistry;
    use zus_protocol_starknet::types::RegistryCampaign;

    #[storage]
    struct Storage {
        campaigns: Map<felt252, RegistryCampaign>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CampaignRegistered: CampaignRegistered,
        PayloadHashUpdated: PayloadHashUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct CampaignRegistered {
        campaign_id: felt252,
        creator: ContractAddress,
        merkle_root: felt252,
        metadata_hash: felt252,
        payload_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct PayloadHashUpdated {
        campaign_id: felt252,
        payload_hash: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl RegistryImpl of ICampaignRegistry<ContractState> {
        fn register_campaign(
            ref self: ContractState,
            campaign_id: felt252,
            protocol_campaign_id: felt252,
            merkle_root: felt252,
            leaf_count: u32,
            depth: u8,
            hash_algorithm_id: felt252,
            leaf_encoding_id: felt252,
            metadata_hash: felt252,
            payload_hash: felt252,
        ) {
            assert(campaign_id != 0, 'BAD_ID');
            assert(merkle_root != 0, 'BAD_ROOT');
            assert(leaf_count > 0, 'BAD_COUNT');
            assert(!self.campaigns.read(campaign_id).exists, 'EXISTS');

            let creator = get_caller_address();
            let campaign = RegistryCampaign {
                creator,
                protocol_campaign_id,
                merkle_root,
                leaf_count,
                depth,
                hash_algorithm_id,
                leaf_encoding_id,
                metadata_hash,
                payload_hash,
                exists: true,
            };

            self.campaigns.write(campaign_id, campaign);
            self.emit(
                Event::CampaignRegistered(
                    CampaignRegistered { campaign_id, creator, merkle_root, metadata_hash, payload_hash },
                ),
            );
        }

        fn update_payload_hash(ref self: ContractState, campaign_id: felt252, payload_hash: felt252) {
            let current = self.campaigns.read(campaign_id);
            assert(current.exists, 'MISSING');
            assert(current.creator == get_caller_address(), 'NOT_CREATOR');

            let updated = RegistryCampaign {
                creator: current.creator,
                protocol_campaign_id: current.protocol_campaign_id,
                merkle_root: current.merkle_root,
                leaf_count: current.leaf_count,
                depth: current.depth,
                hash_algorithm_id: current.hash_algorithm_id,
                leaf_encoding_id: current.leaf_encoding_id,
                metadata_hash: current.metadata_hash,
                payload_hash,
                exists: true,
            };

            self.campaigns.write(campaign_id, updated);
            self.emit(Event::PayloadHashUpdated(PayloadHashUpdated { campaign_id, payload_hash }));
        }

        fn get_campaign(self: @ContractState, campaign_id: felt252) -> RegistryCampaign {
            let campaign = self.campaigns.read(campaign_id);
            assert(campaign.exists, 'MISSING');
            campaign
        }
    }
}
