import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { resolveApiUrl } from "./config.js";

const CYAN = "#00ffc8";
const CYAN_DIM = "#00ddb0";
const CYAN_MID = "#00c49a";
const BG = "#020d0f";
const MUTED = "#3a6660";
const MUTED2 = "#2a5550";
const TEXT = "#cce8e4";
const MONO = "'Share Tech Mono', monospace";
const BORDER = "rgba(0,255,200,.08)";
const TREE_MAX_LEAVES = 1 << 12;

function parseErrorMessage(error) {
  if (!error) {
    return "Something went wrong.";
  }

  if (typeof error === "string") {
    return error;
  }

  return (
    error?.shortMessage ||
    error?.details ||
    error?.message ||
    error?.cause?.message ||
    "Something went wrong."
  );
}

async function readJson(response) {
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        payload?.details ||
        text ||
        `Request failed with status ${response.status}`,
    );
  }

  return payload;
}

function shortAddress(value) {
  if (!value) {
    return "NOT_CONNECTED";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function walletLabel(account, connecting) {
  if (connecting) {
    return "WALLET_<br/>CONNECTING";
  }

  if (!account) {
    return "CONNECT_<br/>WALLET";
  }

  return `${account.slice(0, 6)}<br/>${account.slice(-4)}`;
}

function PixelCat() {
  const [hov, setHov] = useState(false);
  const pixels = [
    "0011011100",
    "0111111110",
    "1111111111",
    "1010110101",
    "1111111111",
    "0111111110",
    "0101000101",
    "0101000101",
  ];

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        cursor: "pointer",
        display: "inline-block",
        transition: "transform .2s",
        transform: hov ? "scale(1.3) translateY(-2px)" : "scale(1)",
      }}
      title="=^._.^="
    >
      {pixels.map((row, rowIndex) => (
        <div key={rowIndex} style={{ display: "flex" }}>
          {row.split("").map((pixel, pixelIndex) => (
            <div
              key={pixelIndex}
              style={{
                width: 3,
                height: 3,
                background: pixel === "1" ? (hov ? CYAN : CYAN_MID) : "transparent",
                boxShadow: pixel === "1" && hov ? "0 0 4px rgba(0,255,200,.6)" : "none",
                transition: "background .2s, box-shadow .2s",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function NavLink({ label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 2,
        color: active ? TEXT : hov ? TEXT : MUTED,
        borderBottom: `2px solid ${active ? CYAN : "transparent"}`,
        paddingBottom: 4,
        cursor: "pointer",
        transition: "color .2s, border-color .2s",
      }}
    >
      {label}
    </span>
  );
}

function WalletBtn({ wallet, onConnect }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => void onConnect()}
      style={{
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: 2,
        lineHeight: 1.5,
        color: hov ? BG : CYAN,
        border: `1px solid ${CYAN}`,
        padding: "7px 16px",
        cursor: "pointer",
        textAlign: "center",
        background: hov ? CYAN : "transparent",
        boxShadow: hov ? "0 0 20px rgba(0,255,200,.5)" : "0 0 10px rgba(0,255,200,.15)",
        transition: "all .25s",
      }}
      dangerouslySetInnerHTML={{ __html: walletLabel(wallet.account, wallet.connecting) }}
    />
  );
}

function Donut({ pct }) {
  const [progress, setProgress] = useState(0);
  const size = 140;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const timer = setTimeout(() => setProgress(pct), 600);
    return () => clearTimeout(timer);
  }, [pct]);

  const offset = circumference - (progress / 100) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,255,200,.07)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={CYAN}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)",
            filter: "drop-shadow(0 0 6px rgba(0,255,200,.7))",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 22,
            color: CYAN,
            textShadow: "0 0 14px rgba(0,255,200,.7)",
          }}
        >
          {progress}%
        </div>
        <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginTop: 3 }}>
          TREE_UTILIZATION
        </div>
      </div>
    </div>
  );
}

function AnimCounter({ target, duration = 1400, delay = 700 }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let start;
    let frame;
    let alive = true;

    const timer = setTimeout(() => {
      const step = (timestamp) => {
        if (!alive) {
          return;
        }

        if (!start) {
          start = timestamp;
        }

        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.floor(eased * target));

        if (progress < 1) {
          frame = requestAnimationFrame(step);
        }
      };

      frame = requestAnimationFrame(step);
    }, delay);

    return () => {
      alive = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [delay, duration, target]);

  return <>{value.toLocaleString()}</>;
}

function ProtoCard({ label, desc, delay }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderLeft: `2px solid ${hov ? CYAN : MUTED2}`,
        paddingLeft: 14,
        marginBottom: 28,
        transition: "border-color .3s",
        animation: `fadeUp .6s ${delay}ms both`,
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 9, color: hov ? CYAN : CYAN_DIM, letterSpacing: 2, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED, lineHeight: 1.9, letterSpacing: 0.5 }}>
        {desc}
      </div>
    </div>
  );
}

function GlitchTitle({ children }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setOn(true);
      setTimeout(() => setOn(false), 120);
    }, 4500 + Math.random() * 2500);

    return () => clearInterval(interval);
  }, []);

  return <span style={{ animation: on ? "glitch .12s steps(2) both" : "none", display: "inline-block" }}>{children}</span>;
}

function BackLink({ onNavigateBack }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onNavigateBack}
      style={{
        fontFamily: MONO,
        fontSize: 8,
        letterSpacing: 2,
        color: hov ? CYAN : MUTED2,
        textDecoration: hov ? "underline" : "none",
        cursor: "pointer",
        transition: "color .2s",
        marginBottom: 40,
      }}
    >
      {"<<"} BACK TO ACTIVE REWARDS
    </div>
  );
}

function Scanline() {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 2,
        pointerEvents: "none",
        background: "linear-gradient(180deg,transparent,rgba(0,255,200,.05),transparent)",
        animation: "scanline 7s linear infinite",
      }}
    />
  );
}

function ClaimCheckPanel({ campaign, claimAddress, setClaimAddress, claimState, onSubmit }) {
  return (
    <div style={{ animation: "fadeUp .6s .8s both" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED2, letterSpacing: 2, marginBottom: 8 }}>
            ADDRESS_ELIGIBILITY_CHECK
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED, letterSpacing: 1, lineHeight: 1.8 }}>
            ENTER AN ADDRESS TO CHECK WHETHER IT CAN CLAIM THIS CAMPAIGN THROUGH THE RUST API.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <input
          value={claimAddress}
          onChange={(event) => setClaimAddress(event.target.value)}
          placeholder="0x..."
          style={{
            flex: 1,
            minWidth: 320,
            fontFamily: MONO,
            fontSize: 10,
            background: "rgba(0,255,200,.03)",
            border: `1px solid ${BORDER}`,
            color: TEXT,
            padding: "14px 16px",
            letterSpacing: 1,
          }}
        />
        <button
          onClick={onSubmit}
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 3,
            color: claimState.loading ? BG : CYAN,
            border: `1px solid ${CYAN}`,
            padding: "14px 26px",
            cursor: "pointer",
            background: claimState.loading ? CYAN : "transparent",
            boxShadow: "0 0 12px rgba(0,255,200,.15)",
            transition: "all .25s",
          }}
        >
          {claimState.loading ? "CHECKING" : "CLAIM"}
        </button>
      </div>

      {claimState.error ? (
        <div
          style={{
            marginTop: 16,
            border: "1px solid rgba(255,128,128,.22)",
            background: "rgba(72,20,24,.35)",
            padding: "14px 16px",
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 8, color: "#ff9d9d", letterSpacing: 2, marginBottom: 6 }}>
            ADDRESS_NOT_ELIGIBLE
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: "#d2a0a0", lineHeight: 1.8 }}>
            {claimState.error}
          </div>
        </div>
      ) : null}

      {claimState.payload ? (
        <div
          style={{
            marginTop: 16,
            border: `1px solid rgba(0,255,200,.22)`,
            background: "rgba(0,255,200,.04)",
            padding: "14px 16px",
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 8, color: CYAN, letterSpacing: 2, marginBottom: 8 }}>
            ADDRESS_ELIGIBLE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 4 }}>CAMPAIGN</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: TEXT, lineHeight: 1.7 }}>{campaign.name}</div>
            </div>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 4 }}>LEAF_ADDRESS</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: TEXT, lineHeight: 1.7 }}>{claimState.payload.leaf_address}</div>
            </div>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 4 }}>AMOUNT</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: TEXT, lineHeight: 1.7 }}>{claimState.payload.amount}</div>
            </div>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 4 }}>INDEX</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: TEXT, lineHeight: 1.7 }}>{claimState.payload.index}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 8, color: MUTED, lineHeight: 1.8 }}>
            CLAIM PAYLOAD IS AVAILABLE FROM <code>{campaign.campaign_id}</code>. YOU CAN NOW CONTINUE WITH THE FULL CLAIM FLOW.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function App({
  wallet,
  onConnect,
  onNavigateBack,
  onNavigatePage,
  campaignId,
  campaign,
}) {
  const [campaignData, setCampaignData] = useState(campaign);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignError, setCampaignError] = useState("");
  const [claimAddress, setClaimAddress] = useState("");
  const [claimState, setClaimState] = useState({
    loading: false,
    error: "",
    payload: null,
  });

  useEffect(() => {
    if (campaign && campaign.campaign_id === campaignId) {
      setCampaignData(campaign);
      setCampaignError("");
    }
  }, [campaign, campaignId]);

  useEffect(() => {
    if (!campaignId) {
      setCampaignData(null);
      setCampaignError("No campaign selected.");
      return;
    }

    if (campaign && campaign.campaign_id === campaignId) {
      return;
    }

    let cancelled = false;

    const loadCampaign = async () => {
      setCampaignLoading(true);
      setCampaignError("");

      try {
        const data = await readJson(await fetch(resolveApiUrl(`/campaigns/${campaignId}`)));
        if (!cancelled) {
          setCampaignData(data);
        }
      } catch (error) {
        if (!cancelled) {
          setCampaignError(parseErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setCampaignLoading(false);
        }
      }
    };

    loadCampaign();

    return () => {
      cancelled = true;
    };
  }, [campaign, campaignId]);

  const handleCheckEligibility = async () => {
    if (!campaignData) {
      return;
    }

    if (!isAddress(claimAddress.trim())) {
      setClaimState({
        loading: false,
        error: "Enter a valid EVM address to check this campaign.",
        payload: null,
      });
      return;
    }

    setClaimState({
      loading: true,
      error: "",
      payload: null,
    });

    try {
      const payload = await readJson(
        await fetch(
          resolveApiUrl(
            `/campaigns/${campaignData.campaign_id}/claim/${encodeURIComponent(claimAddress.trim())}`,
          ),
        ),
      );

      setClaimState({
        loading: false,
        error: "",
        payload,
      });
    } catch (error) {
      setClaimState({
        loading: false,
        error: parseErrorMessage(error),
        payload: null,
      });
    }
  };

  const utilization = campaignData
    ? Math.min(100, Math.round((Number(campaignData.leaf_count) / TREE_MAX_LEAVES) * 100))
    : 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:${BG}; margin:0; font-family:${MONO}; overflow-x:hidden; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:${BG}; }
        ::-webkit-scrollbar-thumb { background:#00806a; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideLeft { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideRight { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes glitch {
          0%  { clip-path:inset(20% 0 60% 0); transform:translate(-2px,0); }
          33% { clip-path:inset(60% 0 10% 0); transform:translate(2px,0); filter:hue-rotate(20deg); }
          66% { clip-path:inset(40% 0 40% 0); transform:translate(-1px,0); }
          100%{ clip-path:none; transform:translate(0); }
        }
        @keyframes scanline { 0% { top:-2px; } 100% { top:100%; } }
        @keyframes pulse {
          0%,100% { box-shadow:0 0 5px ${CYAN},0 0 12px rgba(0,255,200,.3); }
          50%     { box-shadow:0 0 10px ${CYAN},0 0 24px rgba(0,255,200,.55); }
        }
        @keyframes verifiedPop {
          0%   { transform:scale(.7); opacity:0; }
          70%  { transform:scale(1.15); }
          100% { transform:scale(1); opacity:1; }
        }
        @media (max-width: 980px) {
          .detail-body { grid-template-columns:1fr !important; }
          .detail-main { padding:24px 20px !important; }
          .detail-aside { min-height:auto !important; }
        }
      `}</style>

      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            background:
              "radial-gradient(ellipse 60% 45% at 75% 25%, rgba(0,255,200,.04) 0%, transparent 70%), radial-gradient(ellipse 40% 30% at 20% 75%, rgba(0,180,140,.025) 0%, transparent 60%)",
          }}
        />
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            backgroundImage:
              "linear-gradient(rgba(0,255,200,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.014) 1px,transparent 1px)",
            backgroundSize: "55px 55px",
            maskImage: "radial-gradient(ellipse at 70% 20%, black 15%, transparent 65%)",
          }}
        />

        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 40px",
            height: 56,
            borderBottom: `1px solid ${BORDER}`,
            background: "rgba(2,13,15,.88)",
            backdropFilter: "blur(10px)",
            position: "sticky",
            top: 0,
            zIndex: 50,
            animation: "fadeUp .5s both",
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 13, color: CYAN, letterSpacing: 3, textShadow: "0 0 14px rgba(0,255,200,.5)" }}>
            ZUS_PROTOCOL
          </span>
          <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
            {["Campaigns", "Analytics", "Vault", "Protocols"].map((label) => (
              <NavLink
                key={label}
                label={label}
                active={label === "Protocols"}
                onClick={() => {
                  if (label === "Campaigns") onNavigatePage("campaigns");
                  if (label === "Vault") onNavigatePage("vault");
                  if (label === "Protocols") onNavigatePage("protocols", campaignId);
                }}
              />
            ))}
          </div>
          <WalletBtn wallet={wallet} onConnect={onConnect} />
        </header>

        <div className="detail-body" style={{ flex: 1, display: "grid", gridTemplateColumns: "320px 1fr", position: "relative", zIndex: 1 }}>
          <aside
            className="detail-aside"
            style={{
              borderRight: `1px solid ${BORDER}`,
              padding: "40px 28px",
              background: "rgba(4,20,24,.5)",
              position: "relative",
              overflow: "hidden",
              animation: "slideLeft .6s .1s both",
              minHeight: "calc(100vh - 56px)",
            }}
          >
            <Scanline />
            <BackLink onNavigateBack={onNavigateBack} />

            <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED2, letterSpacing: 2, marginBottom: 14 }}>
              PROTOCOL_DEFINITION
            </div>
            <h2 style={{ fontFamily: MONO, fontSize: 18, color: TEXT, letterSpacing: 2, lineHeight: 1.25, marginBottom: 36, animation: "fadeUp .6s .2s both" }}>
              NODE_INTEGRITY
              <br />
              REWARDS_SCHEMA
            </h2>

            <ProtoCard
              label="ZK-PROOFS"
              desc="Zero-knowledge claim validation keeps the recipient set off the public chain surface and defers address-level eligibility checks to the Rust API."
              delay={250}
            />
            <ProtoCard
              label="MERKLE_LOOKUPS"
              desc="Each claim check resolves through the campaign-specific Merkle tree, so the detail page can tell an address whether claim payload generation is available."
              delay={380}
            />

            <div style={{ position: "absolute", bottom: 28, left: 28, right: 28, display: "flex", gap: 32, animation: "fadeIn .6s .8s both" }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 3 }}>CREATOR:</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED }}>{campaignData ? shortAddress(campaignData.campaign_creator_address) : "--"}</div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 3 }}>TREE_DEPTH:</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED }}>{campaignData?.depth ?? "--"}</div>
              </div>
            </div>
          </aside>

          <main className="detail-main" style={{ padding: "40px 44px", animation: "slideRight .6s .15s both" }}>
            {campaignLoading ? (
              <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 2 }}>
                LOADING CAMPAIGN...
              </div>
            ) : campaignError ? (
              <div style={{ fontFamily: MONO, fontSize: 10, color: "#c59696", letterSpacing: 1.5, lineHeight: 2 }}>
                {campaignError}
              </div>
            ) : campaignData ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, animation: "fadeUp .5s .3s both", flexWrap: "wrap" }}>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 8,
                      letterSpacing: 1.5,
                      color: CYAN,
                      border: `1px solid rgba(0,255,200,.35)`,
                      padding: "3px 10px",
                      background: "rgba(0,255,200,.06)",
                    }}
                  >
                    ACTIVE_CAMPAIGN
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED2, letterSpacing: 1 }}>
                    ID: {campaignData.onchain_campaign_id.slice(0, 14)}
                  </div>
                </div>

                <h1
                  style={{
                    fontFamily: MONO,
                    fontSize: "clamp(22px,3.5vw,38px)",
                    color: TEXT,
                    letterSpacing: 3,
                    marginBottom: 24,
                    lineHeight: 1.1,
                    animation: "fadeUp .6s .4s both",
                    borderBottom: `1px solid ${BORDER}`,
                    paddingBottom: 20,
                  }}
                >
                  <GlitchTitle>{campaignData.name.toUpperCase().replace(/\s+/g, "_")}</GlitchTitle>
                </h1>

                <div
                  style={{
                    border: `1px solid ${BORDER}`,
                    background: "rgba(4,20,24,.7)",
                    padding: 24,
                    marginBottom: 28,
                    position: "relative",
                    overflow: "hidden",
                    animation: "fadeUp .6s .5s both",
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, borderTop: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}` }} />
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderBottom: `2px solid ${MUTED2}`, borderRight: `2px solid ${MUTED2}` }} />

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 32, justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED2, letterSpacing: 2, marginBottom: 10 }}>
                        RECIPIENTS_PARTICIPATING
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: "clamp(36px,5vw,58px)", color: TEXT, lineHeight: 1, textShadow: "0 0 20px rgba(0,255,200,.12)" }}>
                        <AnimCounter target={Number(campaignData.leaf_count)} />
                      </div>

                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          border: `1px solid rgba(0,255,200,.2)`,
                          background: "rgba(0,255,200,.04)",
                          padding: "8px 14px",
                          marginTop: 20,
                          animation: "verifiedPop .5s .9s both",
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: CYAN_DIM,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            color: BG,
                            fontWeight: 700,
                            boxShadow: `0 0 8px rgba(0,255,200,.5)`,
                            animation: "pulse 2s ease-in-out infinite",
                          }}
                        >
                          ✓
                        </div>
                        <div>
                          <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5 }}>MERKLE_VERIFIED</div>
                          <div style={{ fontFamily: MONO, fontSize: 10, color: CYAN, letterSpacing: 1 }}>TRUE</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      <Donut pct={utilization} />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 28, animation: "fadeUp .6s .65s both" }}>
                  <div style={{ fontFamily: MONO, fontSize: 8, color: MUTED2, letterSpacing: 2, marginBottom: 12 }}>
                    CAMPAIGN_METADATA
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 5 }}>CREATOR_ADDRESS</div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: TEXT, lineHeight: 1.7 }}>{campaignData.campaign_creator_address}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 5 }}>MERKLE_ROOT</div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: CYAN, lineHeight: 1.7, wordBreak: "break-all" }}>{campaignData.merkle_root}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 5 }}>HASH_ALGORITHM</div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: TEXT, lineHeight: 1.7 }}>{campaignData.hash_algorithm}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: 7, color: MUTED2, letterSpacing: 1.5, marginBottom: 5 }}>LEAF_ENCODING</div>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: TEXT, lineHeight: 1.7 }}>{campaignData.leaf_encoding}</div>
                    </div>
                  </div>
                </div>

                <ClaimCheckPanel
                  campaign={campaignData}
                  claimAddress={claimAddress}
                  setClaimAddress={setClaimAddress}
                  claimState={claimState}
                  onSubmit={() => {
                    void handleCheckEligibility();
                  }}
                />
              </>
            ) : null}
          </main>
        </div>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "14px 40px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: MONO,
            fontSize: 8,
            color: MUTED2,
            letterSpacing: 1,
            background: "rgba(2,13,15,.8)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ color: CYAN, marginBottom: 4 }}>ZUS_PROTOCOL_CORE</div>
            <div style={{ color: "#1a4040", lineHeight: 1.9 }}>
              © 2026 ZUS PROTOCOL. CATS ARE AMAZING!
              <br />
              BUILD_2984-X | NODE_STABLE | UPTIME_99.9%
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#1a5550", fontSize: 7, letterSpacing: 2 }}>i like cats</span>
            <PixelCat />
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {["X_FEED", "DISCORD_SERVER", "GITHUB_REPO", "PRIVACY_POLICY", "NEWSLETTER_SUB"].map((item) => (
              <span
                key={item}
                style={{ color: MUTED2, cursor: "pointer", transition: "color .2s", letterSpacing: 1.5 }}
                onMouseEnter={(event) => {
                  event.target.style.color = CYAN;
                }}
                onMouseLeave={(event) => {
                  event.target.style.color = MUTED2;
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </footer>
      </div>
    </>
  );
}
