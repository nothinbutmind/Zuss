use crate::{
    error::AppError,
    filecoin::FilecoinClient,
    types::{
        CampaignSummary, ClaimLookupRequest, ClaimPayloadResponse, CreateCampaignRequest,
        CreatorCampaignsResponse, FilecoinCampaignResponse, HealthResponse, NoirClaimInputs,
        PreparedCampaign, PreparedClaim, PublishedCampaignPayload, PublishedRecipient,
        RecipientInput,
    },
};
use acir_field::{AcirField, FieldElement};
use axum::{
    Json,
    extract::{Path, State},
};
use bn254_blackbox_solver::poseidon2_permutation;
use num_bigint::BigUint;
use sqlx::{FromRow, PgPool, types::Json as SqlJson};
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

const TREE_DEPTH: usize = 12;
const MAX_RECIPIENTS: usize = 1 << TREE_DEPTH;
const HASH_ALGORITHM: &str = "poseidon2_bn254";
const LEAF_ENCODING: &str = "field(uint160(address))";

pub struct AppState {
    pub pool: Option<PgPool>,
    pub filecoin: Option<FilecoinClient>,
}

pub type SharedState = Arc<AppState>;

#[derive(Debug, Clone)]
struct NormalizedRecipient {
    leaf_address: String,
    amount: String,
}

#[derive(Debug, FromRow)]
struct CampaignSummaryRow {
    campaign_id: Uuid,
    name: String,
    campaign_creator_address: String,
    merkle_root: String,
    leaf_count: i32,
    depth: i32,
    hash_algorithm: String,
    leaf_encoding: String,
    filecoin_cid: Option<String>,
    filecoin_url: Option<String>,
}

#[derive(Debug, FromRow)]
struct ClaimPayloadRow {
    campaign_id: Uuid,
    name: String,
    campaign_creator_address: String,
    leaf_address: String,
    amount: String,
    leaf_index: i32,
    leaf_value: String,
    proof: SqlJson<Vec<String>>,
    merkle_root: String,
    hash_algorithm: String,
    leaf_encoding: String,
    filecoin_cid: Option<String>,
    filecoin_url: Option<String>,
}

#[derive(Debug)]
struct NoirMerkleArtifacts {
    leaf_values: Vec<String>,
    proofs: Vec<Vec<String>>,
    root: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

pub async fn create_campaign(
    State(state): State<SharedState>,
    Json(payload): Json<CreateCampaignRequest>,
) -> Result<Json<CampaignSummary>, AppError> {
    let mut prepared = prepare_campaign(payload)?;
    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "PRIVATE_KEY and FILECOIN_REGISTRY_ADDRESS must be set to create campaigns on Filecoin testnet with the Zus registry",
        )
    })?;
    let upload = filecoin
        .upload_campaign(&prepared.summary, &prepared.claims)
        .await?;
    prepared.summary.filecoin_cid = None;
    prepared.summary.filecoin_url = Some(upload.url);
    prepared.summary.filecoin_tx_hash = Some(upload.tx_hash);

    if let Some(pool) = &state.pool {
        insert_campaign(pool, &prepared).await?;
    }

    Ok(Json(prepared.summary))
}

pub async fn get_filecoin_campaign(
    State(state): State<SharedState>,
    Path(tx_hash): Path<String>,
) -> Result<Json<FilecoinCampaignResponse>, AppError> {
    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "FILECOIN_RPC_URL must be set to fetch campaigns from Filecoin transactions",
        )
    })?;
    let payload = filecoin.fetch_published_campaign(&tx_hash).await?;
    let (campaign, claims) = reconstruct_campaign_from_published(&payload, &tx_hash)?;

    Ok(Json(FilecoinCampaignResponse {
        tx_hash: tx_hash.clone(),
        filecoin_url: format!("https://calibration.filfox.info/en/message/{}", tx_hash),
        payload,
        campaign,
        claims,
    }))
}

pub async fn get_filecoin_claim_payload_by_path(
    State(state): State<SharedState>,
    Path((tx_hash, leaf_address)): Path<(String, String)>,
) -> Result<Json<ClaimPayloadResponse>, AppError> {
    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "FILECOIN_RPC_URL must be set to fetch claims from Filecoin transactions",
        )
    })?;
    let payload = filecoin.fetch_published_campaign(&tx_hash).await?;
    let leaf_address = normalize_address(&leaf_address)?;
    let (campaign, claims) = reconstruct_campaign_from_published(&payload, &tx_hash)?;

    claim_payload_from_components(&campaign, &claims, &leaf_address).map(Json)
}

pub async fn list_campaigns(
    State(state): State<SharedState>,
) -> Result<Json<Vec<CampaignSummary>>, AppError> {
    if let Some(pool) = state.pool.as_ref() {
        let rows = sqlx::query_as::<_, CampaignSummaryRow>(
            r#"
            SELECT
                id AS campaign_id,
                name,
                campaign_creator_address,
                merkle_root,
                leaf_count,
                depth,
                hash_algorithm,
                leaf_encoding,
                filecoin_cid,
                filecoin_url
            FROM campaigns
            ORDER BY created_at DESC, name ASC
            "#,
        )
        .fetch_all(pool)
        .await?;

        let campaigns = rows
            .into_iter()
            .map(campaign_summary_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        return Ok(Json(campaigns));
    }

    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "listing campaigns requires either DATABASE_URL or FILECOIN_REGISTRY_ADDRESS",
        )
    })?;

    Ok(Json(filecoin.list_registered_campaigns().await?))
}

pub async fn get_campaign(
    State(state): State<SharedState>,
    Path(campaign_id): Path<String>,
) -> Result<Json<CampaignSummary>, AppError> {
    if let Some(pool) = state.pool.as_ref() {
        let campaign_id = parse_campaign_id(&campaign_id)?;
        let row = sqlx::query_as::<_, CampaignSummaryRow>(
            r#"
            SELECT
                id AS campaign_id,
                name,
                campaign_creator_address,
                merkle_root,
                leaf_count,
                depth,
                hash_algorithm,
                leaf_encoding,
                filecoin_cid,
                filecoin_url
            FROM campaigns
            WHERE id = $1
            "#,
        )
        .bind(campaign_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found(format!("campaign not found: {}", campaign_id)))?;

        return Ok(Json(campaign_summary_from_row(row)?));
    }

    let campaign_id = parse_campaign_id(&campaign_id)?;
    let onchain_campaign_id = uuid_to_onchain_campaign_id(campaign_id);
    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "fetching campaigns by id requires either DATABASE_URL or FILECOIN_REGISTRY_ADDRESS",
        )
    })?;

    Ok(Json(
        filecoin
            .fetch_registered_campaign(&onchain_campaign_id)
            .await?
            .summary,
    ))
}

pub async fn get_claim_payload_by_path(
    State(state): State<SharedState>,
    Path((campaign_id, leaf_address)): Path<(String, String)>,
) -> Result<Json<ClaimPayloadResponse>, AppError> {
    let leaf_address = normalize_address(&leaf_address)?;
    if let Some(pool) = state.pool.as_ref() {
        let campaign_id = parse_campaign_id(&campaign_id)?;
        let response = fetch_claim_payload(pool, campaign_id, &leaf_address).await?;
        return Ok(Json(response));
    }

    let campaign_id = parse_campaign_id(&campaign_id)?;
    let onchain_campaign_id = uuid_to_onchain_campaign_id(campaign_id);
    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "claim lookups require either DATABASE_URL or FILECOIN_REGISTRY_ADDRESS",
        )
    })?;
    let registered = filecoin
        .fetch_registered_campaign(&onchain_campaign_id)
        .await?;
    let contract_claim = filecoin
        .fetch_registered_claim(&onchain_campaign_id, &leaf_address)
        .await?;
    let claims = reconstruct_claims_from_published(
        &registered.payload,
        &format!(
            "Filecoin transaction {}",
            registered
                .summary
                .filecoin_tx_hash
                .clone()
                .unwrap_or_default()
        ),
    )?;
    let claim = claims
        .iter()
        .find(|claim| claim.leaf_address == leaf_address)
        .ok_or_else(|| {
            AppError::not_found(format!(
                "claim payload not found for campaign {} and address {}",
                registered.summary.campaign_id, leaf_address
            ))
        })?;
    let reconstructed_index = usize::try_from(claim.index).map_err(|_| {
        AppError::internal("negative leaf index reconstructed from Filecoin payload")
    })?;
    if reconstructed_index != contract_claim.index || claim.amount != contract_claim.amount {
        return Err(AppError::internal(format!(
            "Filecoin payload claim data does not match the Zus protocol record for {}",
            leaf_address
        )));
    }

    Ok(Json(claim_payload_from_components(
        &registered.summary,
        &claims,
        &leaf_address,
    )?))
}

pub async fn get_claim_payload_by_body(
    State(state): State<SharedState>,
    Path(campaign_id): Path<String>,
    Json(payload): Json<ClaimLookupRequest>,
) -> Result<Json<ClaimPayloadResponse>, AppError> {
    let leaf_address = normalize_address(&payload.leaf_address)?;
    get_claim_payload_by_path(State(state), Path((campaign_id, leaf_address))).await
}

pub async fn list_creator_campaigns(
    State(state): State<SharedState>,
    Path(campaign_creator_address): Path<String>,
) -> Result<Json<CreatorCampaignsResponse>, AppError> {
    let campaign_creator_address = normalize_address(&campaign_creator_address)?;
    if let Some(pool) = state.pool.as_ref() {
        let rows = sqlx::query_as::<_, CampaignSummaryRow>(
            r#"
            SELECT
                id AS campaign_id,
                name,
                campaign_creator_address,
                merkle_root,
                leaf_count,
                depth,
                hash_algorithm,
                leaf_encoding,
                filecoin_cid,
                filecoin_url
            FROM campaigns
            WHERE campaign_creator_address = $1
            ORDER BY created_at DESC, name ASC
            "#,
        )
        .bind(&campaign_creator_address)
        .fetch_all(pool)
        .await?;

        let campaigns = rows
            .into_iter()
            .map(campaign_summary_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        return Ok(Json(CreatorCampaignsResponse {
            campaign_creator_address,
            campaigns,
        }));
    }

    let filecoin = state.filecoin.as_ref().ok_or_else(|| {
        AppError::bad_request(
            "listing creator campaigns requires either DATABASE_URL or FILECOIN_REGISTRY_ADDRESS",
        )
    })?;
    let campaigns = filecoin
        .list_registered_creator_campaigns(&campaign_creator_address)
        .await?;

    Ok(Json(CreatorCampaignsResponse {
        campaign_creator_address,
        campaigns,
    }))
}

async fn insert_campaign(pool: &PgPool, prepared: &PreparedCampaign) -> Result<(), AppError> {
    let mut transaction = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO campaigns (
            id,
            name,
            campaign_creator_address,
            merkle_root,
            leaf_count,
            depth,
            hash_algorithm,
            leaf_encoding,
            filecoin_cid,
            filecoin_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(prepared.campaign_id)
    .bind(&prepared.summary.name)
    .bind(&prepared.summary.campaign_creator_address)
    .bind(&prepared.summary.merkle_root)
    .bind(i32::try_from(prepared.summary.leaf_count).map_err(|_| {
        AppError::internal("leaf count overflow while storing the prepared campaign")
    })?)
    .bind(i32::try_from(prepared.summary.depth).map_err(|_| {
        AppError::internal("tree depth overflow while storing the prepared campaign")
    })?)
    .bind(&prepared.summary.hash_algorithm)
    .bind(&prepared.summary.leaf_encoding)
    .bind(&prepared.summary.filecoin_cid)
    .bind(&prepared.summary.filecoin_url)
    .execute(&mut *transaction)
    .await?;

    for claim in &prepared.claims {
        sqlx::query(
            r#"
            INSERT INTO campaign_claims (
                campaign_id,
                leaf_address,
                amount,
                leaf_index,
                leaf_hash,
                proof
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(prepared.campaign_id)
        .bind(&claim.leaf_address)
        .bind(&claim.amount)
        .bind(claim.index)
        .bind(&claim.leaf_value)
        .bind(SqlJson(&claim.proof))
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(())
}

async fn fetch_claim_payload(
    pool: &PgPool,
    campaign_id: Uuid,
    leaf_address: &str,
) -> Result<ClaimPayloadResponse, AppError> {
    let row = sqlx::query_as::<_, ClaimPayloadRow>(
        r#"
        SELECT
            c.id AS campaign_id,
            c.name,
            c.campaign_creator_address,
            cc.leaf_address,
            cc.amount,
            cc.leaf_index,
            cc.leaf_hash AS leaf_value,
            cc.proof,
            c.merkle_root,
            c.hash_algorithm,
            c.leaf_encoding,
            c.filecoin_cid,
            c.filecoin_url
        FROM campaign_claims cc
        INNER JOIN campaigns c ON c.id = cc.campaign_id
        WHERE c.id = $1 AND cc.leaf_address = $2
        "#,
    )
    .bind(campaign_id)
    .bind(leaf_address)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::not_found(format!(
            "claim payload not found for campaign {} and address {}",
            campaign_id, leaf_address
        ))
    })?;

    claim_payload_from_row(row)
}

fn reconstruct_campaign_from_published(
    payload: &PublishedCampaignPayload,
    tx_hash: &str,
) -> Result<(CampaignSummary, Vec<PreparedClaim>), AppError> {
    let campaign_creator_address = normalize_address(&payload.campaign.campaign_creator_address)?;
    let claims =
        reconstruct_claims_from_published(payload, &format!("Filecoin transaction {tx_hash}"))?;

    Ok((
        CampaignSummary {
            campaign_id: payload.campaign.campaign_id.clone(),
            onchain_campaign_id: payload.campaign.onchain_campaign_id.clone(),
            name: payload.campaign.name.clone(),
            campaign_creator_address,
            merkle_root: payload.campaign.merkle_root.clone(),
            leaf_count: claims.len(),
            depth: TREE_DEPTH,
            hash_algorithm: HASH_ALGORITHM.to_string(),
            leaf_encoding: LEAF_ENCODING.to_string(),
            filecoin_cid: None,
            filecoin_url: Some(format!(
                "https://calibration.filfox.info/en/message/{tx_hash}"
            )),
            filecoin_tx_hash: Some(tx_hash.to_string()),
        },
        claims,
    ))
}

fn reconstruct_claims_from_published(
    payload: &PublishedCampaignPayload,
    source: &str,
) -> Result<Vec<PreparedClaim>, AppError> {
    let recipients = normalize_published_recipients(&payload.recipients)?;
    if recipients.is_empty() {
        return Err(AppError::bad_request(format!(
            "{source} does not include any recipients"
        )));
    }
    if recipients.len() > MAX_RECIPIENTS {
        return Err(AppError::bad_request(format!(
            "{source} includes too many recipients: {}",
            recipients.len()
        )));
    }

    let leaves = recipients
        .iter()
        .map(|recipient| address_to_field(&recipient.leaf_address))
        .collect::<Result<Vec<_>, _>>()?;
    let merkle = build_noir_merkle_artifacts(&leaves)?;

    if merkle.root != payload.campaign.merkle_root {
        return Err(AppError::internal(format!(
            "{source} payload root does not match the reconstructed root"
        )));
    }

    recipients
        .into_iter()
        .enumerate()
        .map(|(index, recipient)| {
            Ok(PreparedClaim {
                leaf_address: recipient.leaf_address,
                amount: recipient.amount,
                index: i32::try_from(index)
                    .map_err(|_| AppError::bad_request("too many recipients for i32 leaf index"))?,
                leaf_value: merkle.leaf_values[index].clone(),
                proof: merkle.proofs[index].clone(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()
}

fn normalize_published_recipients(
    recipients: &[PublishedRecipient],
) -> Result<Vec<NormalizedRecipient>, AppError> {
    let mut seen = HashSet::with_capacity(recipients.len());
    let mut normalized = Vec::with_capacity(recipients.len());

    for recipient in recipients {
        let leaf_address = normalize_address(&recipient.leaf_address)?;
        let amount = normalize_amount(&recipient.amount)?;

        if !seen.insert(leaf_address.clone()) {
            return Err(AppError::bad_request(format!(
                "duplicate leaf address found: {}",
                leaf_address
            )));
        }

        normalized.push(NormalizedRecipient {
            leaf_address,
            amount,
        });
    }

    Ok(normalized)
}

fn prepare_campaign(payload: CreateCampaignRequest) -> Result<PreparedCampaign, AppError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(AppError::bad_request("`name` must not be empty"));
    }

    if payload.recipients.is_empty() {
        return Err(AppError::bad_request(
            "`recipients` must contain at least one recipient",
        ));
    }

    let campaign_creator_address = normalize_address(&payload.campaign_creator_address)?;
    let recipients = normalize_recipients(&payload.recipients)?;
    if recipients.len() > MAX_RECIPIENTS {
        return Err(AppError::bad_request(format!(
            "campaign supports at most {} recipients for a depth-{} Noir tree",
            MAX_RECIPIENTS, TREE_DEPTH
        )));
    }

    let leaves = recipients
        .iter()
        .map(|recipient| address_to_field(&recipient.leaf_address))
        .collect::<Result<Vec<_>, _>>()?;
    let merkle = build_noir_merkle_artifacts(&leaves)?;

    let claims = recipients
        .into_iter()
        .enumerate()
        .map(|(index, recipient)| {
            Ok(PreparedClaim {
                leaf_address: recipient.leaf_address,
                amount: recipient.amount,
                index: i32::try_from(index)
                    .map_err(|_| AppError::bad_request("too many recipients for i32 leaf index"))?,
                leaf_value: merkle.leaf_values[index].clone(),
                proof: merkle.proofs[index].clone(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let campaign_id = Uuid::new_v4();
    let leaf_count = recipients_len(&claims);
    let depth = TREE_DEPTH;

    Ok(PreparedCampaign {
        campaign_id,
        summary: CampaignSummary {
            campaign_id: campaign_id.to_string(),
            onchain_campaign_id: uuid_to_onchain_campaign_id(campaign_id),
            name: name.to_owned(),
            campaign_creator_address,
            merkle_root: merkle.root,
            leaf_count,
            depth,
            hash_algorithm: HASH_ALGORITHM.to_string(),
            leaf_encoding: LEAF_ENCODING.to_string(),
            filecoin_cid: None,
            filecoin_url: None,
            filecoin_tx_hash: None,
        },
        claims,
    })
}

fn campaign_summary_from_row(row: CampaignSummaryRow) -> Result<CampaignSummary, AppError> {
    Ok(CampaignSummary {
        campaign_id: row.campaign_id.to_string(),
        onchain_campaign_id: uuid_to_onchain_campaign_id(row.campaign_id),
        name: row.name,
        campaign_creator_address: row.campaign_creator_address,
        merkle_root: row.merkle_root,
        leaf_count: usize::try_from(row.leaf_count)
            .map_err(|_| AppError::internal("negative leaf count loaded from database"))?,
        depth: usize::try_from(row.depth)
            .map_err(|_| AppError::internal("negative tree depth loaded from database"))?,
        hash_algorithm: row.hash_algorithm,
        leaf_encoding: row.leaf_encoding,
        filecoin_cid: row.filecoin_cid,
        filecoin_url: row.filecoin_url,
        filecoin_tx_hash: None,
    })
}

fn claim_payload_from_row(row: ClaimPayloadRow) -> Result<ClaimPayloadResponse, AppError> {
    let index = usize::try_from(row.leaf_index)
        .map_err(|_| AppError::internal("negative leaf index loaded from database"))?;
    let proof = row.proof.0;
    let merkle_root = row.merkle_root;
    let leaf_value = row.leaf_value;

    Ok(ClaimPayloadResponse {
        campaign_id: row.campaign_id.to_string(),
        onchain_campaign_id: uuid_to_onchain_campaign_id(row.campaign_id),
        name: row.name,
        campaign_creator_address: row.campaign_creator_address,
        leaf_address: row.leaf_address,
        amount: row.amount,
        index,
        leaf_value: leaf_value.clone(),
        proof: proof.clone(),
        merkle_root: merkle_root.clone(),
        hash_algorithm: row.hash_algorithm,
        leaf_encoding: row.leaf_encoding,
        filecoin_cid: row.filecoin_cid,
        filecoin_url: row.filecoin_url,
        filecoin_tx_hash: None,
        noir_inputs: NoirClaimInputs {
            eligible_root: merkle_root,
            eligible_path: proof,
            eligible_index: index.to_string(),
            leaf_value,
            tree_depth: TREE_DEPTH,
        },
    })
}

fn claim_payload_from_components(
    campaign: &CampaignSummary,
    claims: &[PreparedClaim],
    leaf_address: &str,
) -> Result<ClaimPayloadResponse, AppError> {
    let claim = claims
        .iter()
        .find(|claim| claim.leaf_address == leaf_address)
        .ok_or_else(|| {
            AppError::not_found(format!(
                "claim payload not found for Filecoin campaign {} and address {}",
                campaign.campaign_id, leaf_address
            ))
        })?;
    let index = usize::try_from(claim.index).map_err(|_| {
        AppError::internal("negative leaf index reconstructed from Filecoin payload")
    })?;

    Ok(ClaimPayloadResponse {
        campaign_id: campaign.campaign_id.clone(),
        onchain_campaign_id: campaign.onchain_campaign_id.clone(),
        name: campaign.name.clone(),
        campaign_creator_address: campaign.campaign_creator_address.clone(),
        leaf_address: claim.leaf_address.clone(),
        amount: claim.amount.clone(),
        index,
        leaf_value: claim.leaf_value.clone(),
        proof: claim.proof.clone(),
        merkle_root: campaign.merkle_root.clone(),
        hash_algorithm: campaign.hash_algorithm.clone(),
        leaf_encoding: campaign.leaf_encoding.clone(),
        filecoin_cid: campaign.filecoin_cid.clone(),
        filecoin_url: campaign.filecoin_url.clone(),
        filecoin_tx_hash: campaign.filecoin_tx_hash.clone(),
        noir_inputs: NoirClaimInputs {
            eligible_root: campaign.merkle_root.clone(),
            eligible_path: claim.proof.clone(),
            eligible_index: index.to_string(),
            leaf_value: claim.leaf_value.clone(),
            tree_depth: TREE_DEPTH,
        },
    })
}

fn uuid_to_onchain_campaign_id(campaign_id: Uuid) -> String {
    let compact_uuid = campaign_id.simple().to_string();
    format!("0x{:0>64}", compact_uuid)
}

fn normalize_recipients(
    recipients: &[RecipientInput],
) -> Result<Vec<NormalizedRecipient>, AppError> {
    let mut seen = HashSet::with_capacity(recipients.len());
    let mut normalized = Vec::with_capacity(recipients.len());

    for recipient in recipients {
        let leaf_address = normalize_address(&recipient.leaf_address)?;
        let amount = normalize_amount(&recipient.amount)?;

        if !seen.insert(leaf_address.clone()) {
            return Err(AppError::bad_request(format!(
                "duplicate leaf address found: {}",
                leaf_address
            )));
        }

        normalized.push(NormalizedRecipient {
            leaf_address,
            amount,
        });
    }

    Ok(normalized)
}

fn normalize_address(address: &str) -> Result<String, AppError> {
    let trimmed = address.trim();
    if trimmed.len() != 42 || !trimmed.starts_with("0x") {
        return Err(AppError::bad_request(format!(
            "invalid Ethereum address format: {}",
            trimmed
        )));
    }

    if !trimmed[2..]
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::bad_request(format!(
            "invalid Ethereum address hex: {}",
            trimmed
        )));
    }

    Ok(format!("0x{}", trimmed[2..].to_ascii_lowercase()))
}

fn normalize_amount(amount: &str) -> Result<String, AppError> {
    let trimmed = amount.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("amount must not be empty"));
    }

    if !trimmed.chars().all(|character| character.is_ascii_digit()) {
        return Err(AppError::bad_request(format!(
            "amount must be a base-10 integer string: {}",
            trimmed
        )));
    }

    let parsed = parse_big_uint(trimmed)?;
    Ok(parsed.to_str_radix(10))
}

fn address_to_field(address: &str) -> Result<FieldElement, AppError> {
    let address_bytes = decode_address_bytes(address)?;
    Ok(FieldElement::from_be_bytes_reduce(&address_bytes))
}

fn build_noir_merkle_artifacts(leaves: &[FieldElement]) -> Result<NoirMerkleArtifacts, AppError> {
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
                path.push(field_to_decimal_string(&levels[level][sibling_index]));
                index /= 2;
            }

            path
        })
        .collect();

    Ok(NoirMerkleArtifacts {
        leaf_values: leaves.iter().map(field_to_decimal_string).collect(),
        proofs,
        root: field_to_decimal_string(&levels[TREE_DEPTH][0]),
    })
}

fn poseidon2_hash_pair(
    left: &FieldElement,
    right: &FieldElement,
) -> Result<FieldElement, AppError> {
    let two_pow_64 = FieldElement::from(18_446_744_073_709_551_616u128);
    let iv = FieldElement::from(2u128) * two_pow_64;
    let state = [*left, *right, FieldElement::zero(), iv];
    let output = poseidon2_permutation(&state, 4).map_err(|error| {
        AppError::internal(format!(
            "failed to compute Noir-compatible Poseidon2 permutation: {error}"
        ))
    })?;

    Ok(output[0])
}

fn field_to_decimal_string(field: &FieldElement) -> String {
    BigUint::from_bytes_be(&field.to_be_bytes()).to_str_radix(10)
}

fn recipients_len(claims: &[PreparedClaim]) -> usize {
    claims.len()
}

fn decode_address_bytes(address: &str) -> Result<[u8; 20], AppError> {
    let decoded = hex::decode(&address[2..])
        .map_err(|_| AppError::bad_request(format!("invalid Ethereum address hex: {}", address)))?;

    <[u8; 20]>::try_from(decoded.as_slice()).map_err(|_| {
        AppError::bad_request(format!(
            "Ethereum address must decode to 20 bytes: {}",
            address
        ))
    })
}

fn parse_big_uint(value: &str) -> Result<BigUint, AppError> {
    BigUint::parse_bytes(value.as_bytes(), 10)
        .ok_or_else(|| AppError::bad_request(format!("failed to parse integer amount: {}", value)))
}

fn parse_campaign_id(campaign_id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(campaign_id)
        .map_err(|_| AppError::bad_request(format!("invalid campaign id: {}", campaign_id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn sample_request() -> CreateCampaignRequest {
        CreateCampaignRequest {
            name: "summer airdrop".to_string(),
            campaign_creator_address: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa".to_string(),
            recipients: vec![
                RecipientInput {
                    leaf_address: "0x0000000000000000000000000000000000000001".to_string(),
                    amount: "100".to_string(),
                },
                RecipientInput {
                    leaf_address: "0x0000000000000000000000000000000000000002".to_string(),
                    amount: "250".to_string(),
                },
                RecipientInput {
                    leaf_address: "0x0000000000000000000000000000000000000003".to_string(),
                    amount: "500".to_string(),
                },
            ],
        }
    }

    fn creator_consistency_address() -> &'static str {
        "0x308056ef9E0e21CD3e15414F59a17e9d4C510638"
    }

    fn recipient_consistency_addresses() -> Vec<String> {
        let mut addresses = vec![creator_consistency_address().to_string()];

        for value in 1..=10u8 {
            addresses.push(format!("0x{:040x}", value));
        }

        addresses
    }

    fn named_campaign_request(name: &str) -> CreateCampaignRequest {
        let recipients = recipient_consistency_addresses()
            .into_iter()
            .enumerate()
            .map(|(index, leaf_address)| RecipientInput {
                leaf_address,
                amount: ((index + 1) * 100).to_string(),
            })
            .collect();

        CreateCampaignRequest {
            name: name.to_string(),
            campaign_creator_address: creator_consistency_address().to_string(),
            recipients,
        }
    }

    #[test]
    fn prepares_a_campaign_with_precomputed_claims() {
        let prepared = prepare_campaign(sample_request()).expect("campaign should prepare");

        assert_eq!(prepared.summary.name, "summer airdrop");
        assert_eq!(prepared.summary.leaf_count, 3);
        assert_eq!(prepared.summary.depth, TREE_DEPTH);
        assert_eq!(prepared.summary.hash_algorithm, HASH_ALGORITHM);
        assert_eq!(prepared.summary.leaf_encoding, LEAF_ENCODING);
        assert_eq!(prepared.claims.len(), 3);
        assert_eq!(prepared.claims[1].amount, "250");
        assert_eq!(prepared.claims[0].leaf_value, "1");
        assert_eq!(prepared.claims[1].leaf_value, "2");
        assert_eq!(prepared.claims[2].leaf_value, "3");
        assert_eq!(prepared.claims[1].proof.len(), TREE_DEPTH);
        assert!(!prepared.summary.merkle_root.is_empty());
    }

    #[test]
    fn normalizes_amounts_before_hashing() {
        let request = CreateCampaignRequest {
            name: "summer airdrop".to_string(),
            campaign_creator_address: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa".to_string(),
            recipients: vec![RecipientInput {
                leaf_address: "0x0000000000000000000000000000000000000001".to_string(),
                amount: "00042".to_string(),
            }],
        };

        let prepared = prepare_campaign(request).expect("campaign should prepare");
        assert_eq!(prepared.claims[0].amount, "42");
        assert_eq!(prepared.claims[0].leaf_value, "1");
    }

    #[test]
    fn rejects_duplicate_leaf_addresses() {
        let request = CreateCampaignRequest {
            name: "summer airdrop".to_string(),
            campaign_creator_address: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa".to_string(),
            recipients: vec![
                RecipientInput {
                    leaf_address: "0xabcdef0000000000000000000000000000001234".to_string(),
                    amount: "1".to_string(),
                },
                RecipientInput {
                    leaf_address: "0xABCDEF0000000000000000000000000000001234".to_string(),
                    amount: "2".to_string(),
                },
            ],
        };

        let error = prepare_campaign(request).expect_err("duplicate addresses should fail");
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn noir_pair_hash_matches_the_noir_poseidon_package_output() {
        let left = FieldElement::from(1u128);
        let right = FieldElement::from(2u128);
        let hash = poseidon2_hash_pair(&left, &right).expect("pair hash should succeed");

        assert_eq!(
            field_to_decimal_string(&hash),
            "1594597865669602199208529098208508950092942746041644072252494753744672355203"
        );
    }

    #[test]
    fn named_reward_campaigns_stay_consistent_with_solidity_inputs() {
        let names = ["crecimiento_rewards", "avalance_rewards", "latam_rewards"];
        let expected_creator = "0x308056ef9e0e21cd3e15414f59a17e9d4c510638";
        let expected_first_recipient = expected_creator;

        let prepared_campaigns = names
            .into_iter()
            .map(|name| {
                prepare_campaign(named_campaign_request(name))
                    .unwrap_or_else(|error| panic!("campaign {name} should prepare: {error}"))
            })
            .collect::<Vec<_>>();

        assert_eq!(prepared_campaigns.len(), 3);
        assert_eq!(
            prepared_campaigns[0].summary.merkle_root,
            prepared_campaigns[1].summary.merkle_root
        );
        assert_eq!(
            prepared_campaigns[1].summary.merkle_root,
            prepared_campaigns[2].summary.merkle_root
        );

        let unique_campaign_ids = prepared_campaigns
            .iter()
            .map(|prepared| prepared.summary.onchain_campaign_id.clone())
            .collect::<HashSet<_>>();
        assert_eq!(unique_campaign_ids.len(), prepared_campaigns.len());

        for (index, prepared) in prepared_campaigns.iter().enumerate() {
            assert_eq!(prepared.summary.name, names[index]);
            assert_eq!(prepared.summary.campaign_creator_address, expected_creator);
            assert_eq!(prepared.summary.leaf_count, 11);
            assert_eq!(prepared.summary.depth, TREE_DEPTH);
            assert_eq!(prepared.summary.hash_algorithm, HASH_ALGORITHM);
            assert_eq!(prepared.summary.leaf_encoding, LEAF_ENCODING);
            assert_eq!(prepared.claims.len(), 11);
            assert_eq!(prepared.claims[0].leaf_address, expected_first_recipient);
            assert_eq!(prepared.claims[0].amount, "100");
            assert_eq!(
                prepared.claims[10].leaf_address,
                "0x000000000000000000000000000000000000000a"
            );
            assert_eq!(prepared.claims[10].amount, "1100");
            assert_eq!(prepared.claims[0].proof.len(), TREE_DEPTH);
            assert!(
                prepared
                    .summary
                    .merkle_root
                    .chars()
                    .all(|character| character.is_ascii_digit())
            );
            assert_eq!(prepared.summary.onchain_campaign_id.len(), 66);
            assert!(prepared.summary.onchain_campaign_id.starts_with("0x"));
        }
    }
}
