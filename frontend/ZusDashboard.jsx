import { useEffect, useState } from "react";

const CYAN = "#00ffc8";
const CYAN_DIM = "#00ddb0";
const BG = "#020d0f";
const MUTED = "#3a6660";
const MUTED2 = "#2a5550";
const TEXT = "#cce8e4";
const MONO = "'Share Tech Mono', monospace";
const BORDER = "rgba(0,255,200,.08)";
const BORDER_HOV = "rgba(0,255,200,.24)";

function shortAddress(value) {
  if (!value) {
    return "NOT_CONNECTED";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function walletLabel(account, connecting) {
  if (connecting) {
    return "WALLET_CONNECTING";
  }

  if (!account) {
    return "CONNECT_WALLET";
  }

  return `${account.slice(0, 6)}...${account.slice(-4)}`;
}

function NavLink({ label, active, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: MONO,
        fontSize: 12,
        letterSpacing: 2,
        color: active ? TEXT : hovered ? TEXT : MUTED,
        borderBottom: `2px solid ${active ? CYAN : "transparent"}`,
        paddingBottom: 6,
        cursor: "pointer",
        transition: "color .2s, border-color .2s",
      }}
    >
      {label}
    </span>
  );
}

function WalletBtn({ wallet, onConnect, className, style }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => void onConnect()}
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
        lineHeight: 1.5,
        color: hovered ? BG : CYAN,
        border: `1px solid ${CYAN}`,
        padding: "12px 22px",
        cursor: "pointer",
        textAlign: "center",
        whiteSpace: "nowrap",
        minWidth: 172,
        background: hovered ? CYAN : "transparent",
        boxShadow: hovered ? "0 0 24px rgba(0,255,200,.45)" : "0 0 12px rgba(0,255,200,.12)",
        transition: "all .25s",
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: walletLabel(wallet.account, wallet.connecting) }}
    />
  );
}

function ActionBtn({ children, outline, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
        textTransform: "uppercase",
        padding: "14px 26px",
        cursor: "pointer",
        border: "1px solid",
        transition: "all .25s",
        background: outline ? "transparent" : hovered ? CYAN : CYAN_DIM,
        color: outline ? (hovered ? CYAN : MUTED) : BG,
        borderColor: outline ? (hovered ? CYAN : "#1a4040") : hovered ? CYAN : CYAN_DIM,
        boxShadow: outline
          ? hovered
            ? "0 0 18px rgba(0,255,200,.35), inset 0 0 18px rgba(0,255,200,.04)"
            : "none"
          : hovered
            ? "0 0 24px rgba(0,255,200,.65)"
            : "0 0 12px rgba(0,255,200,.18)",
      }}
    >
      {children}
    </button>
  );
}

function MetricCard({ label, value, detail }) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        background: "rgba(4,20,24,.72)",
        padding: 22,
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 2, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: "clamp(26px,4vw,42px)", color: TEXT, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.8 }}>
        {detail}
      </div>
    </div>
  );
}

function CampaignCard({ campaign, onOpen }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => onOpen(campaign.campaign_id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? BORDER_HOV : BORDER}`,
        background: hovered ? "rgba(0,255,200,.04)" : "rgba(4,20,24,.62)",
        padding: 18,
        cursor: "pointer",
        transition: "border-color .2s, background .2s, transform .2s",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            color: CYAN,
            letterSpacing: 2,
            border: "1px solid rgba(0,255,200,.22)",
            padding: "4px 8px",
          }}
        >
          ACTIVE_CAMPAIGN
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED2, letterSpacing: 1.4 }}>
          {campaign.onchain_campaign_id}
        </span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 16, color: TEXT, letterSpacing: 2, marginBottom: 10 }}>
        {campaign.name}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.8 }}>
        {shortAddress(campaign.campaign_creator_address)} · {Number(campaign.leaf_count).toLocaleString()} recipients
      </div>
    </div>
  );
}

export default function ZusDashboard({
  wallet,
  onConnect,
  onNavigateHome,
  onNavigatePage,
  campaigns,
  campaignsLoading,
  campaignsError,
  onOpenCampaign,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const uniqueCreators = new Set(campaigns.map((campaign) => campaign.campaign_creator_address)).size;
  const recipientTotal = campaigns.reduce(
    (sum, campaign) => sum + Number(campaign.leaf_count || 0),
    0,
  );
  const recentCampaigns = campaigns.slice(0, 3);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 760) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:${BG}; margin:0; font-family:${MONO}; overflow-x:hidden; }
        .dashboard-menu-toggle, .dashboard-menu-panel { display:none; }
        @media (max-width: 920px) {
          .dashboard-main {
            padding:28px 20px 48px !important;
          }
          .dashboard-grid, .dashboard-lower {
            grid-template-columns:1fr !important;
          }
        }
        @media (max-width: 760px) {
          .dashboard-header {
            height:auto !important;
            min-height:68px !important;
            padding:14px 18px !important;
            flex-wrap:wrap !important;
            align-items:center !important;
            gap:12px !important;
          }
          .dashboard-nav, .dashboard-wallet {
            display:none !important;
          }
          .dashboard-menu-toggle {
            display:flex !important;
            align-items:center !important;
            justify-content:center !important;
            margin-left:auto !important;
          }
          .dashboard-menu-panel {
            display:grid !important;
            width:100% !important;
            gap:10px !important;
            padding-top:8px !important;
          }
        }
      `}</style>

      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: BG }}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            background:
              "radial-gradient(ellipse 58% 42% at 74% 22%, rgba(0,255,200,.04) 0%, transparent 72%), radial-gradient(ellipse 42% 32% at 18% 78%, rgba(0,180,140,.025) 0%, transparent 64%)",
          }}
        />

        <header
          className="dashboard-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 40px",
            height: 68,
            borderBottom: `1px solid ${BORDER}`,
            background: "rgba(2,13,15,.88)",
            backdropFilter: "blur(10px)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <span
            onClick={onNavigateHome}
            style={{
              fontFamily: MONO,
              fontSize: 15,
              color: CYAN,
              letterSpacing: 3,
              cursor: "pointer",
              textShadow: "0 0 14px rgba(0,255,200,.5)",
            }}
          >
            ZUS_PROTOCOL
          </span>

          <div className="dashboard-nav" style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <NavLink label="Dashboard" active onClick={() => onNavigatePage("dashboard")} />
            <NavLink label="Create Campaign" active={false} onClick={() => onNavigatePage("campaigns")} />
            <NavLink label="Rewards" active={false} onClick={() => onNavigatePage("rewards")} />
          </div>

          <button
            className="dashboard-menu-toggle"
            type="button"
            onClick={() => setMobileMenuOpen((value) => !value)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            style={{
              width: 46,
              height: 46,
              border: `1px solid ${CYAN}`,
              background: mobileMenuOpen ? "rgba(0,255,200,.12)" : "rgba(2,13,15,.88)",
              cursor: "pointer",
              flexDirection: "column",
              gap: 5,
              padding: 0,
            }}
          >
            {[0, 1, 2].map((line) => (
              <span key={line} style={{ width: 18, height: 1.5, background: CYAN }} />
            ))}
          </button>

          <WalletBtn className="dashboard-wallet" wallet={wallet} onConnect={onConnect} />
          {mobileMenuOpen ? (
            <div className="dashboard-menu-panel" style={{ width: "100%" }}>
              {[
                { label: "Home", action: onNavigateHome },
                { label: "Dashboard", action: () => onNavigatePage("dashboard") },
                { label: "Create Campaign", action: () => onNavigatePage("campaigns") },
                { label: "Rewards", action: () => onNavigatePage("rewards") },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    item.action();
                  }}
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: 2,
                    color: TEXT,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(4,20,24,.88)",
                    padding: "14px 16px",
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              ))}
              <WalletBtn
                wallet={wallet}
                onConnect={() => {
                  setMobileMenuOpen(false);
                  return onConnect();
                }}
                style={{ width: "100%", minWidth: 0 }}
              />
            </div>
          ) : null}
        </header>

        <main className="dashboard-main" style={{ flex: 1, padding: "42px 40px 60px", position: "relative", zIndex: 1 }}>
          <div
            style={{
              marginBottom: 30,
              borderLeft: `3px solid ${CYAN}`,
              paddingLeft: 20,
              boxShadow: "-10px 0 24px rgba(0,255,200,.08)",
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 11, color: CYAN_DIM, letterSpacing: 2, marginBottom: 10 }}>
              OPERATOR_DASHBOARD
            </div>
            <h1 style={{ fontFamily: MONO, fontSize: "clamp(30px,5vw,56px)", color: TEXT, letterSpacing: 4, lineHeight: 1.05, marginBottom: 12 }}>
              CONTROL THE DROP
              <br />
              WITHOUT THE LEAK
            </h1>
            <p style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 2, maxWidth: 760 }}>
              Launch campaigns, inspect active rewards, and jump directly into campaign intelligence from one operator surface.
            </p>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 32 }}>
            <ActionBtn onClick={() => onNavigatePage("campaigns")}>Create Campaign</ActionBtn>
            <ActionBtn outline onClick={() => onNavigatePage("rewards")}>Open Rewards</ActionBtn>
          </div>

          <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginBottom: 32 }}>
            <MetricCard
              label="LIVE_CAMPAIGNS"
              value={campaignsLoading ? "..." : campaigns.length.toLocaleString()}
              detail="Every active campaign pulled from the Rust API stream."
            />
            <MetricCard
              label="TOTAL_RECIPIENTS"
              value={campaignsLoading ? "..." : recipientTotal.toLocaleString()}
              detail="Leaf count across the currently returned reward sets."
            />
            <MetricCard
              label="ACTIVE_CREATORS"
              value={campaignsLoading ? "..." : uniqueCreators.toLocaleString()}
              detail="Unique creator wallets currently represented in the dashboard."
            />
          </div>

          <div className="dashboard-lower" style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 16 }}>
            <section
              style={{
                border: `1px solid ${BORDER}`,
                background: "rgba(4,20,24,.72)",
                padding: 24,
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 11, color: CYAN_DIM, letterSpacing: 2, marginBottom: 10 }}>
                RECENT_ACTIVE_CAMPAIGNS
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {!campaignsLoading && campaignsError ? (
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#c79696", lineHeight: 1.8 }}>
                    {campaignsError}
                  </div>
                ) : null}
                {campaignsLoading ? (
                  <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.8 }}>
                    LOADING CAMPAIGNS...
                  </div>
                ) : null}
                {!campaignsLoading && !campaignsError && recentCampaigns.length === 0 ? (
                  <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.8 }}>
                    NO ACTIVE CAMPAIGNS YET. CREATE THE FIRST ONE FROM THE CAMPAIGN WORKBENCH.
                  </div>
                ) : null}
                {recentCampaigns.map((campaign) => (
                  <CampaignCard key={campaign.campaign_id} campaign={campaign} onOpen={onOpenCampaign} />
                ))}
              </div>
            </section>

            <section
              style={{
                border: `1px solid ${BORDER}`,
                background: "rgba(4,20,24,.72)",
                padding: 24,
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 11, color: CYAN_DIM, letterSpacing: 2, marginBottom: 14 }}>
                QUICK_GUIDE
              </div>
              <div style={{ display: "grid", gap: 16 }}>
                {[
                  "1. Open CREATE CAMPAIGN to post recipients and fund the onchain drop.",
                  "2. Open REWARDS to inspect all live campaigns and choose one for details.",
                  "3. Select a campaign card to open the campaign info screen and eligibility checks.",
                ].map((step) => (
                  <div
                    key={step}
                    style={{
                      borderLeft: `2px solid ${CYAN_DIM}`,
                      paddingLeft: 12,
                      fontFamily: MONO,
                      fontSize: 11,
                      color: MUTED,
                      lineHeight: 1.9,
                    }}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "24px 20px 30px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 11,
            color: MUTED2,
            letterSpacing: 1.2,
            background: "rgba(2,13,15,.82)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ color: CYAN, letterSpacing: 2 }}>ZUS_PROTOCOL_CORE</div>
          <div style={{ lineHeight: 1.9 }}>
            © 2026 ZUS PROTOCOL. ALL RIGHTS RESERVED.
            <br />
            DASHBOARD · WALLET {shortAddress(wallet.account)}
          </div>
          <div style={{ color: MUTED, letterSpacing: 1.5 }}>RUST_API · FILECOIN · STARKNET</div>
        </footer>
      </div>
    </>
  );
}
