export const zusProtocolAbi = [
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
  {
    type: "interface",
    name: "zus_protocol_starknet::contracts::zus_protocol::IZusProtocol",
    items: [
      {
        type: "function",
        name: "create_campaign",
        inputs: [
          { name: "campaign_id", type: "core::felt252" },
          { name: "verifier", type: "core::starknet::contract_address::ContractAddress" },
          { name: "payout_token", type: "core::starknet::contract_address::ContractAddress" },
          { name: "eligible_root", type: "core::felt252" },
          { name: "message_domain", type: "core::felt252" },
          { name: "payout_amount", type: "core::integer::u256" },
          { name: "metadata_hash", type: "core::felt252" },
        ],
        outputs: [],
        state_mutability: "external",
      },
      {
        type: "function",
        name: "fund_campaign",
        inputs: [
          { name: "campaign_id", type: "core::felt252" },
          { name: "amount", type: "core::integer::u256" },
        ],
        outputs: [],
        state_mutability: "external",
      },
    ],
  },
];

export const erc20Abi = [
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
  {
    type: "interface",
    name: "zus_protocol_starknet::interfaces::erc20::IERC20",
    items: [
      {
        type: "function",
        name: "approve",
        inputs: [
          { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
          { name: "amount", type: "core::integer::u256" },
        ],
        outputs: [{ type: "core::bool" }],
        state_mutability: "external",
      },
    ],
  },
];
