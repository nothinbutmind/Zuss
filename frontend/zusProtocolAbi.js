export const zusProtocolAbi = [
  {
    type: "function",
    name: "createCampaign",
    stateMutability: "payable",
    inputs: [
      { name: "campaignId", type: "bytes32" },
      { name: "verifier", type: "address" },
      { name: "eligibleRoot", type: "bytes32" },
      { name: "expectedMessage", type: "bytes8" },
      { name: "payoutAmount", type: "uint256" },
    ],
    outputs: [],
  },
];
