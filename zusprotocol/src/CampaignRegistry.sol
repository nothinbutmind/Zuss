// SPDX-License-Identifier: MIT
pragma solidity >=0.8.21;

contract CampaignRegistry {
    error CampaignAlreadyExists(bytes32 campaignKey);
    error CampaignNotFound(bytes32 campaignKey);
    error CreatorMismatch(address expected, address actual);
    error InvalidRecipientCount();
    error DuplicateRecipient(address recipient);
    error InvalidAmount();
    error InvalidRecipient();
    error RecipientNotFound(bytes32 campaignKey, address recipient);

    event CampaignCreated(
        bytes32 indexed campaignKey, string campaignId, address indexed creator, uint256 recipientCount
    );
    event CampaignPayloadPosted(bytes32 indexed campaignKey, string payload);

    struct Campaign {
        string campaignId;
        address creator;
        string merkleRoot;
        uint256 leafCount;
        uint256 depth;
        string hashAlgorithm;
        string leafEncoding;
        bool exists;
    }

    struct Claim {
        uint256 amount;
        uint256 index;
        bool exists;
    }

    mapping(bytes32 => Campaign) private campaigns;
    mapping(bytes32 => mapping(address => Claim)) private campaignClaims;
    mapping(address => bytes32[]) private creatorCampaignKeys;
    bytes32[] private allCampaignKeys;

    function createCampaign(
        string calldata campaignId,
        address campaignCreatorAddress,
        string calldata merkleRoot,
        uint256 depth,
        string calldata hashAlgorithm,
        string calldata leafEncoding,
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata payload
    ) external returns (bytes32 campaignKey) {
        if (campaignCreatorAddress != msg.sender) {
            revert CreatorMismatch(campaignCreatorAddress, msg.sender);
        }
        if (recipients.length == 0 || recipients.length != amounts.length) {
            revert InvalidRecipientCount();
        }

        campaignKey = keccak256(bytes(campaignId));
        if (campaigns[campaignKey].exists) {
            revert CampaignAlreadyExists(campaignKey);
        }

        Campaign storage campaign = campaigns[campaignKey];
        campaign.campaignId = campaignId;
        campaign.creator = campaignCreatorAddress;
        campaign.merkleRoot = merkleRoot;
        campaign.leafCount = recipients.length;
        campaign.depth = depth;
        campaign.hashAlgorithm = hashAlgorithm;
        campaign.leafEncoding = leafEncoding;
        campaign.exists = true;

        for (uint256 i = 0; i < recipients.length; ++i) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            if (recipient == address(0)) revert InvalidRecipient();
            if (amount == 0) revert InvalidAmount();
            if (campaignClaims[campaignKey][recipient].exists) {
                revert DuplicateRecipient(recipient);
            }

            campaignClaims[campaignKey][recipient] = Claim({amount: amount, index: i, exists: true});
        }

        creatorCampaignKeys[campaignCreatorAddress].push(campaignKey);
        allCampaignKeys.push(campaignKey);

        emit CampaignCreated(campaignKey, campaignId, campaignCreatorAddress, recipients.length);
        emit CampaignPayloadPosted(campaignKey, payload);
    }

    function getCampaign(bytes32 campaignKey) external view returns (Campaign memory) {
        Campaign memory campaign = campaigns[campaignKey];
        if (!campaign.exists) revert CampaignNotFound(campaignKey);
        return campaign;
    }

    function getClaim(bytes32 campaignKey, address recipient) external view returns (Claim memory) {
        if (!campaigns[campaignKey].exists) revert CampaignNotFound(campaignKey);
        Claim memory claim = campaignClaims[campaignKey][recipient];
        if (!claim.exists) revert RecipientNotFound(campaignKey, recipient);
        return claim;
    }

    function getCreatorCampaignKeys(address creator) external view returns (bytes32[] memory) {
        return creatorCampaignKeys[creator];
    }

    function getAllCampaignKeys() external view returns (bytes32[] memory) {
        return allCampaignKeys;
    }

    function campaignKeyForId(string calldata campaignId) external pure returns (bytes32) {
        return keccak256(bytes(campaignId));
    }
}
