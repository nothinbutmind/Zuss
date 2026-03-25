// SPDX-License-Identifier: MIT
pragma solidity >=0.8.21;

import "../src/CampaignRegistry.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
}

address constant HEVM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant vm = Vm(HEVM_ADDRESS);

contract CampaignRegistryTest {
    CampaignRegistry internal registry;

    address internal constant CREATOR = address(0xA11CE);
    address internal constant RECIPIENT_ONE = address(0xBEEF);
    address internal constant RECIPIENT_TWO = address(0xCAFE);

    function setUp() public {
        registry = new CampaignRegistry();
    }

    function testCreateCampaignStoresQueryableData() public {
        (address[] memory recipients, uint256[] memory amounts) = _sampleRecipients();
        bytes32 expectedKey = keccak256(bytes("campaign-1"));

        vm.prank(CREATOR);
        bytes32 createdKey = registry.createCampaign(
            "campaign-1",
            CREATOR,
            "123456",
            12,
            "poseidon2_bn254",
            "field(uint160(address))",
            recipients,
            amounts,
            "{\"campaign\":\"payload\"}"
        );

        require(createdKey == expectedKey, "wrong campaign key");

        CampaignRegistry.Campaign memory campaign = registry.getCampaign(expectedKey);
        require(keccak256(bytes(campaign.campaignId)) == keccak256("campaign-1"), "wrong id");
        require(campaign.creator == CREATOR, "wrong creator");
        require(campaign.leafCount == 2, "wrong leaf count");
        require(campaign.depth == 12, "wrong depth");

        CampaignRegistry.Claim memory claimOne = registry.getClaim(expectedKey, RECIPIENT_ONE);
        require(claimOne.amount == 100, "wrong amount one");
        require(claimOne.index == 0, "wrong index one");

        CampaignRegistry.Claim memory claimTwo = registry.getClaim(expectedKey, RECIPIENT_TWO);
        require(claimTwo.amount == 250, "wrong amount two");
        require(claimTwo.index == 1, "wrong index two");

        bytes32[] memory creatorKeys = registry.getCreatorCampaignKeys(CREATOR);
        require(creatorKeys.length == 1, "wrong creator campaign count");
        require(creatorKeys[0] == expectedKey, "wrong creator campaign key");

        bytes32[] memory allKeys = registry.getAllCampaignKeys();
        require(allKeys.length == 1, "wrong all campaign count");
        require(allKeys[0] == expectedKey, "wrong global campaign key");
    }

    function testCreateCampaignRejectsCreatorMismatch() public {
        (address[] memory recipients, uint256[] memory amounts) = _sampleRecipients();

        vm.expectRevert(abi.encodeWithSelector(CampaignRegistry.CreatorMismatch.selector, CREATOR, address(this)));
        registry.createCampaign(
            "campaign-1",
            CREATOR,
            "123456",
            12,
            "poseidon2_bn254",
            "field(uint160(address))",
            recipients,
            amounts,
            "{\"campaign\":\"payload\"}"
        );
    }

    function testCreateCampaignRejectsDuplicateRecipients() public {
        address[] memory recipients = new address[](2);
        recipients[0] = RECIPIENT_ONE;
        recipients[1] = RECIPIENT_ONE;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100;
        amounts[1] = 200;

        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(CampaignRegistry.DuplicateRecipient.selector, RECIPIENT_ONE));
        registry.createCampaign(
            "campaign-1",
            CREATOR,
            "123456",
            12,
            "poseidon2_bn254",
            "field(uint160(address))",
            recipients,
            amounts,
            "{\"campaign\":\"payload\"}"
        );
    }

    function _sampleRecipients() internal pure returns (address[] memory recipients, uint256[] memory amounts) {
        recipients = new address[](2);
        recipients[0] = RECIPIENT_ONE;
        recipients[1] = RECIPIENT_TWO;

        amounts = new uint256[](2);
        amounts[0] = 100;
        amounts[1] = 250;
    }
}
