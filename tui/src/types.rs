use std::{env, io::Stdout, path::PathBuf};

use ratatui::{Terminal, backend::CrosstermBackend};
use serde::Deserialize;

pub const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:3000";
pub const DEFAULT_ZUS_PROTOCOL_ADDRESS: &str = "";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Focus {
    Actions,
    Fields,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionKind {
    CampaignExplorer,
    FilecoinTxExplorer,
    FilecoinTxClaimLookup,
    GenerateZkWitness,
    RecoverStarknetStealth,
    ListAccounts,
    CheckAddress,
    CreateWallet,
    ImportWallet,
}

#[derive(Clone, Debug)]
pub struct FormField {
    pub key: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub value: String,
    pub sensitive: bool,
    pub required: bool,
}

#[derive(Clone, Debug)]
pub struct ActionForm {
    pub kind: ActionKind,
    pub label: &'static str,
    pub command_label: &'static str,
    pub description: &'static str,
    pub fields: Vec<FormField>,
}

pub struct App {
    pub forms: Vec<ActionForm>,
    pub selected_action: usize,
    pub selected_field: usize,
    pub focus: Focus,
    pub output: String,
    pub last_command: String,
    pub status: String,
}

pub struct CommandResult {
    pub command_preview: String,
    pub output: String,
    pub success: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiCampaignSummary {
    pub campaign_id: String,
    #[serde(default)]
    pub onchain_campaign_id: Option<String>,
    pub name: String,
    pub campaign_creator_address: String,
    pub merkle_root: String,
    pub leaf_count: usize,
    pub depth: usize,
    pub hash_algorithm: String,
    pub leaf_encoding: String,
    pub filecoin_url: Option<String>,
    pub filecoin_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiPreparedClaim {
    pub leaf_address: String,
    pub amount: String,
    pub index: i32,
    pub leaf_value: String,
    pub proof: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiPublishedCampaign {
    pub campaign_id: String,
    pub name: String,
    pub campaign_creator_address: String,
    pub merkle_root: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiPublishedRecipient {
    pub leaf_address: String,
    pub amount: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiPublishedCampaignPayload {
    pub version: u8,
    pub campaign: ApiPublishedCampaign,
    pub recipients: Vec<ApiPublishedRecipient>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiFilecoinCampaignResponse {
    pub tx_hash: String,
    pub filecoin_url: String,
    pub payload: ApiPublishedCampaignPayload,
    pub campaign: ApiCampaignSummary,
    pub claims: Vec<ApiPreparedClaim>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiNoirClaimInputs {
    pub eligible_root: String,
    pub eligible_path: Vec<String>,
    pub eligible_index: String,
    pub leaf_value: String,
    pub tree_depth: usize,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiClaimPayload {
    pub campaign_id: String,
    #[serde(default)]
    pub onchain_campaign_id: Option<String>,
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
    pub noir_inputs: ApiNoirClaimInputs,
}

pub type AppTerminal = Terminal<CrosstermBackend<Stdout>>;

impl App {
    pub fn new() -> Self {
        Self {
            forms: vec![
                ActionForm {
                    kind: ActionKind::CampaignExplorer,
                    label: "Campaign Explorer",
                    command_label: "GET /campaigns (+ optional claim lookup)",
                    description: "Show every campaign from the proof API. The wallet field accepts either a direct 0x address or a saved Foundry account name from the default keystore directory. Add the keystore password when using a saved wallet.",
                    fields: vec![
                        FormField {
                            key: "api_base_url",
                            label: "API Base URL",
                            hint: "http://127.0.0.1:3000",
                            value: default_api_base_url(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "wallet_address",
                            label: "Wallet / Account",
                            hint: "optional: 0x... or saved Foundry account",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                        FormField {
                            key: "password",
                            label: "Keystore Password",
                            hint: "required for saved account or keystore path",
                            value: String::new(),
                            sensitive: true,
                            required: false,
                        },
                        FormField {
                            key: "keystore_path",
                            label: "Keystore Path",
                            hint: "optional: explicit keystore file path",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::FilecoinTxExplorer,
                    label: "Filecoin Tx Explorer",
                    command_label: "GET /filecoin/tx/{tx_hash}",
                    description: "Load a campaign directly from a Filecoin transaction hash, decode the posted calldata, and reconstruct all recipients and merkle claims without a database.",
                    fields: vec![
                        FormField {
                            key: "api_base_url",
                            label: "API Base URL",
                            hint: "http://127.0.0.1:3000",
                            value: "http://127.0.0.1:3000".to_string(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "tx_hash",
                            label: "Tx Hash",
                            hint: "0x... Filecoin transaction hash",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::FilecoinTxClaimLookup,
                    label: "Filecoin Claim",
                    command_label: "GET /filecoin/tx/{tx_hash}/claim/{leaf_address}",
                    description: "Resolve a single leaf and Noir claim payload directly from the Filecoin transaction hash that stored the campaign.",
                    fields: vec![
                        FormField {
                            key: "api_base_url",
                            label: "API Base URL",
                            hint: "http://127.0.0.1:3000",
                            value: "http://127.0.0.1:3000".to_string(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "tx_hash",
                            label: "Tx Hash",
                            hint: "0x... Filecoin transaction hash",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "leaf_address",
                            label: "Leaf Address",
                            hint: "0x... recipient address",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::GenerateZkWitness,
                    label: "Prove + Claim",
                    command_label: "API claim + nargo + bb + cast send",
                    description: "Fill Campaign, Wallet Account, and Keystore Password. The TUI auto-fetches the API claim payload, uses the default Flow EVM testnet RPC plus your configured ZusProtocol address, generates the proof, and submits the claim.",
                    fields: vec![
                        FormField {
                            key: "campaign_selector",
                            label: "Campaign",
                            hint: "required: campaign name for this wallet",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "wallet_account",
                            label: "Wallet Account",
                            hint: "saved Foundry wallet name, e.g. testing",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "password",
                            label: "Keystore Password",
                            hint: "password for the saved wallet",
                            value: String::new(),
                            sensitive: true,
                            required: true,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::RecoverStarknetStealth,
                    label: "Recover Starknet Stealth",
                    command_label: "local stealth key recovery",
                    description: "Paste the local recovery note values from a Starknet claim to reconstruct the private stealth tweak, the stealth spend scalar, and the one-time stealth pubkey locally inside the TUI.",
                    fields: vec![
                        FormField {
                            key: "wallet_secret",
                            label: "Wallet Secret",
                            hint: "felt252 from local recovery note",
                            value: String::new(),
                            sensitive: true,
                            required: true,
                        },
                        FormField {
                            key: "claimant_address",
                            label: "Claimant Address",
                            hint: "0x... Starknet account address",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "message_domain",
                            label: "Message Domain",
                            hint: "felt252 campaign domain",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "eligible_root",
                            label: "Eligible Root",
                            hint: "felt252 merkle root",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "ephemeral_pubkey_x",
                            label: "Ephemeral Pubkey X",
                            hint: "felt252 x-coordinate",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "ephemeral_pubkey_y",
                            label: "Ephemeral Pubkey Y",
                            hint: "felt252 y-coordinate",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::ListAccounts,
                    label: "Saved Key Pairs",
                    command_label: "cast wallet list",
                    description: "List saved Foundry keystore accounts so you can choose one by name for Campaign Explorer or Check Address.",
                    fields: vec![FormField {
                        key: "keystore_dir",
                        label: "Keystore Dir",
                        hint: "~/.foundry/keystores",
                        value: String::new(),
                        sensitive: false,
                        required: false,
                    }],
                },
                ActionForm {
                    kind: ActionKind::CheckAddress,
                    label: "Check Address",
                    command_label: "cast wallet address",
                    description: "Derive the public wallet address from either a raw private key, a saved account name, or a keystore file. Add the keystore password when using a saved wallet.",
                    fields: vec![
                        FormField {
                            key: "private_key",
                            label: "Private Key",
                            hint: "optional if using saved account",
                            value: String::new(),
                            sensitive: true,
                            required: false,
                        },
                        FormField {
                            key: "account_name",
                            label: "Saved Account",
                            hint: "optional: account in default keystore dir",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                        FormField {
                            key: "password",
                            label: "Keystore Password",
                            hint: "required for saved account or keystore path",
                            value: String::new(),
                            sensitive: true,
                            required: false,
                        },
                        FormField {
                            key: "keystore_path",
                            label: "Keystore Path",
                            hint: "optional: path to a keystore file",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::CreateWallet,
                    label: "Create New",
                    command_label: "cast wallet new",
                    description: "Generate a new wallet. Leave the save fields blank for an unsaved keypair, or add a password plus account name/keystore dir to store it in Foundry.",
                    fields: vec![
                        FormField {
                            key: "account_name",
                            label: "Account Name",
                            hint: "zus-main",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                        FormField {
                            key: "keystore_dir",
                            label: "Keystore Dir",
                            hint: "~/.foundry/keystores",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                        FormField {
                            key: "password",
                            label: "Password",
                            hint: "required if saving keystore",
                            value: String::new(),
                            sensitive: true,
                            required: false,
                        },
                        FormField {
                            key: "number",
                            label: "Number",
                            hint: "1",
                            value: "1".to_string(),
                            sensitive: false,
                            required: false,
                        },
                    ],
                },
                ActionForm {
                    kind: ActionKind::ImportWallet,
                    label: "Import Private Key",
                    command_label: "cast wallet import",
                    description: "Store an existing private key as an encrypted Foundry keystore entry.",
                    fields: vec![
                        FormField {
                            key: "account_name",
                            label: "Account Name",
                            hint: "my-imported-wallet",
                            value: String::new(),
                            sensitive: false,
                            required: true,
                        },
                        FormField {
                            key: "private_key",
                            label: "Private Key",
                            hint: "paste your private key here",
                            value: String::new(),
                            sensitive: true,
                            required: true,
                        },
                        FormField {
                            key: "password",
                            label: "Password",
                            hint: "keystore password",
                            value: String::new(),
                            sensitive: true,
                            required: true,
                        },
                        FormField {
                            key: "keystore_dir",
                            label: "Keystore Dir",
                            hint: "~/.foundry/keystores",
                            value: String::new(),
                            sensitive: false,
                            required: false,
                        },
                    ],
                },
            ],
            selected_action: 0,
            selected_field: 0,
            focus: Focus::Actions,
            output:
                "Campaign Explorer checks claimability. Filecoin Tx Explorer reconstructs posted chain data. Generate ZK Witness resolves a saved wallet, fetches campaign claim inputs, writes Prover.toml, and runs the Noir witness solver."
                    .to_string(),
            last_command: format!("GET {}/campaigns", default_api_base_url()),
            status: "Ready".to_string(),
        }
    }

    pub fn current_form(&self) -> &ActionForm {
        &self.forms[self.selected_action]
    }

    pub fn current_form_mut(&mut self) -> &mut ActionForm {
        &mut self.forms[self.selected_action]
    }

    pub fn current_field(&self) -> Option<&FormField> {
        self.current_form().fields.get(self.selected_field)
    }

    pub fn current_field_mut(&mut self) -> Option<&mut FormField> {
        let index = self.selected_field;
        self.current_form_mut().fields.get_mut(index)
    }

    pub fn select_next_action(&mut self) {
        self.selected_action = (self.selected_action + 1) % self.forms.len();
        self.selected_field = 0;
    }

    pub fn select_prev_action(&mut self) {
        self.selected_action = if self.selected_action == 0 {
            self.forms.len() - 1
        } else {
            self.selected_action - 1
        };
        self.selected_field = 0;
    }

    pub fn select_next_field(&mut self) {
        if self.current_form().fields.is_empty() {
            return;
        }
        self.selected_field = (self.selected_field + 1) % self.current_form().fields.len();
    }

    pub fn select_prev_field(&mut self) {
        if self.current_form().fields.is_empty() {
            return;
        }
        self.selected_field = if self.selected_field == 0 {
            self.current_form().fields.len() - 1
        } else {
            self.selected_field - 1
        };
    }

    pub fn move_focus_left(&mut self) {
        self.focus = Focus::Actions;
    }

    pub fn move_focus_right(&mut self) {
        self.focus = Focus::Fields;
    }

    pub fn backspace(&mut self) {
        if let Some(field) = self.current_field_mut() {
            field.value.pop();
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        if let Some(field) = self.current_field_mut() {
            field.value.push(ch);
        }
    }

    pub fn clear_output(&mut self) {
        self.output.clear();
        self.status = "Output cleared".to_string();
    }

    pub fn set_form_field_value(&mut self, kind: ActionKind, key: &str, value: String) {
        if let Some(form) = self.forms.iter_mut().find(|form| form.kind == kind) {
            if let Some(field) = form.fields.iter_mut().find(|field| field.key == key) {
                field.value = value;
            }
        }
    }

    pub fn select_field_by_key(&mut self, key: &str) {
        if let Some(index) = self
            .current_form()
            .fields
            .iter()
            .position(|field| field.key == key)
        {
            self.selected_field = index;
            self.focus = Focus::Fields;
        }
    }
}

pub fn default_circuit_dir() -> String {
    let current_dir = env::current_dir().ok();
    let fallback = "../zus_addy".to_string();

    let Some(current_dir) = current_dir else {
        return fallback;
    };

    let candidate = if current_dir.file_name().and_then(|name| name.to_str()) == Some("tui") {
        current_dir.parent().map(|parent| parent.join("zus_addy"))
    } else {
        Some(current_dir.join("zus_addy"))
    };

    candidate
        .unwrap_or_else(|| PathBuf::from(fallback.clone()))
        .display()
        .to_string()
}

pub fn default_api_base_url() -> String {
    env::var("ZUS_API_BASE_URL").unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_string())
}

pub fn default_rpc_url() -> String {
    env::var("ZUS_RPC_URL").unwrap_or_else(|_| "https://testnet.evm.nodes.onflow.org".to_string())
}

pub fn default_protocol_address() -> String {
    env::var("ZUS_PROTOCOL_ADDRESS")
        .unwrap_or_else(|_| DEFAULT_ZUS_PROTOCOL_ADDRESS.to_string())
}

pub fn default_bb_crs_path() -> String {
    env::var("BB_CRS_PATH")
        .or_else(|_| env::var("HOME").map(|home| format!("{home}/.bb-crs")))
        .unwrap_or_else(|_| "~/.bb-crs".to_string())
}

pub fn default_verifier_vk_path() -> String {
    let current_dir = env::current_dir().ok();
    let fallback = "../verifier/generated/stealthdrop/vk/vk".to_string();

    let Some(current_dir) = current_dir else {
        return fallback;
    };

    let candidate = if current_dir.file_name().and_then(|name| name.to_str()) == Some("tui") {
        current_dir
            .parent()
            .map(|parent| parent.join("verifier/generated/stealthdrop/vk/vk"))
    } else {
        Some(current_dir.join("verifier/generated/stealthdrop/vk/vk"))
    };

    candidate
        .unwrap_or_else(|| PathBuf::from(fallback.clone()))
        .display()
        .to_string()
}

pub fn default_proof_output_dir() -> String {
    let current_dir = env::current_dir().ok();
    let fallback = "../verifier/generated/stealthdrop/proof_tui".to_string();

    let Some(current_dir) = current_dir else {
        return fallback;
    };

    let candidate = if current_dir.file_name().and_then(|name| name.to_str()) == Some("tui") {
        current_dir
            .parent()
            .map(|parent| parent.join("verifier/generated/stealthdrop/proof_tui"))
    } else {
        Some(current_dir.join("verifier/generated/stealthdrop/proof_tui"))
    };

    candidate
        .unwrap_or_else(|| PathBuf::from(fallback.clone()))
        .display()
        .to_string()
}

impl ActionForm {
    pub fn value(&self, key: &str) -> &str {
        self.fields
            .iter()
            .find(|field| field.key == key)
            .map(|field| field.value.trim())
            .unwrap_or("")
    }
}
