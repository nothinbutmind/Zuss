use bignum::{BigNum, Secp256k1_Fr as Secp256k1Fr};
use keccak256::keccak256;
use noir_bigcurve::BigCurve;
use noir_bigcurve::curves::secp256k1::{Secp256k1, Secp256k1Scalar};
use poseidon::poseidon2::Poseidon2::hash;
use trees::merkle::MerkleTree;
use trees::types::{MT_Creator, MembershipProver};

global DEPTH: u32 = 12;
global COMPRESSED_SIZE_BYTES: u32 = 33;

struct ClaimOutputs {
    nullifier_x: [u8; 32],
    nullifier_y: [u8; 32],
    stealth_address: Field,
}

fn hasher(leaves: [Field; 2]) -> Field {
    hash(leaves, 2)
}

fn compress_point(point: Secp256k1) -> [u8; COMPRESSED_SIZE_BYTES] {
    let x = point.x.to_le_bytes();
    let y = point.y.to_le_bytes();
    let mut compressed = [0 as u8; COMPRESSED_SIZE_BYTES];

    compressed[0] = (y[0] & 1) + 2;
    for i in 0..32 {
        compressed[32 - i] = x[i];
    }

    compressed
}

fn plume_message<let L: u32>(message: [u8; L], pubkey: Secp256k1) -> [u8; L + COMPRESSED_SIZE_BYTES] {
    let mut result = [0 as u8; L + COMPRESSED_SIZE_BYTES];

    for i in 0..L {
        result[i] = message[i];
    }

    let compressed = compress_point(pubkey);
    for i in 0..COMPRESSED_SIZE_BYTES {
        result[L + i] = compressed[i];
    }

    result
}

fn derive_nullifier<let L: u32>(
    message: [u8; L],
    wallet_scalar: Secp256k1Scalar,
    pubkey: Secp256k1,
) -> Secp256k1 {
    let h = Secp256k1::hash_to_curve(plume_message(message, pubkey));
    h.mul(wallet_scalar)
}

fn to_eth_address(pub_key_x: [u8; 32], pub_key_y: [u8; 32]) -> Field {
    let mut pub_key = [0 as u8; 64];

    for i in 0..32 {
        pub_key[i] = pub_key_x[i];
        pub_key[32 + i] = pub_key_y[i];
    }

    let hashed = keccak256(pub_key, 64);
    let mut address: Field = 0;

    for i in 0..20 {
        address = (address * 256) + (hashed[12 + i] as Field);
    }

    address
}

fn derive_stealth_address(
    base_pubkey: Secp256k1,
    stealth_tweak: Secp256k1Scalar,
    base_address: Field,
) -> Field {
    let stealth_pubkey = base_pubkey + Secp256k1::one().mul(stealth_tweak);
    assert(stealth_pubkey.is_infinity == false);

    let stealth_address = to_eth_address(
        stealth_pubkey.x.to_be_bytes(),
        stealth_pubkey.y.to_be_bytes(),
    );

    // Keep payouts off the original allowlisted address.
    assert(stealth_address != base_address);
    stealth_address
}

fn main(
    wallet_secret: [u8; 32],
    stealth_tweak: [u8; 32],
    message: pub [u8; 8],
    eligible_root: pub Field,
    eligible_path: [Field; DEPTH],
    eligible_index: Field,
) -> pub ClaimOutputs {
    let wallet_scalar =
        Secp256k1Scalar::from_bignum(Secp256k1Fr::from_be_bytes(wallet_secret));
    let stealth_scalar = Secp256k1Scalar::from_bignum(Secp256k1Fr::from_be_bytes(stealth_tweak));

    let pubkey = Secp256k1::one().mul(wallet_scalar);
    assert(pubkey.is_infinity == false);
    let nullifier = derive_nullifier(message, wallet_scalar, pubkey);
    assert(nullifier.is_infinity == false);

    let address = to_eth_address(pubkey.x.to_be_bytes(), pubkey.y.to_be_bytes());

    let mt = MerkleTree::from(eligible_root, hasher);
    mt.membership(address, eligible_index, eligible_path);

    ClaimOutputs {
        nullifier_x: nullifier.x.to_be_bytes(),
        nullifier_y: nullifier.y.to_be_bytes(),
        stealth_address: derive_stealth_address(pubkey, stealth_scalar, address),
    }
}
