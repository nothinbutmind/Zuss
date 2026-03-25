mod error;
mod types;

use std::fmt::Write as _;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use crate::error::{AppError, AppResult};
use crate::types::{
    ActionForm, ActionKind, ApiCampaignSummary, ApiClaimPayload, ApiFilecoinCampaignResponse, App,
    AppTerminal, CommandResult, Focus, default_api_base_url, default_bb_crs_path,
    default_circuit_dir, default_proof_output_dir, default_protocol_address, default_rpc_url,
    default_verifier_vk_path,
};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Frame, Terminal,
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Margin, Rect},
    style::{Color, Modifier, Style},
    symbols::border,
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, List, ListItem, Padding, Paragraph, Wrap},
};
use num_bigint::{BigInt, BigUint, Sign};
use reqwest::{StatusCode, blocking::Client};

const LOGO: &[&str] = &[
    "███████╗██╗   ██╗███████╗",
    "╚══███╔╝██║   ██║██╔════╝",
    "  ███╔╝ ██║   ██║███████╗",
    " ███╔╝  ██║   ██║╚════██║",
    "███████╗╚██████╔╝███████║",
    "╚══════╝ ╚═════╝ ╚══════╝",
    "      your privacy fren",
];

const SMALL_LOGO: &[&str] = &[
    "██████╗ ██╗   ██╗███████╗",
    "██████╔╝╚██████╔╝███████╗",
    "╚═════╝  ╚═════╝ ╚══════╝",
    "your privacy fren",
];

const HELP_TEXT: &str =
    "Up/Down: move  Tab/Left/Right: focus  Type: edit  Enter: run  Esc: clear output  q: quit";

// Custom MVP wiring: the TUI injects fixed demo values for the Noir message/tweak so the
// witness flow is predictable and easy to show end to end. Replace these with fresh per-claim
// values before treating the flow as production-ready.
const MVP_NOIR_MESSAGE: [u8; 8] = *b"ZUSMVP01";
const MVP_NOIR_STEALTH_TWEAK: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7,
];
const BN254_FIELD_MODULUS_DECIMAL: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";

struct CampaignLookupResult {
    campaign: ApiCampaignSummary,
    claim_status: ClaimStatus,
}

enum ClaimStatus {
    Eligible(ApiClaimPayload),
    Missing,
    Error(String),
}

struct ResolvedWallet {
    account_label: String,
    address: String,
    wallet_secret: [u8; 32],
}

struct AutoWitnessSecrets {
    message: [u8; 8],
    stealth_tweak: [u8; 32],
}

struct ResolvedCampaignClaim {
    campaign: ApiCampaignSummary,
    claim: ApiClaimPayload,
}

impl App {
    fn run(&mut self) {
        let action_kind = self.current_form().kind;
        let create_wallet_saves_to_keystore = action_kind == ActionKind::CreateWallet
            && create_wallet_should_save(self.current_form());

        match execute_action(self.current_form()) {
            Ok(result) => {
                let auto_filled_address = if matches!(
                    action_kind,
                    ActionKind::CheckAddress
                        | ActionKind::CreateWallet
                        | ActionKind::GenerateZkWitness
                ) && result.success
                {
                    extract_wallet_address(&result.output)
                } else {
                    None
                };

                self.last_command = result.command_preview;
                self.output = if action_kind == ActionKind::ListAccounts && result.success {
                    format_saved_accounts_output(&result.output)
                } else {
                    result.output
                };
                self.status = if result.success {
                    "Completed".to_string()
                } else {
                    "Completed with issues".to_string()
                };

                if let Some(address) = auto_filled_address {
                    self.set_form_field_value(
                        ActionKind::CampaignExplorer,
                        "wallet_address",
                        address,
                    );
                    self.status = "Completed and copied address into Campaign Explorer".to_string();
                }

                if action_kind == ActionKind::CreateWallet
                    && result.success
                    && !create_wallet_saves_to_keystore
                {
                    self.output.push_str(
                        "\n\nNot saved: this keypair was only printed to the output. Add a password plus account name or keystore dir if you want Foundry to store it.",
                    );
                    self.status = "Completed, but the new wallet was not saved".to_string();
                }
            }
            Err(err) => {
                self.last_command = fallback_command_preview(self.current_form());
                self.output = err.to_string();
                self.status = "Request failed".to_string();
                focus_fields_for_error(self, &err.to_string());
            }
        }
    }
}

fn execute_action(form: &ActionForm) -> AppResult<CommandResult> {
    match form.kind {
        ActionKind::CampaignExplorer => run_campaign_lookup(form),
        ActionKind::FilecoinTxExplorer => run_filecoin_tx_lookup(form),
        ActionKind::FilecoinTxClaimLookup => run_filecoin_tx_claim_lookup(form),
        ActionKind::GenerateZkWitness => run_generate_zk_witness(form),
        _ => {
            let args = build_command(form)?;
            run_cast_command(&args)
        }
    }
}

fn main() -> AppResult<()> {
    let mut terminal = setup_terminal()?;
    let app_result = run_app(&mut terminal);
    restore_terminal(&mut terminal)?;
    app_result
}

fn setup_terminal() -> AppResult<AppTerminal> {
    enable_raw_mode().map_err(|source| AppError::io("failed to enable raw mode", source))?;
    execute!(io::stdout(), EnterAlternateScreen)
        .map_err(|source| AppError::io("failed to enter alternate screen", source))?;
    let backend = CrosstermBackend::new(io::stdout());
    Terminal::new(backend).map_err(|source| AppError::io("failed to initialize terminal", source))
}

fn restore_terminal(terminal: &mut AppTerminal) -> AppResult<()> {
    disable_raw_mode().map_err(|source| AppError::io("failed to disable raw mode", source))?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)
        .map_err(|source| AppError::io("failed to leave alternate screen", source))?;
    terminal
        .show_cursor()
        .map_err(|source| AppError::io("failed to show cursor", source))?;
    Ok(())
}

fn run_app(terminal: &mut AppTerminal) -> AppResult<()> {
    let mut app = App::new();

    loop {
        terminal
            .draw(|frame| render(frame, &app))
            .map_err(|source| AppError::io("failed to draw terminal frame", source))?;

        if !event::poll(Duration::from_millis(100))
            .map_err(|source| AppError::io("failed while polling terminal events", source))?
        {
            continue;
        }

        let Event::Key(key) = event::read()
            .map_err(|source| AppError::io("failed to read terminal event", source))?
        else {
            continue;
        };

        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('q') => break,
            KeyCode::Left => app.move_focus_left(),
            KeyCode::Right | KeyCode::Tab => app.move_focus_right(),
            KeyCode::Esc => app.clear_output(),
            KeyCode::Up if app.focus == Focus::Actions => app.select_prev_action(),
            KeyCode::Down if app.focus == Focus::Actions => app.select_next_action(),
            KeyCode::Up if app.focus == Focus::Fields => app.select_prev_field(),
            KeyCode::Down if app.focus == Focus::Fields => app.select_next_field(),
            KeyCode::Backspace if app.focus == Focus::Fields => app.backspace(),
            KeyCode::Enter => app.run(),
            KeyCode::Char(ch) if app.focus == Focus::Fields => app.insert_char(ch),
            _ => {}
        }
    }

    Ok(())
}

fn render(frame: &mut Frame, app: &App) {
    let compact = frame.area().height < 28 || frame.area().width < 90;
    let [hero_area, body_area, footer_area] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if compact { 6 } else { 10 }),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .areas(frame.area());

    render_hero(frame, hero_area, compact);
    render_body(frame, body_area, app);
    render_footer(frame, footer_area, app);
}

fn render_hero(frame: &mut Frame, area: Rect, compact: bool) {
    let hero_block = Block::default()
        .title(Line::from(vec![
            Span::styled(" ZUS WALLET ARCADE ", Style::default().fg(Color::Yellow)),
            Span::raw(" ratatui x Foundry cast "),
        ]))
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_set(border::THICK)
        .style(Style::default().fg(Color::Blue));
    let inner = hero_block.inner(area);
    frame.render_widget(hero_block, area);
    frame.render_widget(
        Block::default().style(Style::default().bg(Color::Black)),
        inner,
    );

    let logo_lines = if compact { SMALL_LOGO } else { LOGO };
    let [_, logo_area, _] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Fill(1),
            Constraint::Length(logo_lines.len() as u16),
            Constraint::Fill(1),
        ])
        .areas(inner);
    let logo = Paragraph::new(Text::from(
        logo_lines
            .iter()
            .enumerate()
            .map(|(idx, line)| {
                let style = if idx + 1 == logo_lines.len() {
                    Style::default()
                        .fg(Color::Yellow)
                        .bg(Color::Black)
                        .add_modifier(Modifier::ITALIC)
                } else {
                    Style::default()
                        .fg(Color::Blue)
                        .bg(Color::Black)
                        .add_modifier(Modifier::BOLD)
                };
                Line::from(Span::styled(*line, style))
            })
            .collect::<Vec<_>>(),
    ))
    .alignment(Alignment::Center);
    frame.render_widget(logo, logo_area);
}

fn render_body(frame: &mut Frame, area: Rect, app: &App) {
    if area.height < 12 || area.width < 95 {
        let [actions_area, rest_area] = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(5), Constraint::Min(8)])
            .areas(area);
        render_actions(frame, actions_area, app);
        render_form_and_output(frame, rest_area, app, true);
    } else {
        let [left, right] = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
            .areas(area);

        render_actions(frame, left, app);
        render_form_and_output(frame, right, app, false);
    }
}

fn render_actions(frame: &mut Frame, area: Rect, app: &App) {
    let items = app
        .forms
        .iter()
        .enumerate()
        .map(|(index, form)| {
            let selected = index == app.selected_action;
            let title_style = if selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            ListItem::new(vec![
                Line::from(Span::styled(form.label, title_style)),
                Line::from(Span::styled(
                    format!("  {}", form.command_label),
                    Style::default().fg(Color::Blue),
                )),
            ])
        })
        .collect::<Vec<_>>();

    let title = if app.focus == Focus::Actions {
        " Wallet Actions [focused] "
    } else {
        " Wallet Actions "
    };

    let widget = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan))
            .style(Style::default().bg(Color::Black)),
    );
    frame.render_widget(widget, area);
}

fn render_form_and_output(frame: &mut Frame, area: Rect, app: &App, compact: bool) {
    let field_height = if compact {
        4_u16.max(app.current_form().fields.len() as u16 + 2)
    } else {
        6_u16.max((app.current_form().fields.len() as u16 * 2) + 2)
    };

    let [info_area, fields_area, output_area] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if compact { 4 } else { 6 }),
            Constraint::Length(field_height),
            Constraint::Min(if compact { 3 } else { 6 }),
        ])
        .areas(area);

    render_form_info(frame, info_area, app);
    render_fields(frame, fields_area, app);
    render_output(frame, output_area, app);
}

fn render_form_info(frame: &mut Frame, area: Rect, app: &App) {
    let form = app.current_form();
    let info = Paragraph::new(Text::from(vec![
        Line::from(vec![
            Span::styled("Selected: ", Style::default().fg(Color::Yellow)),
            Span::styled(form.label, Style::default().add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("Command: ", Style::default().fg(Color::Yellow)),
            Span::raw(form.command_label),
        ]),
        Line::from(vec![
            Span::styled("About: ", Style::default().fg(Color::Yellow)),
            Span::raw(form.description),
        ]),
    ]))
    .wrap(Wrap { trim: true })
    .block(
        Block::default()
            .title(" Command Deck ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Blue))
            .style(Style::default().bg(Color::Black)),
    );
    frame.render_widget(info, area);
}

fn render_fields(frame: &mut Frame, area: Rect, app: &App) {
    let form = app.current_form();
    let lines = form
        .fields
        .iter()
        .enumerate()
        .flat_map(|(index, field)| {
            let selected = app.focus == Focus::Fields && index == app.selected_field;
            let label_style = if selected {
                Style::default().fg(Color::Black).bg(Color::Green)
            } else {
                Style::default().fg(Color::Green)
            };

            let value = if field.value.is_empty() {
                field.hint.to_string()
            } else if field.sensitive {
                mask_sensitive_value(&field.value)
            } else {
                field.value.clone()
            };

            let value_style = if field.value.is_empty() {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default().fg(Color::White)
            };

            let required = if field.required { " *" } else { "" };

            vec![
                Line::from(vec![
                    Span::styled(field.label, label_style),
                    Span::styled(required, Style::default().fg(Color::Yellow)),
                    Span::styled(" : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(value, value_style),
                ]),
                Line::from(""),
            ]
        })
        .collect::<Vec<_>>();

    let title = if app.focus == Focus::Fields {
        " Wallet Fields [focused] "
    } else {
        " Wallet Fields "
    };

    let widget = Paragraph::new(Text::from(lines))
        .block(
            Block::default()
                .title(title)
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Green))
                .style(Style::default().bg(Color::Black))
                .padding(Padding::horizontal(1)),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(widget, area);

    if app.focus == Focus::Fields {
        if let Some(field) = app.current_field() {
            let row = app.selected_field as u16 * 2;
            let cursor_content = if field.value.is_empty() {
                String::new()
            } else if field.sensitive {
                mask_sensitive_value(&field.value)
            } else {
                field.value.clone()
            };
            let cursor_x = area
                .x
                .saturating_add(
                    field.label.len() as u16 + 5 + cursor_content.chars().count() as u16,
                )
                .min(area.right().saturating_sub(2));
            let cursor_y = area.y.saturating_add(1 + row);
            frame.set_cursor_position((cursor_x, cursor_y));
        }
    }
}

fn mask_sensitive_value(value: &str) -> String {
    "*".repeat(value.chars().count())
}

fn compact_output_title(value: &str) -> String {
    const MAX_CHARS: usize = 58;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }

    let shortened = trimmed
        .chars()
        .take(MAX_CHARS.saturating_sub(1))
        .collect::<String>();
    format!("{shortened}…")
}

fn render_output(frame: &mut Frame, area: Rect, app: &App) {
    let widget = Paragraph::new(app.output.as_str())
        .style(Style::default().fg(Color::White).bg(Color::Black))
        .block(
            Block::default()
                .title(format!(" Output | {} ", compact_output_title(&app.last_command)))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Magenta))
                .style(Style::default().bg(Color::Black))
                .padding(Padding::horizontal(1)),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(widget, area);
}

fn render_footer(frame: &mut Frame, area: Rect, app: &App) {
    let footer = Paragraph::new(Text::from(vec![
        Line::from(vec![
            Span::styled("Status: ", Style::default().fg(Color::Yellow)),
            Span::styled(&app.status, Style::default().add_modifier(Modifier::BOLD)),
        ]),
        Line::from(Span::styled(HELP_TEXT, Style::default().fg(Color::Gray))),
    ]))
    .alignment(Alignment::Center)
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );
    frame.render_widget(Clear, area.inner(Margin::new(0, 0)));
    frame.render_widget(footer, area);
}

fn build_command(form: &ActionForm) -> AppResult<Vec<String>> {
    match form.kind {
        ActionKind::CampaignExplorer => Err(AppError::message(
            "Campaign Explorer is handled through the proof API, not cast.",
        )),
        ActionKind::FilecoinTxExplorer => Err(AppError::message(
            "Filecoin Tx Explorer is handled through the proof API, not cast.",
        )),
        ActionKind::FilecoinTxClaimLookup => Err(AppError::message(
            "Filecoin Tx Claim Lookup is handled through the proof API, not cast.",
        )),
        ActionKind::GenerateZkWitness => Err(AppError::message(
            "Prove + Claim is handled through the Noir plus protocol flow, not plain cast.",
        )),
        ActionKind::ListAccounts => {
            let keystore_dir = normalize_path(form.value("keystore_dir"));
            let mut args = vec!["wallet".to_string(), "list".to_string()];
            if !keystore_dir.is_empty() {
                args.push("--dir".to_string());
                args.push(keystore_dir);
            }
            Ok(args)
        }
        ActionKind::CheckAddress => build_wallet_address_command(form),
        ActionKind::CreateWallet => {
            let account_name = form.value("account_name");
            let keystore_dir = normalize_path(form.value("keystore_dir"));
            let password = form.value("password");
            let number = if form.value("number").is_empty() {
                "1"
            } else {
                form.value("number")
            };
            let parsed_number: usize = number
                .parse()
                .map_err(|_| AppError::message("Number must be a positive integer."))?;
            if parsed_number == 0 {
                return Err(AppError::message("Number must be at least 1."));
            }

            let mut args = vec!["wallet".to_string(), "new".to_string()];
            if parsed_number != 1 {
                args.push("--number".to_string());
                args.push(parsed_number.to_string());
            }

            let should_save =
                !account_name.is_empty() || !keystore_dir.is_empty() || !password.is_empty();
            if should_save {
                if password.is_empty() {
                    return Err(AppError::message(
                        "Password is required when saving a new wallet to a keystore.",
                    ));
                }
                let target_dir = if keystore_dir.is_empty() {
                    default_foundry_keystore_dir()
                } else {
                    keystore_dir
                };
                ensure_directory_exists(&target_dir)?;
                args.push(target_dir);
                if !account_name.is_empty() {
                    args.push(account_name.to_string());
                }
                args.push("--unsafe-password".to_string());
                args.push(password.to_string());
            }

            Ok(args)
        }
        ActionKind::ImportWallet => {
            let account_name = required_value(form, "account_name", "Account name is required.")?;
            let private_key = required_value(form, "private_key", "Private key is required.")?;
            let password = required_value(form, "password", "Password is required.")?;
            let keystore_dir = normalize_path(form.value("keystore_dir"));

            let mut args = vec!["wallet".to_string(), "import".to_string()];
            if !keystore_dir.is_empty() {
                ensure_directory_exists(&keystore_dir)?;
                args.push("--keystore-dir".to_string());
                args.push(keystore_dir);
            }
            args.push(account_name);
            args.push("--private-key".to_string());
            args.push(private_key);
            args.push("--unsafe-password".to_string());
            args.push(password);
            Ok(args)
        }
    }
}

fn fallback_command_preview(form: &ActionForm) -> String {
    match form.kind {
        ActionKind::CampaignExplorer => {
            let api_base = normalize_api_base_url(form.value("api_base_url"))
                .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
            format!("GET {api_base}/campaigns")
        }
        ActionKind::FilecoinTxExplorer => {
            let api_base = normalize_api_base_url(form.value("api_base_url"))
                .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
            format!("GET {api_base}/filecoin/tx/{}", form.value("tx_hash"))
        }
        ActionKind::FilecoinTxClaimLookup => {
            let api_base = normalize_api_base_url(form.value("api_base_url"))
                .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
            format!(
                "GET {api_base}/filecoin/tx/{}/claim/{}",
                form.value("tx_hash"),
                form.value("leaf_address")
            )
        }
        _ => form.command_label.to_string(),
    }
}

fn create_wallet_should_save(form: &ActionForm) -> bool {
    !form.value("account_name").is_empty()
        || !form.value("keystore_dir").is_empty()
        || !form.value("password").is_empty()
}

fn focus_fields_for_error(app: &mut App, message: &str) {
    let lowered = message.to_ascii_lowercase();
    let key = if lowered.contains("api base url") {
        Some("api_base_url")
    } else if lowered.contains("campaign id") {
        Some("campaign_id")
    } else if lowered.contains("tx hash") || lowered.contains("transaction hash") {
        Some("tx_hash")
    } else if lowered.contains("leaf address") {
        Some("leaf_address")
    } else if lowered.contains("wallet address") {
        Some("wallet_address")
    } else if lowered.contains("wallet account") {
        Some("wallet_account")
    } else if lowered.contains("saved account") || lowered.contains("account name") {
        Some("account_name")
    } else if lowered.contains("keystore path") {
        Some("keystore_path")
    } else if lowered.contains("circuit dir") {
        Some("circuit_dir")
    } else if lowered.contains("verifier vk") {
        Some("verifier_vk_path")
    } else if lowered.contains("proof output dir") {
        Some("proof_output_dir")
    } else if lowered.contains("bb crs") {
        Some("bb_crs_path")
    } else if lowered.contains("witness name") {
        Some("witness_name")
    } else if lowered.contains("keystore dir") {
        Some("keystore_dir")
    } else if lowered.contains("password") {
        Some("password")
    } else if lowered.contains("private key") {
        Some("private_key")
    } else if lowered.contains("number") {
        Some("number")
    } else {
        app.current_form().fields.first().map(|field| field.key)
    };

    if let Some(key) = key {
        app.select_field_by_key(key);
    } else {
        app.move_focus_right();
    }
}

fn build_wallet_address_command(form: &ActionForm) -> AppResult<Vec<String>> {
    let private_key = form.value("private_key");
    let account_name = form.value("account_name");
    let password = form.value("password");
    let keystore_path = normalize_path(form.value("keystore_path"));

    let mut args = vec!["wallet".to_string(), "address".to_string()];
    if !private_key.is_empty() {
        args.push("--private-key".to_string());
        args.push(private_key.to_string());
        return Ok(args);
    }

    build_saved_wallet_address_command(account_name, &keystore_path, password)
}

fn required_value(form: &ActionForm, key: &str, message: &str) -> AppResult<String> {
    let value = form.value(key);
    if value.is_empty() {
        return Err(AppError::message(message.to_string()));
    }
    Ok(value.to_string())
}

fn run_campaign_lookup(form: &ActionForm) -> AppResult<CommandResult> {
    let api_base = normalize_api_base_url(&required_value(
        form,
        "api_base_url",
        "API base URL is required.",
    )?)?;
    let campaigns_url = format!("{api_base}/campaigns");
    let wallet_address = resolve_campaign_wallet_address(form)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|source| AppError::http("failed to build the proof API client", source))?;

    let campaigns_response = client
        .get(&campaigns_url)
        .send()
        .map_err(|source| AppError::http(format!("failed to fetch {campaigns_url}"), source))?;
    let campaigns =
        parse_json_response::<Vec<ApiCampaignSummary>>(campaigns_response, &campaigns_url)?;

    if let Some(address) = wallet_address.as_deref() {
        let lookups = campaigns
            .into_iter()
            .map(|campaign| lookup_claim_for_campaign(&client, &api_base, address, campaign))
            .collect::<Vec<_>>();
        let has_errors = lookups
            .iter()
            .any(|lookup| matches!(lookup.claim_status, ClaimStatus::Error(_)));

        Ok(CommandResult {
            command_preview: format!("GET {campaigns_url} + claim lookups for {address}"),
            output: format_campaign_lookup_output(&api_base, address, &lookups),
            success: !has_errors,
        })
    } else {
        Ok(CommandResult {
            command_preview: format!("GET {campaigns_url}"),
            output: format_campaign_catalog_output(&api_base, &campaigns),
            success: true,
        })
    }
}

fn run_filecoin_tx_lookup(form: &ActionForm) -> AppResult<CommandResult> {
    let api_base = normalize_api_base_url(&required_value(
        form,
        "api_base_url",
        "API base URL is required.",
    )?)?;
    let tx_hash = required_value(form, "tx_hash", "Tx hash is required.")?;
    let url = format!("{api_base}/filecoin/tx/{tx_hash}");
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|source| AppError::http("failed to build the proof API client", source))?;
    let response = client
        .get(&url)
        .send()
        .map_err(|source| AppError::http(format!("failed to fetch {url}"), source))?;
    let campaign = parse_json_response::<ApiFilecoinCampaignResponse>(response, &url)?;

    Ok(CommandResult {
        command_preview: format!("GET {url}"),
        output: format_filecoin_campaign_output(&campaign),
        success: true,
    })
}

fn run_filecoin_tx_claim_lookup(form: &ActionForm) -> AppResult<CommandResult> {
    let api_base = normalize_api_base_url(&required_value(
        form,
        "api_base_url",
        "API base URL is required.",
    )?)?;
    let tx_hash = required_value(form, "tx_hash", "Tx hash is required.")?;
    let leaf_address = normalize_wallet_address(&required_value(
        form,
        "leaf_address",
        "Leaf address is required.",
    )?)?;
    let url = format!("{api_base}/filecoin/tx/{tx_hash}/claim/{leaf_address}");
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|source| AppError::http("failed to build the proof API client", source))?;
    let response = client
        .get(&url)
        .send()
        .map_err(|source| AppError::http(format!("failed to fetch {url}"), source))?;
    let claim = parse_json_response::<ApiClaimPayload>(response, &url)?;

    Ok(CommandResult {
        command_preview: format!("GET {url}"),
        output: format_single_claim_output(&tx_hash, &claim),
        success: true,
    })
}

fn run_generate_zk_witness(form: &ActionForm) -> AppResult<CommandResult> {
    let api_base = normalize_api_base_url(&default_api_base_url())?;
    let protocol_address = normalize_protocol_address(&default_protocol_address())?;
    let rpc_url = normalize_rpc_url(&default_rpc_url())?;
    let campaign_selector = required_value(
        form,
        "campaign_selector",
        "Campaign name or UUID is required.",
    )?;
    let circuit_dir = normalize_circuit_dir(&default_circuit_dir())?;
    let bb_crs_path = normalize_existing_dir(
        &default_bb_crs_path(),
        "BB CRS path",
    )?;
    let verifier_vk_path = normalize_existing_file(
        &default_verifier_vk_path(),
        "Verifier VK path",
    )?;
    let proof_output_dir = normalize_output_dir(
        &default_proof_output_dir(),
        "Proof output dir",
    )?;
    let witness_name = "claim_witness".to_string();

    let wallet = resolve_wallet_for_zk(form)?;
    let resolved_campaign = resolve_campaign_claim_for_wallet(
        &api_base,
        &campaign_selector,
        &wallet.address,
    )?;
    let claim = resolved_campaign.claim;
    let campaign = resolved_campaign.campaign;
    let onchain_campaign_id = resolve_onchain_campaign_id(&claim)?;
    let prover_path = circuit_dir.join("Prover.toml");
    let secrets = generate_auto_witness_secrets()?;
    let prover_contents = build_prover_toml_contents(&wallet, &claim, &secrets)?;

    fs::write(&prover_path, prover_contents).map_err(|source| {
        AppError::io(format!("failed to write {}", prover_path.display()), source)
    })?;

    let execute_result = run_nargo_execute(&circuit_dir, &witness_name)?;
    if !execute_result.success {
        return Ok(CommandResult {
            command_preview: format!(
                "write {} + nargo execute {}",
                prover_path.display(),
                witness_name
            ),
            output: execute_result.output,
            success: false,
        });
    }

    let witness_path = circuit_dir
        .join("target")
        .join(format!("{witness_name}.gz"));
    let bytecode_path = circuit_dir.join("target").join("stealthdrop.json");
    let prove_result = run_bb_prove(
        &bytecode_path,
        &witness_path,
        &verifier_vk_path,
        &proof_output_dir,
        &bb_crs_path,
    )?;
    if !prove_result.success {
        return Ok(CommandResult {
            command_preview: format!(
                "write {} + nargo execute {} + bb prove",
                prover_path.display(),
                witness_name
            ),
            output: prove_result.output,
            success: false,
        });
    }

    let proof_path = proof_output_dir.join("proof");
    let public_inputs_path = proof_output_dir.join("public_inputs");
    let proof_hex = encode_file_as_hex(&proof_path)?;
    let public_inputs = encode_public_inputs_array(&public_inputs_path)?;
    let preview_result = run_cast_command_with_preview(
        &build_protocol_preview_args(
            &protocol_address,
            &onchain_campaign_id,
            &public_inputs,
            &rpc_url,
        ),
        format!("cast call {protocol_address} previewClaim(..)"),
    )?;
    if !preview_result.success {
        return Ok(CommandResult {
            command_preview: "cast call previewClaim(..)".to_string(),
            output: preview_result.output,
            success: false,
        });
    }

    let private_key_hex = format!("0x{}", bytes_to_hex(&wallet.wallet_secret));
    let claim_result = run_cast_command_with_preview(
        &build_protocol_claim_args(
            &protocol_address,
            &onchain_campaign_id,
            &proof_hex,
            &public_inputs,
            &rpc_url,
            &private_key_hex,
        ),
        format!("cast send {protocol_address} claim(..)"),
    )?;

    let mut output = String::new();
    let _ = writeln!(output, "Resolved wallet: {}", wallet.account_label);
    let _ = writeln!(output, "Resolved address: {}", wallet.address);
    let _ = writeln!(output, "Campaign selector: {campaign_selector}");
    let _ = writeln!(output, "Resolved campaign name: {}", campaign.name);
    let _ = writeln!(output, "Resolved campaign ID: {}", claim.campaign_id);
    let _ = writeln!(output, "Onchain Campaign ID: {}", onchain_campaign_id);
    let _ = writeln!(output, "Protocol address: {}", protocol_address);
    let _ = writeln!(output, "RPC URL: {}", rpc_url);
    let _ = writeln!(output, "Claim leaf address: {}", claim.leaf_address);
    let _ = writeln!(output, "Prover file: {}", prover_path.display());
    let _ = writeln!(output, "Witness path: {}", witness_path.display());
    let _ = writeln!(output, "Bytecode path: {}", bytecode_path.display());
    let _ = writeln!(output, "Verifier VK: {}", verifier_vk_path.display());
    let _ = writeln!(output, "BB CRS path: {}", bb_crs_path.display());
    let _ = writeln!(output, "Proof output dir: {}", proof_output_dir.display());
    let _ = writeln!(output, "Message hex: {}", bytes_to_hex(&secrets.message));
    let _ = writeln!(
        output,
        "Stealth tweak: {}",
        bytes_to_hex(&secrets.stealth_tweak)
    );
    let _ = writeln!(
        output,
        "MVP mode: using fixed TUI Noir inputs for message and stealth_tweak."
    );
    let _ = writeln!(output);
    let _ = writeln!(
        output,
        "nargo execute output:\n{}",
        execute_result.output.trim()
    );
    let _ = writeln!(output);
    let _ = writeln!(
        output,
        "bb prove output:\n{}",
        prove_result.output.trim()
    );
    let _ = writeln!(output);
    let _ = writeln!(output, "previewClaim output:\n{}", preview_result.output.trim());
    let _ = writeln!(output);
    let _ = writeln!(output, "claim tx output:\n{}", claim_result.output.trim());
    let _ = writeln!(
        output,
        "Circuit public outputs now include nullifier_x, nullifier_y, and stealth_address, and this action used them to send the onchain claim transaction."
    );

    Ok(CommandResult {
        command_preview: format!(
            "GET claim payload + nargo execute {} + bb prove + cast send claim(..)",
            witness_name
        ),
        output,
        success: claim_result.success,
    })
}

fn resolve_wallet_for_zk(form: &ActionForm) -> AppResult<ResolvedWallet> {
    let account_name = required_value(
        form,
        "wallet_account",
        "Wallet account is required for ZK witness generation.",
    )?;
    let password = required_value(
        form,
        "password",
        "Password is required for ZK witness generation.",
    )?;
    let keystore_path = normalize_path(form.value("keystore_path"));

    let address_result = run_cast_command(&build_saved_wallet_address_command(
        &account_name,
        &keystore_path,
        &password,
    )?)?;
    if !address_result.success {
        return Err(AppError::message(format!(
            "failed to resolve wallet address from Foundry keystore: {}",
            address_result.output.trim()
        )));
    }

    let private_key_result = run_cast_command(&build_saved_wallet_private_key_command(
        &account_name,
        &keystore_path,
        &password,
    )?)?;
    if !private_key_result.success {
        return Err(AppError::message(
            "failed to decrypt wallet private key from Foundry keystore".to_string(),
        ));
    }

    let address = extract_wallet_address(&address_result.output).ok_or_else(|| {
        AppError::message(
            "cast returned output, but I could not extract a wallet address from it.".to_string(),
        )
    })?;
    let wallet_secret = extract_private_key_bytes(&private_key_result.output)?;

    Ok(ResolvedWallet {
        account_label: normalize_foundry_account_name(&account_name),
        address,
        wallet_secret,
    })
}

fn resolve_campaign_claim_for_wallet(
    api_base: &str,
    campaign_selector: &str,
    wallet_address: &str,
) -> AppResult<ResolvedCampaignClaim> {
    let trimmed_selector = campaign_selector.trim();
    if trimmed_selector.is_empty() {
        return Err(AppError::message(
            "Campaign name or UUID is required.".to_string(),
        ));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|source| AppError::http("failed to build the proof API client", source))?;
    let campaigns_url = format!("{api_base}/campaigns");
    let campaigns_response = client
        .get(&campaigns_url)
        .send()
        .map_err(|source| AppError::http(format!("failed to fetch {campaigns_url}"), source))?;
    let campaigns =
        parse_json_response::<Vec<ApiCampaignSummary>>(campaigns_response, &campaigns_url)?;

    let matching_campaigns = campaigns
        .into_iter()
        .filter(|campaign| campaign_matches_selector(campaign, trimmed_selector))
        .collect::<Vec<_>>();

    if matching_campaigns.is_empty() {
        return Err(AppError::message(format!(
            "No campaign matched '{trimmed_selector}'. Try the exact campaign name shown in Campaign Explorer."
        )));
    }

    let mut eligible_matches = Vec::new();
    let mut last_missing_match = None;

    for campaign in matching_campaigns {
        match lookup_claim_for_campaign(&client, api_base, wallet_address, campaign.clone()).claim_status {
            ClaimStatus::Eligible(claim) => {
                eligible_matches.push(ResolvedCampaignClaim { campaign, claim });
            }
            ClaimStatus::Missing => {
                last_missing_match = Some(campaign);
            }
            ClaimStatus::Error(message) => {
                return Err(AppError::message(format!(
                    "Failed to resolve campaign '{trimmed_selector}' for wallet {wallet_address}: {message}"
                )));
            }
        }
    }

    match eligible_matches.len() {
        1 => Ok(eligible_matches.remove(0)),
        0 => {
            if let Some(campaign) = last_missing_match {
                Err(AppError::message(format!(
                    "Campaign '{}' matched, but wallet {} is not eligible for it.",
                    campaign.name, wallet_address
                )))
            } else {
                Err(AppError::message(format!(
                    "No eligible campaign matched '{trimmed_selector}' for wallet {wallet_address}."
                )))
            }
        }
        _ => {
            let names = eligible_matches
                .iter()
                .map(|resolved| format!("{} ({})", resolved.campaign.name, resolved.campaign.campaign_id))
                .collect::<Vec<_>>()
                .join(", ");
            Err(AppError::message(format!(
                "Multiple eligible campaigns matched '{trimmed_selector}'. Use a UUID instead. Matches: {names}"
            )))
        }
    }
}

fn campaign_matches_selector(campaign: &ApiCampaignSummary, selector: &str) -> bool {
    campaign.campaign_id.eq_ignore_ascii_case(selector)
        || campaign
            .onchain_campaign_id
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(selector))
            .unwrap_or(false)
        || campaign.name.eq_ignore_ascii_case(selector)
}

fn build_prover_toml_contents(
    wallet: &ResolvedWallet,
    claim: &ApiClaimPayload,
    secrets: &AutoWitnessSecrets,
) -> AppResult<String> {
    let eligible_index = canonicalize_field_decimal(&claim.noir_inputs.eligible_index)?;
    let eligible_path = claim
        .noir_inputs
        .eligible_path
        .iter()
        .map(|value| canonicalize_field_decimal(value))
        .collect::<AppResult<Vec<_>>>()?;
    let eligible_root = canonicalize_field_decimal(&claim.noir_inputs.eligible_root)?;

    let mut prover = String::new();
    prover.push_str(&format_field_scalar_toml("eligible_index", &eligible_index));
    prover.push_str(&format_string_array_toml("eligible_path", &eligible_path));
    prover.push_str(&format_field_scalar_toml("eligible_root", &eligible_root));
    prover.push_str(&format_u8_array_toml("message", &secrets.message));
    prover.push_str(&format_u8_array_toml(
        "stealth_tweak",
        &secrets.stealth_tweak,
    ));
    prover.push_str(&format_u8_array_toml(
        "wallet_secret",
        &wallet.wallet_secret,
    ));
    Ok(prover)
}

fn canonicalize_field_decimal(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::message("field value cannot be empty"));
    }

    if trimmed.chars().all(|character| character.is_ascii_digit()) {
        return Ok(trimmed.to_string());
    }

    let value = BigInt::parse_bytes(trimmed.as_bytes(), 10).ok_or_else(|| {
        AppError::message(format!("failed to parse field integer from API: {trimmed}"))
    })?;
    let modulus = BigUint::parse_bytes(BN254_FIELD_MODULUS_DECIMAL.as_bytes(), 10)
        .ok_or_else(|| AppError::message("failed to parse BN254 field modulus"))?;
    let modulus_bigint = BigInt::from_biguint(Sign::Plus, modulus.clone());
    let normalized = ((value % &modulus_bigint) + &modulus_bigint) % &modulus_bigint;
    let normalized_biguint = normalized.to_biguint().ok_or_else(|| {
        AppError::message("normalized field value must be non-negative".to_string())
    })?;
    Ok(normalized_biguint.to_str_radix(10))
}

fn resolve_onchain_campaign_id(claim: &ApiClaimPayload) -> AppResult<String> {
    if let Some(onchain_campaign_id) = claim.onchain_campaign_id.as_deref() {
        if is_bytes32_hex(onchain_campaign_id) {
            return Ok(onchain_campaign_id.to_string());
        }
    }

    derive_onchain_campaign_id_from_uuid(&claim.campaign_id)
}

fn derive_onchain_campaign_id_from_uuid(raw: &str) -> AppResult<String> {
    let compact = raw.trim().replace('-', "");
    if compact.len() != 32 || !compact.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(AppError::message(format!(
            "Campaign ID must be a canonical UUID so the TUI can derive the onchain campaign id: {}",
            raw.trim()
        )));
    }

    Ok(format!("0x{:0>64}", compact.to_ascii_lowercase()))
}

fn is_bytes32_hex(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.len() == 66
        && trimmed.starts_with("0x")
        && trimmed[2..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn normalize_protocol_address(raw: &str) -> AppResult<String> {
    normalize_wallet_address(raw)
}

fn normalize_rpc_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::message("RPC URL is required."));
    }
    Ok(trimmed.to_string())
}

fn normalize_existing_file(raw: &str, label: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(normalize_path(raw));
    if !path.exists() {
        return Err(AppError::message(format!(
            "{label} does not exist: {}",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(AppError::message(format!(
            "{label} must point to a file: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn normalize_existing_dir(raw: &str, label: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(normalize_path(raw));
    if !path.exists() {
        return Err(AppError::message(format!(
            "{label} does not exist: {}",
            path.display()
        )));
    }
    if !path.is_dir() {
        return Err(AppError::message(format!(
            "{label} must point to a directory: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn normalize_output_dir(raw: &str, label: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(normalize_path(raw));
    if path.as_os_str().is_empty() {
        return Err(AppError::message(format!("{label} is required.")));
    }

    fs::create_dir_all(&path)
        .map_err(|source| AppError::io(format!("failed to create {}", path.display()), source))?;
    Ok(path)
}

fn run_bb_prove(
    bytecode_path: &Path,
    witness_path: &Path,
    verifier_vk_path: &Path,
    proof_output_dir: &Path,
    bb_crs_path: &Path,
) -> AppResult<CommandResult> {
    let args = vec![
        "prove".to_string(),
        "-t".to_string(),
        "evm".to_string(),
        "-b".to_string(),
        bytecode_path.display().to_string(),
        "-w".to_string(),
        witness_path.display().to_string(),
        "-k".to_string(),
        verifier_vk_path.display().to_string(),
        "-o".to_string(),
        proof_output_dir.display().to_string(),
        "--verify".to_string(),
    ];
    let output = Command::new("bb")
        .args(&args)
        .env("BB_CRS_PATH", bb_crs_path)
        .stdin(Stdio::null())
        .output()
        .map_err(|source| {
            AppError::command_launch(
                format!(
                    "bb prove -t evm -b {} -w {} -k {} -o {} --verify",
                    bytecode_path.display(),
                    witness_path.display(),
                    verifier_vk_path.display(),
                    proof_output_dir.display()
                ),
                source,
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = match (stdout.trim(), stderr.trim()) {
        ("", "") => "(no output)".to_string(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n\n{stderr}"),
    };

    Ok(CommandResult {
        command_preview: format!(
            "bb prove -t evm -b {} -w {} -k {} -o {} --verify",
            bytecode_path.display(),
            witness_path.display(),
            verifier_vk_path.display(),
            proof_output_dir.display()
        ),
        output: combined,
        success: output.status.success(),
    })
}

fn encode_file_as_hex(path: &Path) -> AppResult<String> {
    let bytes = fs::read(path)
        .map_err(|source| AppError::io(format!("failed to read {}", path.display()), source))?;
    Ok(format!("0x{}", bytes_to_hex(&bytes)))
}

fn encode_public_inputs_array(path: &Path) -> AppResult<String> {
    let bytes = fs::read(path)
        .map_err(|source| AppError::io(format!("failed to read {}", path.display()), source))?;
    if bytes.len() % 32 != 0 {
        return Err(AppError::message(format!(
            "Public inputs file must be a multiple of 32 bytes: {}",
            path.display()
        )));
    }

    let mut items = Vec::with_capacity(bytes.len() / 32);
    for chunk in bytes.chunks_exact(32) {
        items.push(format!("0x{}", bytes_to_hex(chunk)));
    }

    Ok(format!("[{}]", items.join(",")))
}

fn build_protocol_preview_args(
    protocol_address: &str,
    onchain_campaign_id: &str,
    public_inputs: &str,
    rpc_url: &str,
) -> Vec<String> {
    vec![
        "call".to_string(),
        protocol_address.to_string(),
        "previewClaim(bytes32,bytes32[])((bytes32,bytes32,address,uint256,uint256,bool))"
            .to_string(),
        onchain_campaign_id.to_string(),
        public_inputs.to_string(),
        "--rpc-url".to_string(),
        rpc_url.to_string(),
    ]
}

fn build_protocol_claim_args(
    protocol_address: &str,
    onchain_campaign_id: &str,
    proof_hex: &str,
    public_inputs: &str,
    rpc_url: &str,
    private_key_hex: &str,
) -> Vec<String> {
    vec![
        "send".to_string(),
        protocol_address.to_string(),
        "claim(bytes32,bytes,bytes32[])(address)".to_string(),
        onchain_campaign_id.to_string(),
        proof_hex.to_string(),
        public_inputs.to_string(),
        "--rpc-url".to_string(),
        rpc_url.to_string(),
        "--private-key".to_string(),
        private_key_hex.to_string(),
    ]
}

fn resolve_campaign_wallet_address(form: &ActionForm) -> AppResult<Option<String>> {
    let wallet_identifier = form.value("wallet_address");
    let password = form.value("password");
    let keystore_path = normalize_path(form.value("keystore_path"));

    if wallet_identifier.is_empty() && keystore_path.is_empty() {
        return Ok(None);
    }

    if !wallet_identifier.is_empty() {
        if let Ok(address) = normalize_wallet_address(wallet_identifier) {
            return Ok(Some(address));
        }
    }

    let args = build_saved_wallet_address_command(wallet_identifier, &keystore_path, password)?;
    let result = run_cast_command(&args)?;
    if !result.success {
        return Err(AppError::message(format!(
            "failed to resolve wallet address from Foundry account or keystore: {}",
            result.output.trim()
        )));
    }

    extract_wallet_address(&result.output)
        .ok_or_else(|| {
            AppError::message(
                "cast returned output, but I could not extract a wallet address from it."
                    .to_string(),
            )
        })
        .map(Some)
}

fn build_saved_wallet_address_command(
    account_name: &str,
    keystore_path: &str,
    password: &str,
) -> AppResult<Vec<String>> {
    let mut args = vec!["wallet".to_string(), "address".to_string()];

    if !keystore_path.is_empty() {
        if password.is_empty() {
            return Err(AppError::message(
                "Password is required for a saved Foundry account or keystore path.",
            ));
        }
        args.push("--keystore".to_string());
        args.push(keystore_path.to_string());
        args.push("--password".to_string());
        args.push(password.to_string());
        return Ok(args);
    }

    if !account_name.is_empty() {
        let normalized_account_name = normalize_foundry_account_name(account_name);
        if password.is_empty() {
            return Err(AppError::message(
                "Password is required for a saved Foundry account or keystore path.",
            ));
        }
        args.push("--keystore".to_string());
        args.push(format!(
            "{}/{}",
            default_foundry_keystore_dir(),
            normalized_account_name
        ));
        args.push("--password".to_string());
        args.push(password.to_string());
        return Ok(args);
    }

    Err(AppError::message(
        "Provide a private key, a saved account name, or a keystore path.",
    ))
}

fn build_saved_wallet_private_key_command(
    account_name: &str,
    keystore_path: &str,
    password: &str,
) -> AppResult<Vec<String>> {
    let mut args = vec!["wallet".to_string(), "private-key".to_string()];

    if !keystore_path.is_empty() {
        if password.is_empty() {
            return Err(AppError::message(
                "Password is required for a saved Foundry account or keystore path.",
            ));
        }
        args.push("--keystore".to_string());
        args.push(keystore_path.to_string());
        args.push("--password".to_string());
        args.push(password.to_string());
        return Ok(args);
    }

    if !account_name.is_empty() {
        if password.is_empty() {
            return Err(AppError::message(
                "Password is required for a saved Foundry account or keystore path.",
            ));
        }
        args.push("--keystore".to_string());
        args.push(format!(
            "{}/{}",
            default_foundry_keystore_dir(),
            normalize_foundry_account_name(account_name)
        ));
        args.push("--password".to_string());
        args.push(password.to_string());
        return Ok(args);
    }

    Err(AppError::message(
        "Provide a saved account name or keystore path.",
    ))
}

fn normalize_circuit_dir(raw: &str) -> AppResult<PathBuf> {
    let normalized = PathBuf::from(normalize_path(raw));
    if !normalized.exists() {
        return Err(AppError::message(format!(
            "Circuit dir does not exist: {}",
            normalized.display()
        )));
    }
    if !normalized.join("Nargo.toml").exists() {
        return Err(AppError::message(format!(
            "Circuit dir does not contain Nargo.toml: {}",
            normalized.display()
        )));
    }
    Ok(normalized)
}

fn normalize_api_base_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::message("API base URL is required."));
    }
    Ok(trimmed.to_string())
}

fn normalize_wallet_address(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.len() != 42 || !trimmed.starts_with("0x") {
        return Err(AppError::message(format!(
            "Wallet address must look like 0x followed by 40 hex characters: {trimmed}"
        )));
    }

    if !trimmed[2..]
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::message(format!(
            "Wallet address contains non-hex characters: {trimmed}"
        )));
    }

    Ok(format!("0x{}", trimmed[2..].to_ascii_lowercase()))
}

fn normalize_foundry_account_name(raw: &str) -> String {
    raw.trim()
        .strip_suffix(" (Local)")
        .unwrap_or(raw.trim())
        .trim()
        .to_string()
}

fn extract_private_key_bytes(output: &str) -> AppResult<[u8; 32]> {
    let raw = output
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("0x"))
        .ok_or_else(|| AppError::message("could not find a private key in cast output"))?;

    let bytes = parse_hex_bytes(raw, 32, "Private key")?;
    bytes
        .try_into()
        .map_err(|_| AppError::message("private key must decode to exactly 32 bytes".to_string()))
}

fn parse_hex_bytes(raw: &str, expected_len: usize, label: &str) -> AppResult<Vec<u8>> {
    let trimmed = raw.trim().trim_start_matches("0x");
    if trimmed.len() != expected_len * 2 {
        return Err(AppError::message(format!(
            "{label} must be exactly {} hex characters",
            expected_len * 2
        )));
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::message(format!(
            "{label} contains non-hex characters"
        )));
    }

    (0..expected_len)
        .map(|index| {
            let start = index * 2;
            u8::from_str_radix(&trimmed[start..start + 2], 16)
                .map_err(|_| AppError::message(format!("{label} contains invalid hex byte data")))
        })
        .collect()
}

fn format_u8_array_toml(name: &str, bytes: &[u8]) -> String {
    let body = bytes
        .iter()
        .map(|byte| format!("\"{byte}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{name} = [{body}]\n")
}

fn format_string_array_toml(name: &str, values: &[String]) -> String {
    let body = values
        .iter()
        .map(|value| format!("\"{value}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{name} = [{body}]\n")
}

fn format_field_scalar_toml(name: &str, value: &str) -> String {
    format!("{name} = \"{}\"\n", value.trim())
}

fn generate_auto_witness_secrets() -> AppResult<AutoWitnessSecrets> {
    Ok(AutoWitnessSecrets {
        message: MVP_NOIR_MESSAGE,
        stealth_tweak: MVP_NOIR_STEALTH_TWEAK,
    })
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn run_nargo_execute(circuit_dir: &Path, witness_name: &str) -> AppResult<CommandResult> {
    let output = Command::new("nargo")
        .current_dir(circuit_dir)
        .args(["execute", witness_name, "--skip-brillig-constraints-check"])
        .stdin(Stdio::null())
        .output()
        .map_err(|source| {
            AppError::command_launch(
                format!(
                    "nargo execute {} --skip-brillig-constraints-check",
                    witness_name
                ),
                source,
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = match (stdout.trim(), stderr.trim()) {
        ("", "") => "(no output)".to_string(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n\n{stderr}"),
    };

    Ok(CommandResult {
        command_preview: format!(
            "nargo execute {} --skip-brillig-constraints-check",
            witness_name
        ),
        output: combined,
        success: output.status.success(),
    })
}

fn format_saved_accounts_output(output: &str) -> String {
    let accounts = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(normalize_foundry_account_name)
        .collect::<Vec<_>>();

    if accounts.is_empty() {
        return "(no saved Foundry accounts found)".to_string();
    }

    let mut formatted = String::from("Paste one of these names into Wallet / Account:\n");
    for account in accounts {
        let _ = writeln!(formatted, "- {account}");
    }
    formatted
}

fn extract_wallet_address(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.split_whitespace().find_map(|token| {
            let candidate = token.trim_matches(|character: char| {
                matches!(character, '"' | '\'' | ',' | ';' | '(' | ')')
            });
            normalize_wallet_address(candidate).ok()
        })
    })
}

fn parse_json_response<T>(response: reqwest::blocking::Response, url: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let status = response.status();
    if !status.is_success() {
        let body = read_response_body(response);
        return Err(AppError::message(format!(
            "proof API returned {status} for {url}{}",
            format_response_body_suffix(&body)
        )));
    }

    response
        .json::<T>()
        .map_err(|source| AppError::http(format!("failed to decode JSON from {url}"), source))
}

fn read_response_body(response: reqwest::blocking::Response) -> String {
    response.text().unwrap_or_default()
}

fn format_response_body_suffix(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        String::new()
    } else {
        let single_line = trimmed.lines().next().unwrap_or(trimmed);
        format!(" | {single_line}")
    }
}

fn lookup_claim_for_campaign(
    client: &Client,
    api_base: &str,
    wallet_address: &str,
    campaign: ApiCampaignSummary,
) -> CampaignLookupResult {
    let claim_url = format!(
        "{api_base}/campaigns/{}/claim/{}",
        campaign.campaign_id, wallet_address
    );

    let claim_status = match client.get(&claim_url).send() {
        Ok(response) => match response.status() {
            status if status.is_success() => match response.json::<ApiClaimPayload>() {
                Ok(claim) => ClaimStatus::Eligible(claim),
                Err(error) => ClaimStatus::Error(format!(
                    "failed to decode claim JSON from {claim_url}: {error}"
                )),
            },
            StatusCode::NOT_FOUND => ClaimStatus::Missing,
            status => {
                let body = read_response_body(response);
                ClaimStatus::Error(format!(
                    "claim lookup returned {status}{}",
                    format_response_body_suffix(&body)
                ))
            }
        },
        Err(error) => ClaimStatus::Error(format!("request failed: {error}")),
    };

    CampaignLookupResult {
        campaign,
        claim_status,
    }
}

fn format_campaign_catalog_output(api_base: &str, campaigns: &[ApiCampaignSummary]) -> String {
    let mut output = String::new();
    let _ = writeln!(output, "API base      {}", api_base);
    let _ = writeln!(output, "Campaigns     {}", campaigns.len());

    if campaigns.is_empty() {
        let _ = writeln!(output);
        let _ = writeln!(output, "No campaigns were returned by the proof API.");
        return output;
    }

    let _ = writeln!(output);
    let _ = writeln!(
        output,
        "Add a wallet address and press Enter again to check claimability."
    );
    let _ = writeln!(output);

    for (index, campaign) in campaigns.iter().enumerate() {
        write_campaign_summary(&mut output, index, campaign);
        let _ = writeln!(output, "status        catalog only");
        let _ = writeln!(output);
    }

    output
}

fn format_filecoin_campaign_output(campaign: &ApiFilecoinCampaignResponse) -> String {
    let mut output = String::new();
    let _ = writeln!(output, "tx_hash: {}", campaign.tx_hash);
    let _ = writeln!(output, "filecoin_url: {}", campaign.filecoin_url);
    let _ = writeln!(output, "payload_version: {}", campaign.payload.version);
    let _ = writeln!(output);
    let _ = writeln!(output, "campaign_id: {}", campaign.campaign.campaign_id);
    let _ = writeln!(output, "name: {}", campaign.campaign.name);
    let _ = writeln!(
        output,
        "campaign_creator_address: {}",
        campaign.campaign.campaign_creator_address
    );
    let _ = writeln!(output, "merkle_root: {}", campaign.campaign.merkle_root);
    let _ = writeln!(output, "leaf_count: {}", campaign.campaign.leaf_count);
    let _ = writeln!(output, "depth: {}", campaign.campaign.depth);
    let _ = writeln!(
        output,
        "hash_algorithm: {}",
        campaign.campaign.hash_algorithm
    );
    let _ = writeln!(output, "leaf_encoding: {}", campaign.campaign.leaf_encoding);
    let _ = writeln!(output);
    let _ = writeln!(
        output,
        "published_recipients: {}",
        campaign.payload.recipients.len()
    );
    for (index, recipient) in campaign.payload.recipients.iter().enumerate() {
        let _ = writeln!(
            output,
            "  [{}] {} => {}",
            index, recipient.leaf_address, recipient.amount
        );
    }
    let _ = writeln!(output);
    let _ = writeln!(output, "reconstructed_claims: {}", campaign.claims.len());
    for (index, claim) in campaign.claims.iter().enumerate() {
        let _ = writeln!(
            output,
            "  [{}] {} amount={} leaf_value={} proof_len={}",
            index,
            claim.leaf_address,
            claim.amount,
            claim.leaf_value,
            claim.proof.len()
        );
    }
    output
}

fn format_single_claim_output(tx_hash: &str, claim: &ApiClaimPayload) -> String {
    let mut output = String::new();
    let _ = writeln!(output, "tx_hash: {tx_hash}");
    let _ = writeln!(output, "campaign_id: {}", claim.campaign_id);
    let _ = writeln!(output, "name: {}", claim.name);
    let _ = writeln!(
        output,
        "campaign_creator_address: {}",
        claim.campaign_creator_address
    );
    let _ = writeln!(output, "leaf_address: {}", claim.leaf_address);
    let _ = writeln!(output, "amount: {}", claim.amount);
    let _ = writeln!(output, "leaf_index: {}", claim.index);
    let _ = writeln!(output, "leaf_value: {}", claim.leaf_value);
    let _ = writeln!(output, "merkle_root: {}", claim.merkle_root);
    let _ = writeln!(output, "proof_path_len: {}", claim.proof.len());
    let _ = writeln!(
        output,
        "eligible_index: {}",
        claim.noir_inputs.eligible_index
    );
    let _ = writeln!(output, "tree_depth: {}", claim.noir_inputs.tree_depth);
    let _ = writeln!(output, "eligible_path:");
    for (path_index, item) in claim.noir_inputs.eligible_path.iter().enumerate() {
        let _ = writeln!(output, "  [{path_index}] {item}");
    }
    output
}

fn format_campaign_lookup_output(
    api_base: &str,
    wallet_address: &str,
    lookups: &[CampaignLookupResult],
) -> String {
    let mut output = String::new();
    let eligible_count = lookups
        .iter()
        .filter(|lookup| matches!(lookup.claim_status, ClaimStatus::Eligible(_)))
        .count();
    let missing_count = lookups
        .iter()
        .filter(|lookup| matches!(lookup.claim_status, ClaimStatus::Missing))
        .count();
    let error_count = lookups
        .iter()
        .filter(|lookup| matches!(lookup.claim_status, ClaimStatus::Error(_)))
        .count();

    let _ = writeln!(output, "API base      {}", api_base);
    let _ = writeln!(output, "Wallet        {}", compact_middle(wallet_address, 10, 6));
    let _ = writeln!(output, "Campaigns     {}", lookups.len());
    let _ = writeln!(output, "Eligible      {eligible_count}");
    let _ = writeln!(output, "No claim      {missing_count}");
    let _ = writeln!(output, "Errors        {error_count}");
    let _ = writeln!(output);
    let _ = writeln!(output, "Claim details come from the Rust API. Proof generation happens in Prove + Claim.");
    let _ = writeln!(output);

    for (index, lookup) in lookups.iter().enumerate() {
        write_campaign_summary(&mut output, index, &lookup.campaign);
        match &lookup.claim_status {
            ClaimStatus::Eligible(claim) => {
                let _ = writeln!(output, "status        eligible");
                let _ = writeln!(
                    output,
                    "claim_id      {}",
                    compact_middle(&claim.campaign_id, 8, 6)
                );
                if let Some(onchain_campaign_id) = claim.onchain_campaign_id.as_deref() {
                    let _ = writeln!(
                        output,
                        "onchain_id    {}",
                        compact_middle(onchain_campaign_id, 12, 8)
                    );
                }
                let _ = writeln!(
                    output,
                    "leaf          {}",
                    compact_middle(&claim.leaf_address, 10, 6)
                );
                let _ = writeln!(
                    output,
                    "creator       {}",
                    compact_middle(&claim.campaign_creator_address, 10, 6)
                );
                let _ = writeln!(output, "amount        {}", claim.amount);
                let _ = writeln!(output, "leaf_index    {}", claim.index);
                let _ = writeln!(
                    output,
                    "eligible_root {}",
                    compact_middle(&claim.noir_inputs.eligible_root, 16, 10)
                );
                let _ = writeln!(output, "proof_nodes   {}", claim.proof.len());
                let _ = writeln!(output, "tree_depth    {}", claim.noir_inputs.tree_depth);
            }
            ClaimStatus::Missing => {
                let _ = writeln!(output, "status        no claim for this wallet");
            }
            ClaimStatus::Error(message) => {
                let _ = writeln!(output, "status        lookup error");
                let _ = writeln!(output, "error         {message}");
            }
        }
        let _ = writeln!(output);
    }

    output
}

fn write_campaign_summary(output: &mut String, index: usize, campaign: &ApiCampaignSummary) {
    let _ = writeln!(output, "[{}] {}", index + 1, campaign.name);
    let _ = writeln!(
        output,
        "campaign_id   {}",
        compact_middle(&campaign.campaign_id, 8, 6)
    );
    if let Some(onchain_campaign_id) = campaign.onchain_campaign_id.as_deref() {
        let _ = writeln!(
            output,
            "onchain_id    {}",
            compact_middle(onchain_campaign_id, 12, 8)
        );
    }
    let _ = writeln!(
        output,
        "creator       {}",
        compact_middle(&campaign.campaign_creator_address, 10, 6)
    );
    let _ = writeln!(
        output,
        "merkle_root   {}",
        compact_middle(&campaign.merkle_root, 16, 10)
    );
    let _ = writeln!(output, "tree          depth {}  leaves {}", campaign.depth, campaign.leaf_count);
    let _ = writeln!(output, "hash          {}", campaign.hash_algorithm);
}

fn compact_middle(value: &str, prefix: usize, suffix: usize) -> String {
    let trimmed = value.trim();
    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= prefix + suffix + 1 {
        return trimmed.to_string();
    }

    let start = chars.iter().take(prefix).collect::<String>();
    let end = chars
        .iter()
        .rev()
        .take(suffix)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{start}…{end}")
}

fn run_cast_command(args: &[String]) -> AppResult<CommandResult> {
    run_cast_command_with_preview(args, format!("cast {}", format_command_preview(args)))
}

fn run_cast_command_with_preview(
    args: &[String],
    command_preview: impl Into<String>,
) -> AppResult<CommandResult> {
    let output = Command::new("cast")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|source| {
            AppError::command_launch(format!("cast {}", format_command_preview(args)), source)
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = match (stdout.trim(), stderr.trim()) {
        ("", "") => "(no output)".to_string(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n\n{stderr}"),
    };

    Ok(CommandResult {
        command_preview: command_preview.into(),
        output: combined,
        success: output.status.success(),
    })
}

fn format_command_preview(args: &[String]) -> String {
    let mut mask_next = false;
    args.iter()
        .map(|arg| {
            if mask_next {
                mask_next = false;
                return "<hidden>".to_string();
            }

            if matches!(
                arg.as_str(),
                "--private-key" | "--unsafe-password" | "--password"
            ) {
                mask_next = true;
            }

            if arg.contains(' ') {
                format!("\"{arg}\"")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed == "~" {
        return env::var("HOME").unwrap_or_else(|_| "~".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    trimmed.to_string()
}

fn default_foundry_keystore_dir() -> String {
    env::var("HOME")
        .map(|home| format!("{home}/.foundry/keystores"))
        .unwrap_or_else(|_| "~/.foundry/keystores".to_string())
}

fn ensure_directory_exists(path: &str) -> AppResult<()> {
    fs::create_dir_all(path).map_err(|source| {
        AppError::io(
            format!("failed to create keystore directory at {path}"),
            source,
        )
    })
}
