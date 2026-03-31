#[starknet::contract]
mod MockErc20 {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use zus_protocol_starknet::interfaces::erc20::IERC20;

    const ZERO_ADDRESS: ContractAddress = 0.try_into().unwrap();

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        from: ContractAddress,
        to: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        owner: ContractAddress,
        spender: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, name: felt252, symbol: felt252, decimals: u8) {
        self.name.write(name);
        self.symbol.write(symbol);
        self.decimals.write(decimals);
        self.total_supply.write(u256_zero());
    }

    #[external(v0)]
    fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
        let balance = self.balances.read(recipient);
        self.balances.write(recipient, balance + amount);
        self.total_supply.write(self.total_supply.read() + amount);
        self.emit(
            Event::Transfer(
                Transfer {
                    from: ZERO_ADDRESS,
                    to: recipient,
                    amount,
                },
            ),
        );
    }

    #[abi(embed_v0)]
    impl Erc20Impl of IERC20<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> felt252 {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            transfer_internal(ref self, sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Event::Approval(Approval { owner, spender, amount }));
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let key = (sender, spender);
            let current_allowance = self.allowances.read(key);
            assert(current_allowance >= amount, 'ALLOWANCE');
            self.allowances.write(key, current_allowance - amount);
            transfer_internal(ref self, sender, recipient, amount);
            true
        }
    }

    fn transfer_internal(
        ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) {
        assert(recipient != ZERO_ADDRESS, 'BAD_RECIPIENT');
        let sender_balance = self.balances.read(sender);
        assert(sender_balance >= amount, 'BALANCE');
        self.balances.write(sender, sender_balance - amount);
        self.balances.write(recipient, self.balances.read(recipient) + amount);
        self.emit(Event::Transfer(Transfer { from: sender, to: recipient, amount }));
    }

    fn u256_zero() -> u256 {
        0
    }
}
