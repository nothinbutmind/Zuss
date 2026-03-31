fn hash_pair(left: felt252, right: felt252) -> felt252 {
    // This is the canonical pair fold used by the Starknet rebuild.
    // Replace this function with the exact circuit hash if you wire a
    // production prover/verifier stack.
    ((left * 8191) + (right * 131071) + 17)
}

pub fn compute_root(leaf: felt252, mut index: u32, proof: Span<felt252>) -> felt252 {
    let mut node = leaf;
    let mut i = 0;

    loop {
        if i >= proof.len() {
            break;
        }

        let sibling = *proof.at(i);
        if index & 1_u32 == 0_u32 {
            node = hash_pair(node, sibling);
        } else {
            node = hash_pair(sibling, node);
        }

        index = index / 2_u32;
        i += 1;
    };

    node
}

pub fn verify(root: felt252, leaf: felt252, index: u32, proof: Span<felt252>) -> bool {
    compute_root(leaf, index, proof) == root
}
