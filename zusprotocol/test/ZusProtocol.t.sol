// SPDX-License-Identifier: MIT
pragma solidity >=0.8.21;

import {IVerifier, ZusProtocol} from "../src/ZusProtocol.sol";

interface Vm {
    function prank(address sender) external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
}

address constant HEVM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant VM = Vm(HEVM_ADDRESS);

contract MockVerifier is IVerifier {
    bool public shouldVerify = true;

    function setShouldVerify(bool newValue) external {
        shouldVerify = newValue;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldVerify;
    }
}

contract ZusProtocolTest {
    bytes32 internal constant CAMPAIGN_ID = bytes32(uint256(0xCAFE));
    address internal constant CONSISTENCY_CREATOR = 0x308056ef9E0e21CD3e15414F59a17e9d4C510638;
    bytes8 internal constant MESSAGE = "ZUSMVP01";
    bytes32 internal constant ROOT = bytes32(uint256(0x1234));
    uint256 internal constant PAYOUT = 0.25 ether;

    MockVerifier internal verifier;
    ZusProtocol internal protocol;

    function setUp() public {
        verifier = new MockVerifier();
        protocol = new ZusProtocol();
        protocol.createCampaign{value: 1 ether}(CAMPAIGN_ID, address(verifier), ROOT, MESSAGE, PAYOUT);
    }

    function testCreateCampaignStoresConfigAndBalance() public view {
        (
            address owner,
            address campaignVerifier,
            bytes32 eligibleRoot,
            bytes8 expectedMessage,
            uint256 payoutAmount,
            uint256 campaignBalance,
            bool exists
        ) = protocol.campaigns(CAMPAIGN_ID);

        require(owner == address(this), "wrong owner");
        require(campaignVerifier == address(verifier), "wrong verifier");
        require(eligibleRoot == ROOT, "wrong root");
        require(expectedMessage == MESSAGE, "wrong message");
        require(payoutAmount == PAYOUT, "wrong payout");
        require(campaignBalance == 1 ether, "wrong balance");
        require(exists, "campaign missing");
    }

    function testPreviewClaimDecodesClaimData() public view {
        bytes32[] memory publicInputs = _buildPublicInputs(address(0xBEEF));
        bytes32 expectedNullifierHash = _expectedNullifierHash();

        ZusProtocol.ClaimPreview memory preview = protocol.previewClaim(CAMPAIGN_ID, publicInputs);

        require(preview.eligibleRoot == ROOT, "wrong root");
        require(preview.nullifierHash == expectedNullifierHash, "wrong nullifier");
        require(preview.stealthRecipient == address(0xBEEF), "wrong stealth recipient");
        require(preview.payoutAmount == PAYOUT, "wrong payout amount");
        require(preview.campaignBalance == 1 ether, "wrong campaign balance");
        require(!preview.alreadyClaimed, "unexpected claimed state");
    }

    function testDecodeStealthAddressReturnsRecipient() public view {
        bytes32[] memory publicInputs = _buildPublicInputs(address(0xCAFE));
        address stealthRecipient = protocol.decodeStealthAddress(publicInputs);

        require(stealthRecipient == address(0xCAFE), "wrong stealth recipient");
    }

    function testFundCampaignIncreasesBalance() public {
        protocol.fundCampaign{value: 0.5 ether}(CAMPAIGN_ID);

        (,,,,, uint256 campaignBalance,) = protocol.campaigns(CAMPAIGN_ID);
        require(campaignBalance == 1.5 ether, "campaign not funded");
    }

    function testCreateThreeRewardCampaignsStoresIndependentConfigs() public {
        bytes32[3] memory campaignIds = [
            keccak256("crecimiento_rewards"),
            keccak256("avalance_rewards"),
            keccak256("latam_rewards")
        ];
        uint256[3] memory payouts = [uint256(0.1 ether), uint256(0.2 ether), uint256(0.3 ether)];
        uint256[3] memory funding = [uint256(1 ether), uint256(2 ether), uint256(3 ether)];

        VM.deal(CONSISTENCY_CREATOR, 6 ether);

        for (uint256 i = 0; i < campaignIds.length; ++i) {
            VM.prank(CONSISTENCY_CREATOR);
            protocol.createCampaign{value: funding[i]}(
                campaignIds[i], address(verifier), ROOT, MESSAGE, payouts[i]
            );
        }

        for (uint256 i = 0; i < campaignIds.length; ++i) {
            (
                address owner,
                address campaignVerifier,
                bytes32 eligibleRoot,
                bytes8 expectedMessage,
                uint256 payoutAmount,
                uint256 campaignBalance,
                bool exists
            ) = protocol.campaigns(campaignIds[i]);

            require(owner == CONSISTENCY_CREATOR, "wrong campaign owner");
            require(campaignVerifier == address(verifier), "wrong verifier");
            require(eligibleRoot == ROOT, "wrong root");
            require(expectedMessage == MESSAGE, "wrong message");
            require(payoutAmount == payouts[i], "wrong payout");
            require(campaignBalance == funding[i], "wrong balance");
            require(exists, "campaign missing");
        }
    }

    function testClaimPaysStealthAddressAndMarksNullifierUsed() public {
        address claimer = address(0x1111);
        address stealthRecipient = address(0xCAFE);
        bytes32[] memory publicInputs = _buildPublicInputs(stealthRecipient);
        bytes32 expectedNullifierHash = _expectedNullifierHash();
        uint256 beforeBalance = stealthRecipient.balance;

        VM.prank(claimer);
        address returnedRecipient = protocol.claim(CAMPAIGN_ID, hex"1234", publicInputs);

        require(returnedRecipient == stealthRecipient, "wrong return recipient");
        require(stealthRecipient.balance == beforeBalance + PAYOUT, "recipient not paid");
        require(protocol.nullifierUsed(CAMPAIGN_ID, expectedNullifierHash), "nullifier not marked");

        (,,,,, uint256 campaignBalance,) = protocol.campaigns(CAMPAIGN_ID);
        require(campaignBalance == 0.75 ether, "campaign balance not decremented");
    }

    function testClaimRevertsWhenVerifierRejects() public {
        verifier.setShouldVerify(false);
        bytes32[] memory publicInputs = _buildPublicInputs(address(0xCAFE));

        VM.expectRevert(abi.encodeWithSelector(ZusProtocol.InvalidProof.selector));
        protocol.claim(CAMPAIGN_ID, hex"1234", publicInputs);
    }

    function testClaimRevertsOnSecondUse() public {
        address stealthRecipient = address(0xCAFE);
        bytes32[] memory publicInputs = _buildPublicInputs(stealthRecipient);
        bytes32 expectedNullifierHash = _expectedNullifierHash();

        protocol.claim(CAMPAIGN_ID, hex"1234", publicInputs);

        require(protocol.nullifierUsed(CAMPAIGN_ID, expectedNullifierHash), "nullifier missing");

        VM.expectRevert(
            abi.encodeWithSelector(
                ZusProtocol.NullifierAlreadyUsed.selector, CAMPAIGN_ID, expectedNullifierHash
            )
        );
        protocol.claim(CAMPAIGN_ID, hex"1234", publicInputs);
    }

    function _buildPublicInputs(address stealthRecipient) internal pure returns (bytes32[] memory inputs) {
        inputs = new bytes32[](74);

        bytes memory messageBytes = abi.encodePacked(MESSAGE);
        for (uint256 i = 0; i < 8; ++i) {
            inputs[i] = bytes32(uint256(uint8(messageBytes[i])));
        }

        inputs[8] = ROOT;

        bytes memory nullifierX = abi.encodePacked(_nullifierX());
        bytes memory nullifierY = abi.encodePacked(_nullifierY());

        for (uint256 i = 0; i < 32; ++i) {
            inputs[9 + i] = bytes32(uint256(uint8(nullifierX[i])));
            inputs[41 + i] = bytes32(uint256(uint8(nullifierY[i])));
        }

        inputs[73] = bytes32(uint256(uint160(stealthRecipient)));
    }

    function _expectedNullifierHash() internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_nullifierX(), _nullifierY()));
    }

    function _nullifierX() internal pure returns (bytes32) {
        return hex"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    }

    function _nullifierY() internal pure returns (bytes32) {
        return hex"2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40";
    }
}
