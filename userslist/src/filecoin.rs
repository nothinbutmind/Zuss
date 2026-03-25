use crate::{
    error::AppError,
    types::{
        CampaignSummary, PreparedClaim, PublishedCampaign, PublishedCampaignPayload,
        PublishedRecipient,
    },
};
use ethers_core::{
    abi::{ParamType, Token, decode, encode},
    types::{
        Address, Bytes, NameOrAddress, Signature, TransactionRequest, U64, U256,
        transaction::eip2718::TypedTransaction,
    },
    utils::keccak256,
};
use ethers_signers::{LocalWallet, Signer};
use serde_json::{Value, json};
use std::{env, str::FromStr};

const DEFAULT_RPC_URL: &str = "https://rpc.ankr.com/filecoin_testnet";
const DEFAULT_EXPLORER_TX_URL: &str = "https://calibration.filfox.info/en/message";
const MAX_CALLDATA_BYTES: usize = 24 * 1024;
const CREATE_CAMPAIGN_SIGNATURE: &str =
    "createCampaign(string,address,string,uint256,string,string,address[],uint256[],string)";
const PAYLOAD_EVENT_SIGNATURE: &str = "CampaignPayloadPosted(bytes32,string)";

#[derive(Debug, Clone)]
pub struct FilecoinClient {
    rpc_url: String,
    private_key: Option<String>,
    registry_address: Option<Address>,
    explorer_tx_url: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone)]
pub struct FilecoinUpload {
    pub tx_hash: String,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct RegisteredCampaign {
    pub summary: CampaignSummary,
    pub payload: PublishedCampaignPayload,
}

#[derive(Debug, Clone)]
pub struct RegisteredClaim {
    pub amount: String,
    pub index: usize,
}

#[derive(Debug, Clone)]
struct RegistryCampaignMeta {
    onchain_campaign_id: String,
    creator: Address,
    merkle_root: String,
    leaf_count: usize,
    depth: usize,
    hash_algorithm: String,
    leaf_encoding: String,
}

#[derive(Debug)]
struct PayloadLog {
    tx_hash: String,
    payload: PublishedCampaignPayload,
}

impl FilecoinClient {
    pub fn from_env() -> Option<Self> {
        let private_key = env::var("PRIVATE_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let registry_address = env::var("FILECOIN_REGISTRY_ADDRESS")
            .ok()
            .or_else(|| env::var("ZUS_PROTOCOL_REGISTRY_ADDRESS").ok())
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| Address::from_str(&value).ok());
        let rpc_url = env::var("FILECOIN_RPC_URL")
            .ok()
            .or_else(|| env::var("ETH_RPC_URL").ok())
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                if private_key.is_some() || registry_address.is_some() {
                    Some(DEFAULT_RPC_URL.to_string())
                } else {
                    None
                }
            });
        let should_enable =
            private_key.is_some() || registry_address.is_some() || rpc_url.is_some();
        if !should_enable {
            return None;
        }

        let http = reqwest::Client::builder().build().ok()?;

        Some(Self {
            rpc_url: rpc_url.unwrap_or_else(|| DEFAULT_RPC_URL.to_string()),
            private_key,
            registry_address,
            explorer_tx_url: env::var("FILECOIN_EXPLORER_TX_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_EXPLORER_TX_URL.to_string()),
            http,
        })
    }

    pub async fn upload_campaign(
        &self,
        summary: &CampaignSummary,
        claims: &[PreparedClaim],
    ) -> Result<FilecoinUpload, AppError> {
        let wallet = self.require_wallet()?;
        let registry_address = self.require_registry_address()?;
        let creator = parse_runtime_address(
            &summary.campaign_creator_address,
            "campaign_creator_address",
        )?;
        let from = wallet.address();
        if from != creator {
            return Err(AppError::bad_request(format!(
                "campaign_creator_address {} must match the PRIVATE_KEY address {} when registering in Zus protocol",
                summary.campaign_creator_address,
                format_address(from)
            )));
        }

        let payload = build_published_payload(summary, claims);
        let payload_json = serde_json::to_string(&payload).map_err(|error| {
            AppError::internal(format!(
                "failed to serialize campaign payload for Filecoin: {error}"
            ))
        })?;
        let data = encode_registry_create_campaign(summary, claims, &payload_json, creator)?;
        if data.len() > MAX_CALLDATA_BYTES {
            return Err(AppError::bad_request(format!(
                "campaign transaction calldata is {} bytes, which is too large for direct Filecoin testnet posting; keep it under {} bytes",
                data.len(),
                MAX_CALLDATA_BYTES
            )));
        }

        let tx_hash = self
            .send_transaction(&wallet, from, registry_address, data)
            .await?;
        Ok(FilecoinUpload {
            url: self.explorer_url(&tx_hash),
            tx_hash,
        })
    }

    pub async fn fetch_registered_campaign(
        &self,
        onchain_campaign_id: &str,
    ) -> Result<RegisteredCampaign, AppError> {
        let campaign_key = campaign_key_for_id(onchain_campaign_id);
        let meta = self
            .fetch_registry_campaign_meta_by_key(campaign_key)
            .await?;
        let payload_log = self.fetch_payload_log(campaign_key).await?;
        validate_registry_payload(&meta, &payload_log.payload)?;

        Ok(RegisteredCampaign {
            summary: CampaignSummary {
                campaign_id: payload_log.payload.campaign.campaign_id.clone(),
                onchain_campaign_id: meta.onchain_campaign_id.clone(),
                name: payload_log.payload.campaign.name.clone(),
                campaign_creator_address: format_address(meta.creator),
                merkle_root: meta.merkle_root.clone(),
                leaf_count: meta.leaf_count,
                depth: meta.depth,
                hash_algorithm: meta.hash_algorithm.clone(),
                leaf_encoding: meta.leaf_encoding.clone(),
                filecoin_cid: None,
                filecoin_url: Some(self.explorer_url(&payload_log.tx_hash)),
                filecoin_tx_hash: Some(payload_log.tx_hash),
            },
            payload: payload_log.payload,
        })
    }

    pub async fn fetch_registered_claim(
        &self,
        onchain_campaign_id: &str,
        leaf_address: &str,
    ) -> Result<RegisteredClaim, AppError> {
        let registry_address = self.require_registry_address()?;
        let campaign_key = campaign_key_for_id(onchain_campaign_id);
        let recipient = parse_runtime_address(leaf_address, "leaf address")?;
        let call = encode_contract_call(
            "getClaim(bytes32,address)",
            vec![
                Token::FixedBytes(campaign_key.to_vec()),
                Token::Address(recipient),
            ],
        );
        let bytes = self.eth_call(registry_address, call).await?;
        let decoded = decode(
            &[ParamType::Tuple(vec![
                ParamType::Uint(256),
                ParamType::Uint(256),
                ParamType::Bool,
            ])],
            bytes.as_ref(),
        )
        .map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignRegistry.getClaim response: {error}"
            ))
        })?;
        let tuple = decoded.into_iter().next().ok_or_else(|| {
            AppError::internal("CampaignRegistry.getClaim returned an empty response")
        })?;
        let Token::Tuple(values) = tuple else {
            return Err(AppError::internal(
                "CampaignRegistry.getClaim returned an unexpected response shape",
            ));
        };

        Ok(RegisteredClaim {
            amount: expect_uint(&values[0], "claim amount")?.to_string(),
            index: usize::try_from(expect_uint(&values[1], "claim index")?.as_u64())
                .map_err(|_| AppError::internal("claim index does not fit into usize"))?,
        })
    }

    pub async fn list_registered_campaigns(&self) -> Result<Vec<CampaignSummary>, AppError> {
        let registry_address = self.require_registry_address()?;
        let call = encode_contract_call("getAllCampaignKeys()", vec![]);
        let bytes = self.eth_call(registry_address, call).await?;
        let decoded = decode(
            &[ParamType::Array(Box::new(ParamType::FixedBytes(32)))],
            bytes.as_ref(),
        )
        .map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignRegistry.getAllCampaignKeys response: {error}"
            ))
        })?;
        let Token::Array(keys) = decoded.into_iter().next().ok_or_else(|| {
            AppError::internal("CampaignRegistry.getAllCampaignKeys returned an empty response")
        })?
        else {
            return Err(AppError::internal(
                "CampaignRegistry.getAllCampaignKeys returned an unexpected response shape",
            ));
        };

        let mut summaries = Vec::with_capacity(keys.len());
        for key in keys.into_iter().rev() {
            let campaign_key = expect_fixed_bytes_32(&key, "campaign key")?;
            let meta = self
                .fetch_registry_campaign_meta_by_key(campaign_key)
                .await?;
            let payload_log = self.fetch_payload_log(campaign_key).await?;
            validate_registry_payload(&meta, &payload_log.payload)?;
            summaries.push(CampaignSummary {
                campaign_id: payload_log.payload.campaign.campaign_id.clone(),
                onchain_campaign_id: meta.onchain_campaign_id.clone(),
                name: payload_log.payload.campaign.name.clone(),
                campaign_creator_address: format_address(meta.creator),
                merkle_root: meta.merkle_root.clone(),
                leaf_count: meta.leaf_count,
                depth: meta.depth,
                hash_algorithm: meta.hash_algorithm.clone(),
                leaf_encoding: meta.leaf_encoding.clone(),
                filecoin_cid: None,
                filecoin_url: Some(self.explorer_url(&payload_log.tx_hash)),
                filecoin_tx_hash: Some(payload_log.tx_hash),
            });
        }

        Ok(summaries)
    }

    pub async fn list_registered_creator_campaigns(
        &self,
        creator: &str,
    ) -> Result<Vec<CampaignSummary>, AppError> {
        let registry_address = self.require_registry_address()?;
        let creator = parse_runtime_address(creator, "campaign creator address")?;
        let call = encode_contract_call(
            "getCreatorCampaignKeys(address)",
            vec![Token::Address(creator)],
        );
        let bytes = self.eth_call(registry_address, call).await?;
        let decoded = decode(
            &[ParamType::Array(Box::new(ParamType::FixedBytes(32)))],
            bytes.as_ref(),
        )
        .map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignRegistry.getCreatorCampaignKeys response: {error}"
            ))
        })?;
        let Token::Array(keys) = decoded.into_iter().next().ok_or_else(|| {
            AppError::internal("CampaignRegistry.getCreatorCampaignKeys returned an empty response")
        })?
        else {
            return Err(AppError::internal(
                "CampaignRegistry.getCreatorCampaignKeys returned an unexpected response shape",
            ));
        };

        let mut summaries = Vec::with_capacity(keys.len());
        for key in keys.into_iter().rev() {
            let campaign_key = expect_fixed_bytes_32(&key, "campaign key")?;
            let meta = self
                .fetch_registry_campaign_meta_by_key(campaign_key)
                .await?;
            let payload_log = self.fetch_payload_log(campaign_key).await?;
            validate_registry_payload(&meta, &payload_log.payload)?;
            summaries.push(CampaignSummary {
                campaign_id: payload_log.payload.campaign.campaign_id.clone(),
                onchain_campaign_id: meta.onchain_campaign_id.clone(),
                name: payload_log.payload.campaign.name.clone(),
                campaign_creator_address: format_address(meta.creator),
                merkle_root: meta.merkle_root.clone(),
                leaf_count: meta.leaf_count,
                depth: meta.depth,
                hash_algorithm: meta.hash_algorithm.clone(),
                leaf_encoding: meta.leaf_encoding.clone(),
                filecoin_cid: None,
                filecoin_url: Some(self.explorer_url(&payload_log.tx_hash)),
                filecoin_tx_hash: Some(payload_log.tx_hash),
            });
        }

        Ok(summaries)
    }

    pub async fn fetch_published_campaign(
        &self,
        tx_hash: &str,
    ) -> Result<PublishedCampaignPayload, AppError> {
        if !looks_like_tx_hash(tx_hash) {
            return Err(AppError::bad_request(format!(
                "invalid Filecoin transaction hash: {tx_hash}"
            )));
        }

        let result = self
            .rpc("eth_getTransactionByHash", json!([tx_hash]))
            .await?;
        if result.is_null() {
            return Err(AppError::not_found(format!(
                "Filecoin transaction not found: {tx_hash}"
            )));
        }

        let input = result
            .get("input")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty() && *value != "0x")
            .ok_or_else(|| {
                AppError::not_found(format!(
                    "Filecoin transaction {tx_hash} does not include campaign calldata"
                ))
            })?;

        decode_payload_from_transaction_input(input, tx_hash)
    }

    fn require_wallet(&self) -> Result<LocalWallet, AppError> {
        let private_key = self.private_key.as_ref().ok_or_else(|| {
            AppError::bad_request("PRIVATE_KEY must be set to post campaigns on Filecoin testnet")
        })?;
        LocalWallet::from_str(private_key).map_err(|error| {
            AppError::bad_request(format!("failed to parse PRIVATE_KEY for Filecoin: {error}"))
        })
    }

    fn require_registry_address(&self) -> Result<Address, AppError> {
        self.registry_address.ok_or_else(|| {
            AppError::bad_request(
                "FILECOIN_REGISTRY_ADDRESS must be set to register or query campaigns in Zus protocol",
            )
        })
    }

    async fn send_transaction(
        &self,
        wallet: &LocalWallet,
        from: Address,
        to: Address,
        data: Bytes,
    ) -> Result<String, AppError> {
        let chain_id = self.fetch_chain_id().await?;
        let nonce = self.fetch_nonce(from).await?;
        let gas_price = self.fetch_gas_price().await?;
        let gas = self.estimate_gas(from, to, &data).await?;

        let tx: TypedTransaction = TransactionRequest::new()
            .from(from)
            .to(NameOrAddress::Address(to))
            .value(U256::zero())
            .data(data)
            .gas(gas)
            .gas_price(gas_price)
            .nonce(nonce)
            .chain_id(chain_id)
            .into();
        let signature = wallet
            .clone()
            .with_chain_id(chain_id.as_u64())
            .sign_transaction(&tx)
            .await
            .map_err(|error| {
                AppError::internal(format!("failed to sign Filecoin transaction: {error}"))
            })?;
        let raw = encode_signed_transaction(&tx, &signature);
        self.send_raw_transaction(raw).await
    }

    async fn fetch_registry_campaign_meta_by_key(
        &self,
        campaign_key: [u8; 32],
    ) -> Result<RegistryCampaignMeta, AppError> {
        let registry_address = self.require_registry_address()?;
        let call = encode_contract_call(
            "getCampaign(bytes32)",
            vec![Token::FixedBytes(campaign_key.to_vec())],
        );
        let bytes = self.eth_call(registry_address, call).await?;
        let decoded = decode(
            &[ParamType::Tuple(vec![
                ParamType::String,
                ParamType::Address,
                ParamType::String,
                ParamType::Uint(256),
                ParamType::Uint(256),
                ParamType::String,
                ParamType::String,
                ParamType::Bool,
            ])],
            bytes.as_ref(),
        )
        .map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignRegistry.getCampaign response: {error}"
            ))
        })?;
        let tuple = decoded.into_iter().next().ok_or_else(|| {
            AppError::internal("CampaignRegistry.getCampaign returned an empty response")
        })?;
        let Token::Tuple(values) = tuple else {
            return Err(AppError::internal(
                "CampaignRegistry.getCampaign returned an unexpected response shape",
            ));
        };

        Ok(RegistryCampaignMeta {
            onchain_campaign_id: expect_string(&values[0], "campaign id")?,
            creator: expect_address(&values[1], "creator")?,
            merkle_root: expect_string(&values[2], "merkle root")?,
            leaf_count: usize::try_from(expect_uint(&values[3], "leaf count")?.as_u64())
                .map_err(|_| AppError::internal("leaf count does not fit into usize"))?,
            depth: usize::try_from(expect_uint(&values[4], "tree depth")?.as_u64())
                .map_err(|_| AppError::internal("tree depth does not fit into usize"))?,
            hash_algorithm: expect_string(&values[5], "hash algorithm")?,
            leaf_encoding: expect_string(&values[6], "leaf encoding")?,
        })
    }

    async fn fetch_payload_log(&self, campaign_key: [u8; 32]) -> Result<PayloadLog, AppError> {
        let registry_address = self.require_registry_address()?;
        let topic0 = format!(
            "0x{}",
            hex::encode(keccak256(PAYLOAD_EVENT_SIGNATURE.as_bytes()))
        );
        let topic1 = format!("0x{}", hex::encode(campaign_key));
        let result = self
            .rpc(
                "eth_getLogs",
                json!([{
                    "address": format!("{:#x}", registry_address),
                    "fromBlock": "0x0",
                    "toBlock": "latest",
                    "topics": [topic0, topic1]
                }]),
            )
            .await?;
        let logs = result.as_array().ok_or_else(|| {
            AppError::internal("eth_getLogs did not return an array for CampaignPayloadPosted")
        })?;
        let log = logs.last().ok_or_else(|| {
            AppError::not_found(format!(
                "no CampaignPayloadPosted event found for campaign key 0x{}",
                hex::encode(campaign_key)
            ))
        })?;
        let data = log
            .get("data")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                AppError::internal("CampaignPayloadPosted log did not include data".to_string())
            })?;
        let tx_hash = log
            .get("transactionHash")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                AppError::internal(
                    "CampaignPayloadPosted log did not include a transaction hash".to_string(),
                )
            })?;
        let bytes = hex::decode(data.trim_start_matches("0x")).map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignPayloadPosted log data: {error}"
            ))
        })?;
        let decoded = decode(&[ParamType::String], &bytes).map_err(|error| {
            AppError::internal(format!(
                "failed to decode CampaignPayloadPosted log payload: {error}"
            ))
        })?;
        let payload_json = match decoded.into_iter().next() {
            Some(Token::String(value)) => value,
            _ => {
                return Err(AppError::internal(
                    "CampaignPayloadPosted log returned an unexpected payload shape",
                ));
            }
        };
        let payload =
            serde_json::from_str::<PublishedCampaignPayload>(&payload_json).map_err(|error| {
                AppError::internal(format!(
                    "failed to decode CampaignPayloadPosted JSON payload: {error}"
                ))
            })?;

        Ok(PayloadLog {
            tx_hash: tx_hash.to_string(),
            payload,
        })
    }

    fn explorer_url(&self, tx_hash: &str) -> String {
        format!("{}/{}", self.explorer_tx_url.trim_end_matches('/'), tx_hash)
    }

    async fn fetch_chain_id(&self) -> Result<U64, AppError> {
        let value = self.rpc("eth_chainId", json!([])).await?;
        let chain_id = parse_hex_u256(&value, "eth_chainId")?;
        Ok(U64::from(chain_id.as_u64()))
    }

    async fn fetch_nonce(&self, from: Address) -> Result<U256, AppError> {
        let value = self
            .rpc(
                "eth_getTransactionCount",
                json!([format!("{:#x}", from), "pending"]),
            )
            .await?;
        parse_hex_u256(&value, "eth_getTransactionCount")
    }

    async fn fetch_gas_price(&self) -> Result<U256, AppError> {
        let value = self.rpc("eth_gasPrice", json!([])).await?;
        parse_hex_u256(&value, "eth_gasPrice")
    }

    async fn estimate_gas(
        &self,
        from: Address,
        to: Address,
        data: &Bytes,
    ) -> Result<U256, AppError> {
        let value = self
            .rpc(
                "eth_estimateGas",
                json!([{
                    "from": format!("{:#x}", from),
                    "to": format!("{:#x}", to),
                    "value": "0x0",
                    "data": format!("0x{}", hex::encode(data)),
                }]),
            )
            .await?;
        parse_hex_u256(&value, "eth_estimateGas")
    }

    async fn send_raw_transaction(&self, raw: Bytes) -> Result<String, AppError> {
        let value = self
            .rpc(
                "eth_sendRawTransaction",
                json!([format!("0x{}", hex::encode(raw))]),
            )
            .await?;

        let tx_hash = value.as_str().ok_or_else(|| {
            AppError::internal(
                "eth_sendRawTransaction did not return a transaction hash string".to_string(),
            )
        })?;

        if !looks_like_tx_hash(tx_hash) {
            return Err(AppError::internal(format!(
                "eth_sendRawTransaction returned an unexpected transaction hash: {tx_hash}"
            )));
        }

        Ok(tx_hash.to_string())
    }

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, AppError> {
        let value = self
            .rpc(
                "eth_call",
                json!([{
                    "to": format!("{:#x}", to),
                    "data": format!("0x{}", hex::encode(data)),
                }, "latest"]),
            )
            .await?;
        let data = value.as_str().ok_or_else(|| {
            AppError::internal("eth_call did not return a hex data string".to_string())
        })?;
        let bytes = hex::decode(data.trim_start_matches("0x")).map_err(|error| {
            AppError::internal(format!("eth_call returned invalid hex data: {error}"))
        })?;
        Ok(Bytes::from(bytes))
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, AppError> {
        let response = self
            .http
            .post(&self.rpc_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }))
            .send()
            .await
            .map_err(|error| {
                AppError::internal(format!("Filecoin RPC `{method}` failed: {error}"))
            })?;

        let status = response.status();
        let value: Value = response.json().await.map_err(|error| {
            AppError::internal(format!(
                "Filecoin RPC `{method}` returned invalid JSON: {error}"
            ))
        })?;

        if !status.is_success() {
            return Err(AppError::internal(format!(
                "Filecoin RPC `{method}` returned HTTP {}: {}",
                status, value
            )));
        }

        if let Some(error) = value.get("error") {
            return Err(AppError::internal(format!(
                "Filecoin RPC `{method}` returned an error: {error}"
            )));
        }

        value.get("result").cloned().ok_or_else(|| {
            AppError::internal(format!(
                "Filecoin RPC `{method}` did not include a result field"
            ))
        })
    }
}

fn encode_signed_transaction(tx: &TypedTransaction, signature: &Signature) -> Bytes {
    tx.rlp_signed(signature)
}

fn encode_registry_create_campaign(
    summary: &CampaignSummary,
    claims: &[PreparedClaim],
    payload_json: &str,
    creator: Address,
) -> Result<Bytes, AppError> {
    let mut recipients = Vec::with_capacity(claims.len());
    let mut amounts = Vec::with_capacity(claims.len());

    for claim in claims {
        recipients.push(Token::Address(parse_runtime_address(
            &claim.leaf_address,
            "leaf address",
        )?));
        amounts.push(Token::Uint(U256::from_dec_str(&claim.amount).map_err(
            |error| {
                AppError::bad_request(format!(
                    "failed to parse claim amount `{}` for Filecoin registration: {error}",
                    claim.amount
                ))
            },
        )?));
    }

    Ok(encode_contract_call(
        CREATE_CAMPAIGN_SIGNATURE,
        vec![
            Token::String(summary.onchain_campaign_id.clone()),
            Token::Address(creator),
            Token::String(summary.merkle_root.clone()),
            Token::Uint(U256::from(summary.depth)),
            Token::String(summary.hash_algorithm.clone()),
            Token::String(summary.leaf_encoding.clone()),
            Token::Array(recipients),
            Token::Array(amounts),
            Token::String(payload_json.to_string()),
        ],
    ))
}

fn decode_payload_from_transaction_input(
    input_hex: &str,
    tx_hash: &str,
) -> Result<PublishedCampaignPayload, AppError> {
    let bytes = hex::decode(input_hex.trim_start_matches("0x")).map_err(|error| {
        AppError::internal(format!(
            "failed to decode Filecoin transaction calldata for {tx_hash}: {error}"
        ))
    })?;
    if bytes.len() < 4 {
        return Err(AppError::not_found(format!(
            "Filecoin transaction {tx_hash} does not contain enough calldata to decode a campaign"
        )));
    }

    let selector = &bytes[..4];
    let expected = &keccak256(CREATE_CAMPAIGN_SIGNATURE.as_bytes())[..4];
    if selector != expected {
        return Err(AppError::not_found(format!(
            "Filecoin transaction {tx_hash} is not a CampaignRegistry.createCampaign call"
        )));
    }

    let decoded = decode(
        &[
            ParamType::String,
            ParamType::Address,
            ParamType::String,
            ParamType::Uint(256),
            ParamType::String,
            ParamType::String,
            ParamType::Array(Box::new(ParamType::Address)),
            ParamType::Array(Box::new(ParamType::Uint(256))),
            ParamType::String,
        ],
        &bytes[4..],
    )
    .map_err(|error| {
        AppError::internal(format!(
            "failed to decode CampaignRegistry.createCampaign calldata for {tx_hash}: {error}"
        ))
    })?;

    let payload_json = match decoded.last() {
        Some(Token::String(value)) => value.clone(),
        _ => {
            return Err(AppError::internal(format!(
                "CampaignRegistry.createCampaign calldata for {tx_hash} did not contain a payload string"
            )));
        }
    };

    serde_json::from_str::<PublishedCampaignPayload>(&payload_json).map_err(|error| {
        AppError::internal(format!(
            "failed to decode Filecoin campaign payload JSON from {tx_hash}: {error}"
        ))
    })
}

fn validate_registry_payload(
    meta: &RegistryCampaignMeta,
    payload: &PublishedCampaignPayload,
) -> Result<(), AppError> {
    if payload.campaign.onchain_campaign_id != meta.onchain_campaign_id {
        return Err(AppError::internal(format!(
            "Filecoin payload onchain campaign id {} does not match the Zus protocol record {}",
            payload.campaign.onchain_campaign_id, meta.onchain_campaign_id
        )));
    }
    if payload.campaign.merkle_root != meta.merkle_root {
        return Err(AppError::internal(format!(
            "Filecoin payload root {} does not match the Zus protocol root {}",
            payload.campaign.merkle_root, meta.merkle_root
        )));
    }
    if format_address(meta.creator) != payload.campaign.campaign_creator_address {
        return Err(AppError::internal(format!(
            "Filecoin payload creator {} does not match the Zus protocol creator {}",
            payload.campaign.campaign_creator_address,
            format_address(meta.creator)
        )));
    }
    if payload.recipients.len() != meta.leaf_count {
        return Err(AppError::internal(format!(
            "Filecoin payload recipient count {} does not match the Zus protocol count {}",
            payload.recipients.len(),
            meta.leaf_count
        )));
    }
    Ok(())
}

fn build_published_payload(
    summary: &CampaignSummary,
    claims: &[PreparedClaim],
) -> PublishedCampaignPayload {
    PublishedCampaignPayload {
        version: 1,
        campaign: PublishedCampaign {
            campaign_id: summary.campaign_id.clone(),
            onchain_campaign_id: summary.onchain_campaign_id.clone(),
            name: summary.name.clone(),
            campaign_creator_address: summary.campaign_creator_address.clone(),
            merkle_root: summary.merkle_root.clone(),
        },
        recipients: claims
            .iter()
            .map(|claim| PublishedRecipient {
                leaf_address: claim.leaf_address.clone(),
                amount: claim.amount.clone(),
            })
            .collect(),
    }
}

fn campaign_key_for_id(campaign_id: &str) -> [u8; 32] {
    keccak256(campaign_id.as_bytes())
}

fn encode_contract_call(signature: &str, tokens: Vec<Token>) -> Bytes {
    let mut encoded = keccak256(signature.as_bytes())[..4].to_vec();
    encoded.extend(encode(&tokens));
    Bytes::from(encoded)
}

fn parse_hex_u256(value: &Value, method: &str) -> Result<U256, AppError> {
    let hex_value = value.as_str().ok_or_else(|| {
        AppError::internal(format!(
            "Filecoin RPC `{method}` returned a non-string value: {value}"
        ))
    })?;

    U256::from_str_radix(hex_value.trim_start_matches("0x"), 16).map_err(|error| {
        AppError::internal(format!(
            "Filecoin RPC `{method}` returned an invalid hex quantity `{hex_value}`: {error}"
        ))
    })
}

fn parse_runtime_address(value: &str, label: &str) -> Result<Address, AppError> {
    Address::from_str(value).map_err(|error| {
        AppError::bad_request(format!("failed to parse {label} `{value}`: {error}"))
    })
}

fn format_address(address: Address) -> String {
    format!("{:#x}", address)
}

fn expect_string(token: &Token, label: &str) -> Result<String, AppError> {
    match token {
        Token::String(value) => Ok(value.clone()),
        _ => Err(AppError::internal(format!(
            "expected {label} to decode as a string"
        ))),
    }
}

fn expect_address(token: &Token, label: &str) -> Result<Address, AppError> {
    match token {
        Token::Address(value) => Ok(*value),
        _ => Err(AppError::internal(format!(
            "expected {label} to decode as an address"
        ))),
    }
}

fn expect_uint(token: &Token, label: &str) -> Result<U256, AppError> {
    match token {
        Token::Uint(value) => Ok(*value),
        _ => Err(AppError::internal(format!(
            "expected {label} to decode as a uint256"
        ))),
    }
}

fn expect_fixed_bytes_32(token: &Token, label: &str) -> Result<[u8; 32], AppError> {
    match token {
        Token::FixedBytes(value) if value.len() == 32 => {
            let mut bytes = [0u8; 32];
            bytes.copy_from_slice(value);
            Ok(bytes)
        }
        _ => Err(AppError::internal(format!(
            "expected {label} to decode as bytes32"
        ))),
    }
}

fn looks_like_tx_hash(value: &str) -> bool {
    value.starts_with("0x")
        && value.len() == 66
        && value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::{
        CREATE_CAMPAIGN_SIGNATURE, build_published_payload, campaign_key_for_id,
        decode_payload_from_transaction_input, encode_contract_call, looks_like_tx_hash,
        parse_hex_u256,
    };
    use crate::types::{CampaignSummary, PreparedClaim};
    use ethers_core::abi::Token;
    use ethers_core::types::{Address, U256};
    use serde_json::json;
    use std::str::FromStr;

    fn sample_summary() -> CampaignSummary {
        CampaignSummary {
            campaign_id: "campaign-1".to_string(),
            onchain_campaign_id:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            name: "summer airdrop".to_string(),
            campaign_creator_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            merkle_root: "123".to_string(),
            leaf_count: 1,
            depth: 12,
            hash_algorithm: "poseidon2_bn254".to_string(),
            leaf_encoding: "field(uint160(address))".to_string(),
            filecoin_cid: None,
            filecoin_url: None,
            filecoin_tx_hash: None,
        }
    }

    fn sample_claims() -> Vec<PreparedClaim> {
        vec![PreparedClaim {
            leaf_address: "0x0000000000000000000000000000000000000001".to_string(),
            amount: "100".to_string(),
            index: 0,
            leaf_value: "1".to_string(),
            proof: vec!["10".to_string(), "11".to_string()],
        }]
    }

    #[test]
    fn validates_transaction_hash_shape() {
        assert!(looks_like_tx_hash(
            "0x2222222222222222222222222222222222222222222222222222222222222222"
        ));
        assert!(!looks_like_tx_hash("0x1234"));
    }

    #[test]
    fn parses_hex_quantities() {
        let value = parse_hex_u256(&json!("0x2a"), "eth_chainId").expect("hex should parse");
        assert_eq!(value.as_u64(), 42);
    }

    #[test]
    fn published_payload_carries_both_ids_and_omits_claim_proofs() {
        let encoded = serde_json::to_string(&build_published_payload(
            &sample_summary(),
            &sample_claims(),
        ))
        .expect("payload should encode");

        assert!(encoded.contains("\"campaign_id\""));
        assert!(encoded.contains("\"onchain_campaign_id\""));
        assert!(encoded.contains("\"recipients\""));
        assert!(!encoded.contains("\"proof\""));
        assert!(!encoded.contains("\"leaf_value\""));
    }

    #[test]
    fn hashes_campaign_ids_for_registry_keys() {
        let key = campaign_key_for_id("0xabc");
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn decodes_payload_from_create_campaign_input() {
        let summary = sample_summary();
        let claims = sample_claims();
        let payload = serde_json::to_string(&build_published_payload(&summary, &claims))
            .expect("payload should encode");
        let creator = Address::from_str("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .expect("address should parse");
        let calldata = encode_contract_call(
            CREATE_CAMPAIGN_SIGNATURE,
            vec![
                Token::String(summary.onchain_campaign_id.clone()),
                Token::Address(creator),
                Token::String(summary.merkle_root.clone()),
                Token::Uint(U256::from(summary.depth)),
                Token::String(summary.hash_algorithm.clone()),
                Token::String(summary.leaf_encoding.clone()),
                Token::Array(vec![Token::Address(
                    Address::from_str("0x0000000000000000000000000000000000000001")
                        .expect("recipient should parse"),
                )]),
                Token::Array(vec![Token::Uint(U256::from(100u64))]),
                Token::String(payload),
            ],
        );

        let decoded = decode_payload_from_transaction_input(
            &format!("0x{}", hex::encode(calldata)),
            "0xtest",
        )
        .expect("payload should decode");

        assert_eq!(decoded.campaign.campaign_id, "campaign-1");
        assert_eq!(
            decoded.campaign.onchain_campaign_id,
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(decoded.recipients.len(), 1);
        assert_eq!(decoded.recipients[0].amount, "100");
    }
}
