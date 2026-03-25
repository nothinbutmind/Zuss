import { useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  isAddress,
  parseEther,
  stringToHex,
  toHex,
} from "viem";
import { appConfig, getCreateCampaignConfigErrors, resolveApiUrl } from "./config.js";
import { zusProtocolAbi } from "./zusProtocolAbi.js";
import { demoCampaigns } from "./demoCampaigns.js";

const CYAN = "#00ffc8";
const CYAN_DIM = "#00ddb0";
const CYAN_MID = "#00c49a";
const BG = "#020d0f";
const MUTED = "#3a6660";
const MUTED2 = "#2a5550";
const TEXT = "#cce8e4";
const MONO = "'Share Tech Mono', monospace";
const BORDER = "rgba(0,255,200,.08)";
const BORDER_HOV = "rgba(0,255,200,.25)";
const TREE_MAX_LEAVES = 1 << 12;
const FLOW_EVM_TESTNET_EXPLORER_SITE_URL = "https://evm-testnet.flowscan.io/";
const EMPTY_CREATE_STATE = {
  loading: false,
  error: "",
  success: "",
  txHash: "",
  apiCampaign: null,
};
const SAMPLE_RECIPIENTS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266,1";
const flowEvmChain = {
  id: appConfig.chainId,
  name: appConfig.networkName,
  nativeCurrency: {
    name: "Flow",
    symbol: "FLOW",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [appConfig.rpcUrl] },
    public: { http: [appConfig.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: "Flow EVM Explorer",
      url: appConfig.explorerSiteUrl || FLOW_EVM_TESTNET_EXPLORER_SITE_URL,
    },
  },
  testnet: appConfig.chainId !== 747,
};

function shortAddress(value) {
  if (!value) {
    return "NOT_CONNECTED";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortHash(value) {
  if (!value) {
    return "";
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

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

function parseRecipients(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("Add at least one recipient row using address,amount.");
  }

  return lines.map((line, index) => {
    const parts = line
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length !== 2) {
      throw new Error(`Recipient row ${index + 1} must be "address,amount".`);
    }

    const [leafAddress, amount] = parts;
    if (!isAddress(leafAddress)) {
      throw new Error(`Recipient row ${index + 1} has an invalid EVM address.`);
    }

    if (!/^[0-9]+$/.test(amount)) {
      throw new Error(`Recipient row ${index + 1} amount must be a base-10 integer.`);
    }

    return {
      leaf_address: leafAddress,
      amount,
    };
  });
}

function parseAvaxAmount(value, label) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a FLOW amount like 0.1 or 1.`);
  }

  const wei = parseEther(trimmed);
  if (wei <= 0n) {
    throw new Error(`${label} must be greater than 0 FLOW.`);
  }

  return {
    avax: trimmed,
    wei: wei.toString(),
  };
}

function makeExplorerUrl(hash) {
  if (!hash || !appConfig.explorerBaseUrl) {
    return "";
  }

  const base = appConfig.explorerBaseUrl.endsWith("/")
    ? appConfig.explorerBaseUrl
    : `${appConfig.explorerBaseUrl}/`;

  return `${base}${hash}`;
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

function Btn({ children, outline, small, onClick, disabled }) {
  const [hov, setHov] = useState(false);
  const base = {
    fontFamily: MONO,
    fontSize: small ? 9 : 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    padding: small ? "7px 16px" : "11px 24px",
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid",
    transition: "all .25s",
    opacity: disabled ? 0.4 : 1,
  };

  if (outline) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => !disabled && setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          ...base,
          background: "transparent",
          color: hov ? CYAN : MUTED,
          borderColor: hov ? CYAN : "#1a4040",
          boxShadow: hov
            ? "0 0 18px rgba(0,255,200,.35),inset 0 0 18px rgba(0,255,200,.04)"
            : "none",
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => !disabled && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...base,
        background: hov ? CYAN : CYAN_DIM,
        color: BG,
        borderColor: hov ? CYAN : CYAN_DIM,
        fontWeight: 700,
        boxShadow: hov
          ? "0 0 24px rgba(0,255,200,.7),0 0 48px rgba(0,255,200,.3)"
          : "0 0 10px rgba(0,255,200,.2)",
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 18,
        borderRadius: 9,
        background: on ? "rgba(0,255,200,.2)" : "rgba(0,255,200,.05)",
        border: `1px solid ${on ? CYAN_DIM : BORDER}`,
        position: "relative",
        cursor: "pointer",
        transition: "all .3s",
        boxShadow: on ? "0 0 10px rgba(0,255,200,.3)" : "none",
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: on ? CYAN : MUTED2,
          position: "absolute",
          top: 2,
          left: on ? 20 : 2,
          transition: "left .3s, background .3s",
          boxShadow: on ? "0 0 6px rgba(0,255,200,.8)" : "none",
        }}
      />
    </div>
  );
}

function useTypewriter(text, speed = 22, delay = 0) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let index = 0;
    let alive = true;

    const timer = setTimeout(function tick() {
      if (!alive) {
        return;
      }

      if (index <= text.length) {
        setOut(text.slice(0, index));
        index += 1;
        setTimeout(tick, speed);
      } else {
        setDone(true);
      }
    }, delay);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [delay, speed, text]);

  return { out, done };
}

function JsonPanel({ campaignName, instant, merkle, payoutAvax, fundingAvax, recipients }) {
  const sampleRecipients = recipients.slice(0, 2);
  const previewRecipients =
    sampleRecipients.length > 0
      ? sampleRecipients.map((recipient) => ({
          address: recipient.leaf_address,
          amount: recipient.amount,
        }))
      : [
          { address: "0xf39fd6...2266", amount: "1" },
          { address: "0x709979...79c8", amount: "1" },
        ];

  const payoutWei = parseEther(payoutAvax || appConfig.defaultPayoutAvax).toString();
  const fundingWei = parseEther(fundingAvax || appConfig.defaultFundingAvax).toString();
  const dynamic = `{
  "name": "${campaignName || "ZUS_AIRDROP_PROXIMA"}",
  "network": "${appConfig.networkName}",
  "instant_release": ${instant},
  "merkle_verified": ${merkle},
  "payout_avax": "${payoutAvax || appConfig.defaultPayoutAvax}",
  "funding_avax": "${fundingAvax || appConfig.defaultFundingAvax}",
  "payout_wei": "${payoutWei}",
  "funding_wei": "${fundingWei}",
  "recipients": ${JSON.stringify(previewRecipients, null, 2)}
}`;

  const { out, done } = useTypewriter(dynamic, 10, 250);

  const colorize = (value) =>
    value.split("\n").map((line, lineIndex) => {
      const parts = line.split(/(".*?")/g);

      return (
        <div key={lineIndex}>
          {parts.map((part, partIndex) => {
            if (part.startsWith('"') && part.endsWith('"')) {
              if (part.includes("0x") || part.includes("ZUS")) {
                return (
                  <span key={partIndex} style={{ color: CYAN }}>
                    {part}
                  </span>
                );
              }

              return (
                <span key={partIndex} style={{ color: CYAN_DIM }}>
                  {part}
                </span>
              );
            }

            if (part === "true" || part === "false") {
              return (
                <span key={partIndex} style={{ color: part === "true" ? CYAN : MUTED }}>
                  {part}
                </span>
              );
            }

            return (
              <span key={partIndex} style={{ color: MUTED }}>
                {part}
              </span>
            );
          })}
        </div>
      );
    });

  return (
    <div
      style={{
        background: "rgba(0,255,200,.02)",
        border: `1px solid ${BORDER}`,
        padding: 16,
        fontFamily: MONO,
        fontSize: 10.5,
        lineHeight: 1.9,
        position: "relative",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ color: MUTED2, letterSpacing: 2, fontSize: 9 }}>CAMPAIGN_PAYLOAD.JSON</span>
        <div style={{ display: "flex", gap: 5 }}>
          {["#ff6060", "#ffb740", "#00ffc8"].map((color, index) => (
            <div
              key={index}
              style={{ width: 8, height: 8, borderRadius: "50%", background: color, opacity: 0.7 }}
            />
          ))}
        </div>
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {colorize(out)}
        {!done ? <span style={{ animation: "cur .7s steps(1) infinite", color: CYAN }}>▋</span> : null}
      </div>
    </div>
  );
}

function EgressBar({ pct, live }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setWidth(pct), 300);
    return () => clearTimeout(timer);
  }, [pct]);

  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED2, letterSpacing: 1 }}>TREE_USAGE</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: live ? CYAN : MUTED, letterSpacing: 1 }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 2, background: "rgba(0,255,200,.07)", borderRadius: 1 }}>
        <div
          style={{
            height: "100%",
            width: `${width}%`,
            background: live
              ? `linear-gradient(90deg,${CYAN_DIM},${CYAN})`
              : `linear-gradient(90deg,${MUTED2},${MUTED})`,
            borderRadius: 1,
            transition: "width 1.2s cubic-bezier(.4,0,.2,1)",
            boxShadow: live && width > 0 ? "0 0 6px rgba(0,255,200,.5)" : "none",
          }}
        />
      </div>
    </div>
  );
}

function CampaignRow({ campaign, delay = 0, onOpen }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  const egress = Number(((campaign.leaf_count / TREE_MAX_LEAVES) * 100).toFixed(1));
  const live = campaign.leaf_count > 0;

  return (
    <div
      ref={ref}
      onClick={() => onOpen?.(campaign.campaign_id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        border: `1px solid ${hovered ? BORDER_HOV : BORDER}`,
        background: hovered ? "rgba(0,255,200,.02)" : "transparent",
        padding: "18px 20px",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(20px)",
        transition: `opacity .5s ${delay}ms, transform .5s ${delay}ms, border-color .25s, background .25s`,
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: `linear-gradient(90deg,transparent,${CYAN},transparent)`,
          opacity: hovered ? 1 : 0,
          transition: "opacity .3s",
        }}
      />
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: live ? CYAN : MUTED2,
          flexShrink: 0,
          boxShadow: live ? `0 0 8px ${CYAN},0 0 16px rgba(0,255,200,.4)` : "none",
          animation: live ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9,
          color: live ? CYAN : MUTED,
          border: `1px solid ${live ? "rgba(0,255,200,.3)" : BORDER}`,
          padding: "2px 8px",
          letterSpacing: 1.5,
          flexShrink: 0,
          minWidth: 48,
          textAlign: "center",
        }}
      >
        {live ? "LIVE" : "EMPTY"}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED2, minWidth: 72 }}>
        {campaign.campaign_id.slice(0, 8)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            color: TEXT,
            letterSpacing: 2,
            marginBottom: 3,
          }}
        >
          {campaign.name}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 9,
            color: MUTED2,
            letterSpacing: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortAddress(campaign.campaign_creator_address)} · {campaign.onchain_campaign_id}
        </div>
      </div>
      <div style={{ minWidth: 80, textAlign: "right" }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED2, letterSpacing: 1, marginBottom: 2 }}>
          RECIPIENTS
        </div>
        <div style={{ fontFamily: MONO, fontSize: 14, color: TEXT }}>
          {campaign.leaf_count.toLocaleString()}
        </div>
      </div>
      <div style={{ minWidth: 140 }}>
        <EgressBar pct={egress} live={live} />
      </div>
      <div
        style={{
          color: hovered ? CYAN : MUTED2,
          fontFamily: MONO,
          fontSize: 14,
          transition: "color .25s, transform .25s",
          transform: hovered ? "translateX(3px)" : "translateX(0)",
        }}
      >
        ›
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  const [hovered, setHovered] = useState(false);
  const highlighted = active || hovered;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        cursor: "pointer",
        position: "relative",
        background: active ? "rgba(0,255,200,.05)" : hovered ? "rgba(0,255,200,.02)" : "transparent",
        borderRight: active ? `2px solid ${CYAN}` : "2px solid transparent",
        transition: "all .2s",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: highlighted ? CYAN : MUTED2,
          textShadow: active ? "0 0 8px rgba(0,255,200,.5)" : "none",
          transition: "color .2s",
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: highlighted ? TEXT : MUTED2,
          letterSpacing: 2,
          transition: "color .2s",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function EmptyCampaignState({ loading, error }) {
  return (
    <div
      style={{
        border: `1px dashed ${BORDER}`,
        padding: "18px 20px",
        fontFamily: MONO,
        fontSize: 10,
        color: error ? "#c28f8f" : MUTED,
        lineHeight: 1.9,
      }}
    >
      {loading
        ? "SYNCING CAMPAIGNS FROM RUST API..."
        : error || "NO CAMPAIGNS RETURNED YET. CREATE ONE ABOVE AND IT WILL APPEAR HERE."}
    </div>
  );
}

function StatusMessage({ createState, pendingDeployment }) {
  const explorerUrl = makeExplorerUrl(createState.txHash);
  const filecoinUrl = createState.apiCampaign?.filecoin_url || "";

  if (createState.error) {
    return (
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          border: "1px solid rgba(255,132,132,.22)",
          background: "rgba(66,20,24,.4)",
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 10, color: "#ff9f9f", letterSpacing: 2, marginBottom: 4 }}>
          [CREATE_FLOW_ERROR]
        </div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: "#c79696", letterSpacing: 1, lineHeight: 1.8 }}>
          {createState.error}
        </div>
      </div>
    );
  }

  if (!createState.success && !pendingDeployment) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        border: `1px solid ${pendingDeployment ? "rgba(255,198,120,.22)" : "rgba(0,255,200,.25)"}`,
        background: pendingDeployment ? "rgba(86,54,16,.18)" : "rgba(0,255,200,.04)",
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 10, color: pendingDeployment ? "#ffca80" : CYAN_DIM, letterSpacing: 2, marginBottom: 4 }}>
        {pendingDeployment ? "[PENDING_ONCHAIN_DEPLOYMENT]" : "[CAMPAIGN_CLUSTER_INITIALIZED]"}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED, letterSpacing: 1, lineHeight: 1.8 }}>
        {createState.success || "Rust API step complete. Finish the wallet transaction."}
        {createState.apiCampaign ? (
          <>
            <br />
            API: {createState.apiCampaign.campaign_id} · ONCHAIN: {createState.apiCampaign.onchain_campaign_id}
          </>
        ) : null}
        {createState.txHash ? (
          <>
            <br />
            {explorerUrl ? (
              <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ color: CYAN }}>
                FLOW: {shortHash(createState.txHash)}
              </a>
            ) : (
              <>FLOW: {shortHash(createState.txHash)}</>
            )}
          </>
        ) : null}
        {filecoinUrl ? (
          <>
            <br />
            <a href={filecoinUrl} target="_blank" rel="noreferrer" style={{ color: CYAN }}>
              FILECOIN: OPEN REGISTRY LINK
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function ZusCampaigns({ wallet, onConnect, onNavigateHome, onNavigatePage }) {
  const [active, setActive] = useState("CREATE CAMPAIGN");
  const [campaignName, setCampaignName] = useState("");
  const [instant, setInstant] = useState(true);
  const [merkle, setMerkle] = useState(true);
  const [walletHov, setWalletHov] = useState(false);
  const [payoutAvax, setPayoutAvax] = useState(appConfig.defaultPayoutAvax);
  const [fundingAvax, setFundingAvax] = useState(appConfig.defaultFundingAvax);
  const [recipientText, setRecipientText] = useState(SAMPLE_RECIPIENTS);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [createState, setCreateState] = useState(EMPTY_CREATE_STATE);
  const [pendingDeployment, setPendingDeployment] = useState(null);

  const navItems = [
    { icon: "▦", label: "DASHBOARD", route: "dashboard" },
    { icon: "◎", label: "CREATE CAMPAIGN", route: "campaigns" },
    { icon: "▣", label: "REWARDS", route: "rewards" },
  ];

  const parsedRecipientsForPreview = (() => {
    try {
      return parseRecipients(recipientText);
    } catch {
      return [];
    }
  })();

  useEffect(() => {
    let cancelled = false;

    const loadCampaigns = async () => {
      setCampaignsLoading(true);
      setCampaignsError("");

      try {
        const data = await readJson(await fetch(resolveApiUrl("/campaigns")));
        if (!cancelled) {
          const liveCampaigns = Array.isArray(data)
            ? data.filter((campaign) => Number(campaign.leaf_count) > 0)
            : [];
          setCampaigns(liveCampaigns.length > 0 ? liveCampaigns : demoCampaigns);
        }
      } catch {
        if (!cancelled) {
          setCampaigns(demoCampaigns);
          setCampaignsError("");
        }
      } finally {
        if (!cancelled) {
          setCampaignsLoading(false);
        }
      }
    };

    loadCampaigns();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  const resetCreateForm = () => {
    setCampaignName("");
    setInstant(true);
    setMerkle(true);
    setPayoutAvax(appConfig.defaultPayoutAvax);
    setFundingAvax(appConfig.defaultFundingAvax);
    setRecipientText(SAMPLE_RECIPIENTS);
  };

  const validateCreateInput = async () => {
    const configErrors = getCreateCampaignConfigErrors();
    if (configErrors.length > 0) {
      throw new Error(`Missing config: ${configErrors.join(", ")}`);
    }

    const trimmedName = campaignName.trim();
    if (!trimmedName) {
      throw new Error("Campaign name is required.");
    }

    const payout = parseAvaxAmount(payoutAvax, "Payout FLOW");
    const funding = parseAvaxAmount(fundingAvax, "Funding FLOW");

    const recipients = parseRecipients(recipientText);
    const creatorAddress = wallet.account;

    if (!creatorAddress || !isAddress(creatorAddress)) {
      throw new Error("Press CONNECT WALLET before creating campaigns.");
    }

    if (BigInt(funding.wei) < BigInt(payout.wei)) {
      throw new Error("Funding FLOW must cover at least one payout.");
    }

    return {
      name: trimmedName,
      payoutAvax: payout.avax,
      fundingAvax: funding.avax,
      payoutWei: payout.wei,
      fundingWei: funding.wei,
      recipients,
      creatorAddress,
    };
  };

  const ensureFlowEvmNetwork = async () => {
    if (!window.ethereum?.request) {
      throw new Error("No injected wallet found for the Flow EVM transaction.");
    }

    const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
    const currentChainId = chainIdHex ? Number.parseInt(chainIdHex, 16) : 0;

    if (currentChainId === appConfig.chainId) {
      return;
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: appConfig.chainHexId }],
      });
    } catch (error) {
      if (error?.code !== 4902) {
        throw error;
      }

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
              chainId: appConfig.chainHexId,
              chainName: appConfig.networkName,
              nativeCurrency: {
              name: "Flow",
              symbol: "FLOW",
              decimals: 18,
            },
            rpcUrls: [appConfig.rpcUrl],
            blockExplorerUrls: [appConfig.explorerSiteUrl || FLOW_EVM_TESTNET_EXPLORER_SITE_URL],
          },
        ],
      });
    }
  };

  const deployOnchainCampaign = async (deployment) => {
    if (!window.ethereum?.request) {
      throw new Error("No injected wallet found for the contract transaction.");
    }

    const account = wallet.account;
    if (!account) {
      throw new Error("Press CONNECT WALLET before deploying the onchain campaign.");
    }

    setCreateState({
      loading: true,
      error: "",
      success: `Rust API campaign ready. Switching to ${appConfig.networkName} and waiting for wallet signature...`,
      txHash: "",
      apiCampaign: deployment.apiCampaign,
    });

    await ensureFlowEvmNetwork();

    const walletClient = createWalletClient({
      chain: flowEvmChain,
      transport: custom(window.ethereum),
    });

    const txHash = await walletClient.sendTransaction({
      account,
      chain: flowEvmChain,
      to: appConfig.protocolAddress,
      value: BigInt(deployment.fundingWei),
      data: encodeFunctionData({
        abi: zusProtocolAbi,
        functionName: "createCampaign",
        args: [
          deployment.apiCampaign.onchain_campaign_id,
          appConfig.verifierAddress,
          toHex(BigInt(deployment.apiCampaign.merkle_root), { size: 32 }),
          stringToHex(appConfig.campaignMessage, { size: 8 }),
          BigInt(deployment.payoutWei),
        ],
      }),
    });

    setCreateState({
      loading: true,
      error: "",
      success: "Transaction submitted. Waiting for RPC confirmation...",
      txHash,
      apiCampaign: deployment.apiCampaign,
    });

    const publicClient = createPublicClient({
      chain: flowEvmChain,
      transport: http(appConfig.rpcUrl),
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    setPendingDeployment(null);
    setCreateState({
      loading: false,
      error: "",
      success: "Campaign created in the Rust API and confirmed onchain.",
      txHash,
      apiCampaign: deployment.apiCampaign,
    });
    resetCreateForm();
    setRefreshNonce((value) => value + 1);
  };

  const handleCreate = async () => {
    setCreateState((current) => ({
      ...current,
      error: "",
      success: current.loading ? current.success : "",
      txHash: current.loading ? current.txHash : "",
    }));

    if (pendingDeployment) {
      try {
        await deployOnchainCampaign(pendingDeployment);
      } catch (error) {
        setCreateState({
          loading: false,
          error: `${parseErrorMessage(error)} The Rust API campaign still exists, so use CREATE CAMPAIGN again to finish the onchain step.`,
          success: "",
          txHash: "",
          apiCampaign: pendingDeployment.apiCampaign,
        });
      }
      return;
    }

    let deployment = null;

    try {
      const validated = await validateCreateInput();

      setCreateState({
        loading: true,
        error: "",
        success: "Creating campaign in the Rust API...",
        txHash: "",
        apiCampaign: null,
      });

      const apiCampaign = await readJson(
        await fetch(resolveApiUrl("/campaigns"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: validated.name,
            campaign_creator_address: validated.creatorAddress,
            recipients: validated.recipients,
          }),
        }),
      );

      deployment = {
        apiCampaign,
        payoutAvax: validated.payoutAvax,
        fundingAvax: validated.fundingAvax,
        payoutWei: validated.payoutWei,
        fundingWei: validated.fundingWei,
      };

      setPendingDeployment(deployment);
      await deployOnchainCampaign(deployment);
    } catch (error) {
      const detail = parseErrorMessage(error);
      setCreateState({
        loading: false,
        error: deployment
          ? `${detail} Rust API campaign ${deployment.apiCampaign.campaign_id} was created, but the contract transaction did not finish. Resume with CREATE CAMPAIGN.`
          : detail,
        success: "",
        txHash: "",
        apiCampaign: deployment?.apiCampaign || null,
      });
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:${BG}; margin:0; overflow-x:hidden; font-family:${MONO}; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:${BG}; }
        ::-webkit-scrollbar-thumb { background:#00806a; }
        input, textarea { outline:none; }
        button { outline:none; }
        @keyframes cur { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-14px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse {
          0%,100% { box-shadow:0 0 6px ${CYAN},0 0 12px rgba(0,255,200,.3); }
          50%      { box-shadow:0 0 12px ${CYAN},0 0 28px rgba(0,255,200,.6); }
        }
        @keyframes scanline {
          0%   { top:-2px; }
          100% { top:100%; }
        }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes successPop {
          0%   { transform:scale(.9); opacity:0; }
          60%  { transform:scale(1.04); opacity:1; }
          100% { transform:scale(1); }
        }
        @media (max-width: 1080px) {
          .campaign-shell { flex-direction:column !important; }
          .campaign-sidebar { width:100% !important; }
          .campaign-main { width:100% !important; }
          .campaign-form-grid { grid-template-columns:1fr !important; }
        }
        @media (max-width: 760px) {
          .campaign-header { padding:0 18px !important; height:auto !important; min-height:64px; flex-direction:column !important; align-items:flex-start !important; gap:12px !important; padding-top:14px !important; padding-bottom:14px !important; }
          .campaign-content { padding:24px 18px !important; }
          .campaign-card-grid { grid-template-columns:1fr !important; }
          .campaign-row { flex-direction:column !important; align-items:flex-start !important; }
        }
      `}</style>

      <div className="campaign-shell" style={{ display: "flex", minHeight: "100vh", background: BG }}>
        <aside
          className="campaign-sidebar"
          style={{
            width: 196,
            flexShrink: 0,
            background: "rgba(4,20,24,.95)",
            borderRight: `1px solid ${BORDER}`,
            display: "flex",
            flexDirection: "column",
            animation: "slideIn .5s .1s both",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 2,
              background: "linear-gradient(180deg,transparent,rgba(0,255,200,.06),transparent)",
              animation: "scanline 6s linear infinite",
              pointerEvents: "none",
            }}
          />

          <div
            style={{ padding: "20px 16px 24px", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}
            onClick={onNavigateHome}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                color: CYAN,
                letterSpacing: 3,
                textShadow: "0 0 14px rgba(0,255,200,.5)",
              }}
            >
              ZUS_PROTOCOL
            </div>
          </div>

          <div style={{ flex: 1, paddingTop: 12 }}>
            {navItems.map((item) => (
              <NavItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                active={active === item.label}
                onClick={() => {
                  setActive(item.label);
                  onNavigatePage(item.route);
                }}
              />
            ))}
          </div>

          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12, paddingBottom: 16 }}>
            <NavItem icon="◈" label="HOME" active={false} onClick={onNavigateHome} />
            <NavItem icon="?" label="SUPPORT" active={false} onClick={() => {}} />
          </div>

          <div
            style={{
              padding: "8px 16px 16px",
              fontFamily: MONO,
              fontSize: 9,
              color: MUTED2,
              letterSpacing: 1,
              lineHeight: 1.8,
            }}
          >
            ZUS_PROTOCOL_CORE
            <br />
            <span style={{ color: "#1a4040" }}>© 2026 ZUS PROTOCOL. CATS ARE AMAZING!</span>
            <br />
            <span style={{ color: "#1a4040" }}>API_SYNC | CONTRACT_HANDOFF | NODE_STABLE</span>
          </div>
        </aside>

        <div className="campaign-main" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <header
            className="campaign-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 32px",
              height: 64,
              borderBottom: `1px solid ${BORDER}`,
              background: "rgba(2,13,15,.6)",
              backdropFilter: "blur(8px)",
              animation: "fadeUp .5s both",
              position: "sticky",
              top: 0,
              zIndex: 50,
            }}
          >
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
              {["Dashboard", "Create Campaign", "Rewards"].map((tab) => {
                const isActive = tab === "Create Campaign";

                return (
                  <div
                    key={tab}
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      letterSpacing: 2,
                      color: isActive ? TEXT : MUTED,
                      padding: "0 22px",
                      height: 64,
                      display: "flex",
                      alignItems: "center",
                      borderBottom: isActive ? `2px solid ${CYAN}` : "2px solid transparent",
                      cursor: "pointer",
                      transition: "color .2s",
                    }}
                    onClick={() => {
                      if (tab === "Dashboard") {
                        onNavigatePage("dashboard");
                      }
                      if (tab === "Create Campaign") {
                        onNavigatePage("campaigns");
                      }
                      if (tab === "Rewards") {
                        onNavigatePage("rewards");
                      }
                    }}
                  >
                    {tab}
                  </div>
                );
              })}
            </div>

            <div
              onMouseEnter={() => setWalletHov(true)}
              onMouseLeave={() => setWalletHov(false)}
              onClick={() => void onConnect()}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: 2,
                color: walletHov ? BG : CYAN,
                border: `1px solid ${CYAN}`,
                padding: "12px 22px",
                cursor: "pointer",
                background: walletHov ? CYAN : "transparent",
                boxShadow: walletHov ? "0 0 20px rgba(0,255,200,.5)" : "0 0 10px rgba(0,255,200,.15)",
                transition: "all .25s",
                textAlign: "center",
                whiteSpace: "nowrap",
                minWidth: 172,
                lineHeight: 1.2,
              }}
              dangerouslySetInnerHTML={{ __html: walletLabel(wallet.account, wallet.connecting) }}
            />
          </header>

          <main className="campaign-content" style={{ flex: 1, padding: "36px 40px", overflowY: "auto" }}>
            <div
              style={{
                position: "fixed",
                inset: 0,
                pointerEvents: "none",
                zIndex: 0,
                background: "radial-gradient(ellipse 50% 40% at 70% 30%, rgba(0,255,200,.03) 0%, transparent 70%)",
              }}
            />

            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ animation: "fadeUp .6s .2s both" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: CYAN_DIM, letterSpacing: 2, marginBottom: 8 }}>
                  ENTRY: 0X00_INIT
                </div>
                <h1 style={{ fontFamily: MONO, fontSize: "clamp(22px,3vw,34px)", color: TEXT, letterSpacing: 3, marginBottom: 12 }}>
                  CREATE CAMPAIGN_
                </h1>
                <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED2, letterSpacing: 1.2, lineHeight: 1.9, marginBottom: 28 }}>
                  GET /campaigns READS THE LIVE RUST API STREAM. CREATE CAMPAIGN POSTS TO THE API FIRST,
                  THEN SWITCHES TO {appConfig.networkName.toUpperCase()} AND CALLS THE ZUSPROTOCOL CONTRACT.
                </div>
              </div>

              <div
                style={{
                  border: `1px solid ${BORDER}`,
                  background: "rgba(4,20,24,.7)",
                  padding: 28,
                  marginBottom: 40,
                  animation: "fadeUp .6s .35s both",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 1,
                    background: `linear-gradient(90deg,transparent,${CYAN},transparent)`,
                    top: 0,
                    opacity: 0.4,
                  }}
                />

                <div className="campaign-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
                  <div>
                    <div style={{ marginBottom: 28 }}>
                      <label style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 2, display: "block", marginBottom: 10 }}>
                        NAME
                      </label>
                      <input
                        value={campaignName}
                        onChange={(event) => setCampaignName(event.target.value.toUpperCase())}
                        placeholder="ZUS_AIRDROP_PROXIMA"
                        maxLength={64}
                        style={{
                          width: "100%",
                          fontFamily: MONO,
                          fontSize: 13,
                          background: "rgba(0,255,200,.03)",
                          border: `1px solid ${campaignName ? CYAN_DIM : BORDER}`,
                          color: TEXT,
                          padding: "14px 16px",
                          letterSpacing: 2,
                          boxShadow: campaignName ? "0 0 12px rgba(0,255,200,.1)" : "none",
                          transition: "border-color .3s, box-shadow .3s",
                        }}
                      />
                      <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 1, marginTop: 8, lineHeight: 1.8 }}>
                        ENTER THE CAMPAIGN NAME THAT WILL BE STORED IN THE RUST API.
                      </div>
                    </div>

                    <div style={{ height: 1, background: BORDER, marginBottom: 24 }} />

                    <div style={{ marginBottom: 24 }}>
                      <label style={{ fontFamily: MONO, fontSize: 9, color: MUTED2, letterSpacing: 2, display: "block", marginBottom: 16 }}>
                        EMISSION SETTINGS
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {[
                          { label: "INSTANT RELEASE", value: instant, set: setInstant },
                          { label: "MERKLE VERIFIED", value: merkle, set: setMerkle },
                        ].map((item) => (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontFamily: MONO, fontSize: 11, color: item.value ? TEXT : MUTED, letterSpacing: 1 }}>
                              {item.label}
                            </span>
                            <Toggle on={item.value} onChange={item.set} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ height: 1, background: BORDER, marginBottom: 24 }} />

                    <div className="campaign-card-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
                      <div>
                        <label style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 2, display: "block", marginBottom: 10 }}>
                          PAYOUT_FLOW
                        </label>
                        <input
                          value={payoutAvax}
                          onChange={(event) => setPayoutAvax(event.target.value)}
                          placeholder={appConfig.defaultPayoutAvax}
                          style={{
                            width: "100%",
                            fontFamily: MONO,
                            fontSize: 12,
                            background: "rgba(0,255,200,.03)",
                            border: `1px solid ${BORDER}`,
                            color: TEXT,
                            padding: "13px 14px",
                            letterSpacing: 1,
                          }}
                        />
                        <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 1, marginTop: 8, lineHeight: 1.6 }}>
                          FLOW PER ELIGIBLE CLAIM. THE CONTRACT STILL RECEIVES WEI UNDER THE HOOD.
                        </div>
                      </div>
                      <div>
                        <label style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 2, display: "block", marginBottom: 10 }}>
                          FUNDING_FLOW
                        </label>
                        <input
                          value={fundingAvax}
                          onChange={(event) => setFundingAvax(event.target.value)}
                          placeholder={appConfig.defaultFundingAvax}
                          style={{
                            width: "100%",
                            fontFamily: MONO,
                            fontSize: 12,
                            background: "rgba(0,255,200,.03)",
                            border: `1px solid ${BORDER}`,
                            color: TEXT,
                            padding: "13px 14px",
                            letterSpacing: 1,
                          }}
                        />
                        <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 1, marginTop: 8, lineHeight: 1.6 }}>
                          TOTAL FLOW ATTACHED TO THE CREATE TX ON {appConfig.networkName.toUpperCase()}.
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 2, display: "block", marginBottom: 10 }}>
                        RECIPIENTS (ADDRESS,AMOUNT)
                      </label>
                      <textarea
                        value={recipientText}
                        onChange={(event) => setRecipientText(event.target.value)}
                        placeholder={SAMPLE_RECIPIENTS}
                        rows={6}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          fontFamily: MONO,
                          fontSize: 11,
                          background: "rgba(0,255,200,.03)",
                          border: `1px solid ${BORDER}`,
                          color: TEXT,
                          padding: "14px 16px",
                          lineHeight: 1.8,
                        }}
                      />
                      <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED2, letterSpacing: 1, marginTop: 8, lineHeight: 1.8 }}>
                        ONE RECIPIENT PER LINE. FORMAT: 0xABC...,1
                        <br />
                        CREATOR WALLET: <span style={{ color: wallet.account ? CYAN : MUTED }}>{wallet.account || "CONNECT WALLET"}</span>
                        <br />
                        TARGET NETWORK: <span style={{ color: CYAN }}>{appConfig.networkName.toUpperCase()}</span>
                      </div>
                    </div>

                    <div style={{ height: 1, background: BORDER, margin: "24px 0" }} />

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: createState.loading || createState.success ? CYAN : MUTED2,
                            boxShadow: createState.loading || createState.success ? `0 0 8px ${CYAN}` : "none",
                            transition: "all .4s",
                          }}
                        />
                        <span style={{ fontFamily: MONO, fontSize: 10, color: createState.loading || createState.success ? CYAN_DIM : MUTED2, letterSpacing: 1.5, transition: "color .4s" }}>
                          {createState.loading
                            ? "DEPLOYING..."
                            : pendingDeployment
                              ? "PENDING ONCHAIN DEPLOYMENT"
                              : createState.success
                                ? "CAMPAIGN DEPLOYED"
                                : `READY FOR ${appConfig.networkName.toUpperCase()}`}
                        </span>
                      </div>
                      <Btn
                        onClick={() => {
                          void handleCreate();
                        }}
                        disabled={createState.loading}
                      >
                        {createState.loading ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "inline-block", animation: "spin .7s linear infinite" }}>◌</span>
                            DEPLOYING
                          </span>
                        ) : pendingDeployment ? (
                          "COMPLETE DEPLOYMENT"
                        ) : (
                          "CREATE CAMPAIGN"
                        )}
                      </Btn>
                    </div>

                    <StatusMessage createState={createState} pendingDeployment={pendingDeployment} />
                  </div>

                  <JsonPanel
                    campaignName={campaignName}
                    instant={instant}
                    merkle={merkle}
                    payoutAvax={payoutAvax}
                    fundingAvax={fundingAvax}
                    recipients={parsedRecipientsForPreview}
                  />
                </div>
              </div>

              <div style={{ animation: "fadeUp .6s .5s both" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: CYAN_DIM, letterSpacing: 2, marginBottom: 6 }}>
                  OPERATIONAL STREAM
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
                  <h2 style={{ fontFamily: MONO, fontSize: "clamp(18px,2.5vw,28px)", color: TEXT, letterSpacing: 3 }}>
                    ACTIVE CAMPAIGNS
                  </h2>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Btn
                      outline
                      small
                      onClick={() => {
                        setRefreshNonce((value) => value + 1);
                      }}
                    >
                      REFRESH
                    </Btn>
                    <Btn outline small onClick={() => void onConnect()}>
                      {wallet.account ? "WALLET READY" : "CONNECT"}
                    </Btn>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {campaignsLoading || campaignsError || campaigns.length === 0 ? (
                    <EmptyCampaignState loading={campaignsLoading} error={campaignsError} />
                  ) : null}
                  {campaigns.map((campaign, index) => (
                    <div className="campaign-row" key={campaign.campaign_id}>
                      <CampaignRow campaign={campaign} delay={index * 120} onOpen={(campaignId) => onNavigatePage("protocols", campaignId)} />
                    </div>
                  ))}
                </div>
              </div>
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
              background: "rgba(2,13,15,.6)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: CYAN }}>ZUS_PROTOCOL_CORE</span>
            </div>
            <div style={{ textAlign: "center", lineHeight: 2 }}>
              <div>© 2026 ZUS PROTOCOL. ALL RIGHTS RESERVED.</div>
              <div style={{ color: "#1a5550", fontSize: 9, letterSpacing: 2 }}>
                API {campaigns.length} · WALLET {shortAddress(wallet.account)}
              </div>
            </div>
            <span>RUST_API · ZUSPROTOCOL · PRIVACY_POLICY · NEWSLETTER_SUB</span>
          </footer>
        </div>
      </div>
    </>
  );
}
