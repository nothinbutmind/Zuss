use acir_field::{AcirField, FieldElement};
use bn254_blackbox_solver::poseidon2_permutation;
use num_bigint::BigUint;
use serde::Serialize;

const TREE_DEPTH: usize = 12;

#[derive(Serialize)]
struct ClaimFixture {
    leaf_address: String,
    leaf_value: String,
    eligible_root: String,
    eligible_path: Vec<String>,
    eligible_index: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = std::env::args()
        .nth(1)
        .ok_or("usage: cargo run --example claim_fixture -- <wallet_address>")?;
    let normalized = normalize_address(&address)?;
    let leaf = address_to_field(&normalized)?;
    let artifacts = build_noir_merkle_artifacts(&[leaf])?;

    let fixture = ClaimFixture {
        leaf_address: normalized,
        leaf_value: artifacts.leaf_values[0].clone(),
        eligible_root: artifacts.root,
        eligible_path: artifacts.proofs[0].clone(),
        eligible_index: "0".to_string(),
    };

    println!("{}", serde_json::to_string_pretty(&fixture)?);
    Ok(())
}

struct NoirMerkleArtifacts {
    leaf_values: Vec<String>,
    proofs: Vec<Vec<String>>,
    root: String,
}

fn normalize_address(address: &str) -> Result<String, String> {
    let trimmed = address.trim();
    if trimmed.len() != 42 || !trimmed.starts_with("0x") {
        return Err(format!("invalid Ethereum address format: {trimmed}"));
    }

    if !trimmed[2..]
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return Err(format!("invalid Ethereum address hex: {trimmed}"));
    }

    Ok(format!("0x{}", trimmed[2..].to_ascii_lowercase()))
}

fn address_to_field(address: &str) -> Result<FieldElement, String> {
    let decoded = hex::decode(&address[2..])
        .map_err(|_| format!("invalid Ethereum address hex: {address}"))?;
    let address_bytes: [u8; 20] = decoded
        .as_slice()
        .try_into()
        .map_err(|_| format!("Ethereum address must decode to 20 bytes: {address}"))?;
    Ok(FieldElement::from_be_bytes_reduce(&address_bytes))
}

fn build_noir_merkle_artifacts(leaves: &[FieldElement]) -> Result<NoirMerkleArtifacts, String> {
    let layer_width = 1usize << TREE_DEPTH;
    let mut levels = Vec::with_capacity(TREE_DEPTH + 1);
    let mut leaf_layer = vec![FieldElement::zero(); layer_width];

    for (index, leaf) in leaves.iter().enumerate() {
        leaf_layer[index] = *leaf;
    }

    levels.push(leaf_layer);

    for level in 0..TREE_DEPTH {
        let current = &levels[level];
        let mut next = Vec::with_capacity(current.len() / 2);

        for pair in current.chunks_exact(2) {
            next.push(poseidon2_hash_pair(&pair[0], &pair[1])?);
        }

        levels.push(next);
    }

    let proofs = (0..leaves.len())
        .map(|original_index| {
            let mut index = original_index;
            let mut path = Vec::with_capacity(TREE_DEPTH);

            for level in 0..TREE_DEPTH {
                let sibling_index = index ^ 1;
                path.push(canonical_field_string(&levels[level][sibling_index]));
                index /= 2;
            }

            path
        })
        .collect();

    Ok(NoirMerkleArtifacts {
        leaf_values: leaves.iter().map(canonical_field_string).collect(),
        proofs,
        root: canonical_field_string(&levels[TREE_DEPTH][0]),
    })
}

fn poseidon2_hash_pair(left: &FieldElement, right: &FieldElement) -> Result<FieldElement, String> {
    let two_pow_64 = FieldElement::from(18_446_744_073_709_551_616u128);
    let iv = FieldElement::from(2u128) * two_pow_64;
    let state = [*left, *right, FieldElement::zero(), iv];
    let output = poseidon2_permutation(&state, 4)
        .map_err(|error| format!("failed to compute Poseidon2 permutation: {error}"))?;

    Ok(output[0])
}

fn canonical_field_string(field: &FieldElement) -> String {
    BigUint::from_bytes_be(&field.to_be_bytes()).to_string()
}
