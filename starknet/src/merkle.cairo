use core::pedersen::pedersen;

pub const TREE_DEPTH: usize = 12;

/// Verifies that a leaf belongs to a Merkle tree with the given root.
///
/// Inputs:
/// - `leaf`: the leaf value being proven
/// - `root`: the Merkle root committed onchain
/// - `proof_path`: the list of sibling nodes from leaf to root
/// - `leaf_index`: the zero-based index of the leaf in the tree
///
/// The tree uses Pedersen hashing for each parent node:
/// `parent = pedersen(left_child, right_child)`.
pub fn verify_membership(
    leaf: felt252, root: felt252, proof_path: Span<felt252>, leaf_index: usize,
) -> bool {
    // A valid proof for this protocol must match the fixed tree depth exactly.
    if proof_path.len() != TREE_DEPTH {
        return false;
    };

    // Start from the candidate leaf and iteratively rebuild each parent on the way to the root.
    let mut current_hash = leaf;
    let mut current_index = leaf_index;
    let mut level = 0;

    loop {
        if level == TREE_DEPTH {
            break;
        };

        // Each proof element is the sibling of the current node at this tree level.
        let sibling = *proof_path.at(level);

        // If the current node index is even, the node is a left child and the sibling is on the
        // right. If the index is odd, the sibling is on the left and the current node is on the
        // right. The ordering matters because Pedersen hash is not commutative.
        if current_index % 2 == 0 {
            current_hash = pedersen(current_hash, sibling);
        } else {
            current_hash = pedersen(sibling, current_hash);
        };

        // Move one level up the tree by dividing the index by two.
        current_index = current_index / 2;
        level += 1;
    };

    // The proof is valid if the reconstructed root matches the expected Merkle root.
    current_hash == root
}
