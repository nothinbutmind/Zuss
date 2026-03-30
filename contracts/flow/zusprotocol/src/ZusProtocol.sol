// SPDX-License-Identifier: MIT
pragma solidity >=0.8.21;

interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

contract ZusProtocol {
    uint256 public constant PUBLIC_INPUTS_LENGTH = 74;
    uint256 private constant MESSAGE_LENGTH = 8;
    uint256 private constant ELIGIBLE_ROOT_INDEX = 8;
    uint256 private constant NULLIFIER_X_START = 9;
    uint256 private constant NULLIFIER_Y_START = 41;
    uint256 private constant STEALTH_ADDRESS_INDEX = 73;

    error InvalidCampaignId();
    error CampaignAlreadyExists(bytes32 campaignId);
    error CampaignNotFound(bytes32 campaignId);
    error NotCampaignOwner(bytes32 campaignId, address caller);
    error InvalidVerifier();
    error InvalidPayoutAmount();
    error InvalidFundingAmount();
    error InvalidPublicInputsLength(uint256 actualLength);
    error UnexpectedMessageByte(uint256 index, bytes32 actualWord, uint8 expectedByte);
    error UnexpectedEligibleRoot(bytes32 actualRoot, bytes32 expectedRoot);
    error UnexpectedPublicByte(uint256 index, bytes32 actualWord);
    error InvalidStealthAddress(bytes32 actualWord);
    error NullifierAlreadyUsed(bytes32 campaignId, bytes32 nullifierHash);
    error InvalidProof();
    error InsufficientCampaignBalance(bytes32 campaignId, uint256 available, uint256 required);
    error PayoutFailed();

    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed owner,
        address indexed verifier,
        bytes32 eligibleRoot,
        bytes8 expectedMessage,
        uint256 payoutAmount,
        uint256 initialBalance
    );
    event CampaignFunded(
        bytes32 indexed campaignId,
        address indexed funder,
        uint256 amount,
        uint256 newBalance
    );
    event Claimed(
        bytes32 indexed campaignId,
        address indexed caller,
        address indexed stealthRecipient,
        bytes32 nullifierHash,
        uint256 payoutAmount
    );
    event CampaignWithdrawn(
        bytes32 indexed campaignId,
        address indexed recipient,
        uint256 amount,
        uint256 remainingBalance
    );

    struct Campaign {
        address owner;
        address verifier;
        bytes32 eligibleRoot;
        bytes8 expectedMessage;
        uint256 payoutAmount;
        uint256 balance;
        bool exists;
    }

    struct ClaimPreview {
        bytes32 eligibleRoot;
        bytes32 nullifierHash;
        address stealthRecipient;
        uint256 payoutAmount;
        uint256 campaignBalance;
        bool alreadyClaimed;
    }

    struct DecodedClaim {
        bytes32 eligibleRoot;
        bytes32 nullifierHash;
        address stealthRecipient;
    }

    // Keep heavy Merkle data in the Rust API; onchain we only need campaign-level config.
    mapping(bytes32 => Campaign) public campaigns;
    mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

    function createCampaign(
        bytes32 campaignId,
        address verifier,
        bytes32 eligibleRoot,
        bytes8 expectedMessage,
        uint256 payoutAmount
    ) external payable {
        if (campaignId == bytes32(0)) revert InvalidCampaignId();
        if (verifier == address(0)) revert InvalidVerifier();
        if (payoutAmount == 0) revert InvalidPayoutAmount();
        if (campaigns[campaignId].exists) revert CampaignAlreadyExists(campaignId);

        campaigns[campaignId] = Campaign({
            owner: msg.sender,
            verifier: verifier,
            eligibleRoot: eligibleRoot,
            expectedMessage: expectedMessage,
            payoutAmount: payoutAmount,
            balance: msg.value,
            exists: true
        });

        emit CampaignCreated(
            campaignId,
            msg.sender,
            verifier,
            eligibleRoot,
            expectedMessage,
            payoutAmount,
            msg.value
        );
    }

    function fundCampaign(bytes32 campaignId) external payable {
        if (msg.value == 0) revert InvalidFundingAmount();

        Campaign storage campaign = _loadCampaign(campaignId);
        campaign.balance += msg.value;

        emit CampaignFunded(campaignId, msg.sender, msg.value, campaign.balance);
    }

    function claim(bytes32 campaignId, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        returns (address stealthRecipient)
    {
        Campaign storage campaign = _loadCampaign(campaignId);
        DecodedClaim memory decoded = _decodeAndValidate(campaign, publicInputs);

        if (nullifierUsed[campaignId][decoded.nullifierHash]) {
            revert NullifierAlreadyUsed(campaignId, decoded.nullifierHash);
        }
        if (campaign.balance < campaign.payoutAmount) {
            revert InsufficientCampaignBalance(campaignId, campaign.balance, campaign.payoutAmount);
        }

        bool verified = IVerifier(campaign.verifier).verify(proof, publicInputs);
        if (!verified) revert InvalidProof();

        nullifierUsed[campaignId][decoded.nullifierHash] = true;
        campaign.balance -= campaign.payoutAmount;
        stealthRecipient = decoded.stealthRecipient;

        (bool sent,) = stealthRecipient.call{value: campaign.payoutAmount}("");
        if (!sent) revert PayoutFailed();

        emit Claimed(campaignId, msg.sender, stealthRecipient, decoded.nullifierHash, campaign.payoutAmount);
    }

    function previewClaim(bytes32 campaignId, bytes32[] calldata publicInputs)
        external
        view
        returns (ClaimPreview memory preview)
    {
        Campaign storage campaign = _loadCampaign(campaignId);
        DecodedClaim memory decoded = _decodeAndValidate(campaign, publicInputs);

        preview = ClaimPreview({
            eligibleRoot: decoded.eligibleRoot,
            nullifierHash: decoded.nullifierHash,
            stealthRecipient: decoded.stealthRecipient,
            payoutAmount: campaign.payoutAmount,
            campaignBalance: campaign.balance,
            alreadyClaimed: nullifierUsed[campaignId][decoded.nullifierHash]
        });
    }

    function decodeStealthAddress(bytes32[] calldata publicInputs) external pure returns (address) {
        if (publicInputs.length != PUBLIC_INPUTS_LENGTH) {
            revert InvalidPublicInputsLength(publicInputs.length);
        }

        return _decodeStealthAddress(publicInputs[STEALTH_ADDRESS_INDEX]);
    }

    function withdrawCampaignBalance(bytes32 campaignId, address payable recipient, uint256 amount) external {
        Campaign storage campaign = _loadCampaign(campaignId);

        if (msg.sender != campaign.owner) {
            revert NotCampaignOwner(campaignId, msg.sender);
        }
        if (campaign.balance < amount) {
            revert InsufficientCampaignBalance(campaignId, campaign.balance, amount);
        }

        campaign.balance -= amount;

        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert PayoutFailed();

        emit CampaignWithdrawn(campaignId, recipient, amount, campaign.balance);
    }

    function _loadCampaign(bytes32 campaignId) internal view returns (Campaign storage campaign) {
        if (campaignId == bytes32(0)) revert InvalidCampaignId();

        campaign = campaigns[campaignId];
        if (!campaign.exists) revert CampaignNotFound(campaignId);
    }

    function _decodeAndValidate(Campaign storage campaign, bytes32[] calldata publicInputs)
        internal
        view
        returns (DecodedClaim memory decoded)
    {
        if (publicInputs.length != PUBLIC_INPUTS_LENGTH) {
            revert InvalidPublicInputsLength(publicInputs.length);
        }

        _validateMessage(campaign.expectedMessage, publicInputs);

        decoded.eligibleRoot = publicInputs[ELIGIBLE_ROOT_INDEX];
        if (decoded.eligibleRoot != campaign.eligibleRoot) {
            revert UnexpectedEligibleRoot(decoded.eligibleRoot, campaign.eligibleRoot);
        }

        bytes32 nullifierX = _packOutputBytes(publicInputs, NULLIFIER_X_START);
        bytes32 nullifierY = _packOutputBytes(publicInputs, NULLIFIER_Y_START);

        decoded.nullifierHash = keccak256(abi.encodePacked(nullifierX, nullifierY));
        decoded.stealthRecipient = _decodeStealthAddress(publicInputs[STEALTH_ADDRESS_INDEX]);
    }

    function _validateMessage(bytes8 expectedMessage, bytes32[] calldata publicInputs) internal pure {
        bytes memory messageBytes = abi.encodePacked(expectedMessage);

        for (uint256 i = 0; i < MESSAGE_LENGTH; ++i) {
            uint256 actualWord = uint256(publicInputs[i]);
            uint8 expectedByte = uint8(messageBytes[i]);

            if (actualWord != expectedByte) {
                revert UnexpectedMessageByte(i, publicInputs[i], expectedByte);
            }
        }
    }

    function _packOutputBytes(bytes32[] calldata publicInputs, uint256 startIndex)
        internal
        pure
        returns (bytes32 packedBytes)
    {
        uint256 packed;

        for (uint256 i = 0; i < 32; ++i) {
            uint256 word = uint256(publicInputs[startIndex + i]);
            if (word > type(uint8).max) {
                revert UnexpectedPublicByte(startIndex + i, publicInputs[startIndex + i]);
            }
            packed = (packed << 8) | word;
        }

        packedBytes = bytes32(packed);
    }

    function _decodeStealthAddress(bytes32 publicInputWord) internal pure returns (address) {
        uint256 rawAddress = uint256(publicInputWord);
        if (rawAddress > type(uint160).max) {
            revert InvalidStealthAddress(publicInputWord);
        }

        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(rawAddress));
    }
}
