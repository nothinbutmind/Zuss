use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct CreateCampaignRequest {
    pub name: String,
    pub campaign_creator_address: String,
    pub recipients: Vec<RecipientInput>,
}

#[derive(Debug, Deserialize)]
pub struct RecipientInput {
    pub leaf_address: String,
    pub amount: String,
}

#[derive(Debug, Deserialize)]
pub struct ClaimLookupRequest {
    pub leaf_address: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublishedCampaignPayload {
    pub version: u8,
    pub campaign: PublishedCampaign,
    pub recipients: Vec<PublishedRecipient>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublishedCampaign {
    pub campaign_id: String,
    pub onchain_campaign_id: String,
    pub name: String,
    pub campaign_creator_address: String,
    pub merkle_root: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublishedRecipient {
    pub leaf_address: String,
    pub amount: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CampaignSummary {
    pub campaign_id: String,
    pub onchain_campaign_id: String,
    pub name: String,
    pub campaign_creator_address: String,
    pub merkle_root: String,
    pub leaf_count: usize,
    pub depth: usize,
    pub hash_algorithm: String,
    pub leaf_encoding: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_cid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_tx_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreatorCampaignsResponse {
    pub campaign_creator_address: String,
    pub campaigns: Vec<CampaignSummary>,
}

#[derive(Debug, Serialize)]
pub struct NoirClaimInputs {
    pub eligible_root: String,
    pub eligible_path: Vec<String>,
    pub eligible_index: String,
    pub leaf_value: String,
    pub tree_depth: usize,
}

#[derive(Debug, Serialize)]
pub struct ClaimPayloadResponse {
    pub campaign_id: String,
    pub onchain_campaign_id: String,
    pub name: String,
    pub campaign_creator_address: String,
    pub leaf_address: String,
    pub amount: String,
    pub index: usize,
    pub leaf_value: String,
    pub proof: Vec<String>,
    pub merkle_root: String,
    pub hash_algorithm: String,
    pub leaf_encoding: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_cid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filecoin_tx_hash: Option<String>,
    pub noir_inputs: NoirClaimInputs,
}

#[derive(Debug, Serialize)]
pub struct FilecoinCampaignResponse {
    pub tx_hash: String,
    pub filecoin_url: String,
    pub payload: PublishedCampaignPayload,
    pub campaign: CampaignSummary,
    pub claims: Vec<PreparedClaim>,
}

#[derive(Debug, Clone)]
pub struct PreparedCampaign {
    pub campaign_id: Uuid,
    pub summary: CampaignSummary,
    pub claims: Vec<PreparedClaim>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PreparedClaim {
    pub leaf_address: String,
    pub amount: String,
    pub index: i32,
    pub leaf_value: String,
    pub proof: Vec<String>,
}
