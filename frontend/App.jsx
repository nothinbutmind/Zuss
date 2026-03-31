import { useEffect, useRef, useState } from "react";
import { appConfig, getNetworkName, resolveApiUrl } from "./config.js";
import {
  buildWalletAccountForChain,
  connectWalletForChain,
  normalizeChainKey,
} from "./chains.js";
import ZusCampaigns from "./ZusCampaigns.jsx";
import ZusDashboard from "./ZusDashboard.jsx";
import ZusRewards from "./ZusRewards.jsx";
import ZusProtocolDetail from "./ZusProtocol_Detail.jsx";
import { demoCampaigns } from "./demoCampaigns.js";

const HOME_HASH = "#/";
const DASHBOARD_HASH = "#/dashboard";
const CAMPAIGNS_HASH = "#/campaigns";
const REWARDS_HASH = "#/rewards";
const LEGACY_VAULT_HASH = "#/vault";
const PROTOCOLS_HASH = "#/protocols";
const DOCS_URL = "https://deepwiki.com/nothinbutmind/ZUS_Protocol";
const SUBTITLE =
  "Zus unifies Filecoin and Starknet in one app. Campaign data and Merkle trees stay off-chain in the shared Rust plus Filecoin layer, the browser prepares the private claim flow, and transactions are relayed to Starknet Cairo contracts.";

const EMPTY_WALLET = {
  account: "",
  chainId: "",
  connecting: false,
  error: "",
  walletProvider: null,
  walletAccount: null,
  walletName: "",
};

function getCurrentRoute() {
  if (typeof window === "undefined") {
    return "home";
  }

  if (window.location.hash.startsWith(CAMPAIGNS_HASH)) {
    return "campaigns";
  }

  if (window.location.hash.startsWith(DASHBOARD_HASH)) {
    return "dashboard";
  }

  if (
    window.location.hash.startsWith(REWARDS_HASH) ||
    window.location.hash.startsWith(LEGACY_VAULT_HASH)
  ) {
    return "rewards";
  }

  if (window.location.hash.startsWith(PROTOCOLS_HASH)) {
    return "protocols";
  }

  return "home";
}

function getSelectedCampaignId() {
  if (typeof window === "undefined") {
    return "";
  }

  if (!window.location.hash.startsWith(`${PROTOCOLS_HASH}/`)) {
    return "";
  }

  return decodeURIComponent(window.location.hash.slice(`${PROTOCOLS_HASH}/`.length));
}

function shortAddress(value) {
  if (!value) {
    return "NOT_CONNECTED";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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

function TypewriterSub() {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let index = 0;
    let alive = true;

    const timer = setTimeout(function tick() {
      if (!alive) {
        return;
      }

      if (index <= SUBTITLE.length) {
        setText(SUBTITLE.slice(0, index));
        index += 1;
        setTimeout(tick, 28);
      } else {
        setDone(true);
      }
    }, 1200);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const highlight = (value) => {
    const parts = value.split(
      /(Filecoin and Starknet|campaign data and Merkle trees stay off-chain|the browser prepares the private claim flow|transactions are relayed to Starknet Cairo contracts)/g,
    );
    return parts.map((part, index) =>
      part === "Filecoin and Starknet" ||
      part === "campaign data and Merkle trees stay off-chain" ||
      part === "the browser prepares the private claim flow" ||
      part === "transactions are relayed to Starknet Cairo contracts" ? (
        <span key={index} style={{ color: "#00ddb0" }}>
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  return (
    <p
      className="typewriter-sub"
      style={{
        fontFamily: "'Share Tech Mono',monospace",
        fontSize: 14,
        color: "#3a6660",
        maxWidth: 620,
        margin: "28px auto 40px",
        lineHeight: 2,
        animation: "fadeUp .9s .6s both",
        minHeight: 96,
      }}
    >
      {highlight(text)}
      {!done ? (
        <span style={{ animation: "cur 0.7s steps(1) infinite", color: "#00ffc8" }}>▋</span>
      ) : null}
    </p>
  );
}

function Glitch({ children, color }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setActive(true);
      setTimeout(() => setActive(false), 120);
    }, 4200 + Math.random() * 2400);

    return () => clearInterval(interval);
  }, []);

  return (
    <span
      style={{
        display: "inline-block",
        color,
        animation: active ? "glitch .12s steps(2) both" : "none",
      }}
    >
      {children}
    </span>
  );
}

function useReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold]);

  return [ref, visible];
}

function Particles() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");
    let animationFrame = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    resize();

    const points = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.2 + 0.4,
      opacity: Math.random() * 0.4 + 0.1,
    }));

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);

      points.forEach((point) => {
        point.x += point.vx;
        point.y += point.vy;

        if (point.x < 0) point.x = canvas.width;
        if (point.x > canvas.width) point.x = 0;
        if (point.y < 0) point.y = canvas.height;
        if (point.y > canvas.height) point.y = 0;

        context.beginPath();
        context.arc(point.x, point.y, point.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(0,255,200,${point.opacity})`;
        context.fill();
      });

      for (let index = 0; index < points.length; index += 1) {
        for (let inner = index + 1; inner < points.length; inner += 1) {
          const a = points[index];
          const b = points[inner];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);

          if (distance < 90) {
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.strokeStyle = `rgba(0,255,200,${0.08 * (1 - distance / 90)})`;
            context.lineWidth = 1;
            context.stroke();
          }
        }
      }

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1 }}
    />
  );
}

function Btn({ children, outline, className, onClick }) {
  const [hovered, setHovered] = useState(false);
  const base = {
    fontFamily: "'Share Tech Mono',monospace",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    padding: "14px 28px",
    cursor: "pointer",
    border: "1px solid",
    transition: "all .25s",
    background: "transparent",
  };

  if (outline) {
    return (
      <button
        className={className}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          ...base,
          color: hovered ? "#00ffc8" : "#4a7a72",
          borderColor: hovered ? "#00ffc8" : "#1a4040",
          boxShadow: hovered
            ? "0 0 18px rgba(0,255,200,.35), inset 0 0 18px rgba(0,255,200,.04)"
            : "none",
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      className={className}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...base,
        background: hovered ? "#00ffc8" : "#00ddb0",
        color: "#020d0f",
        borderColor: hovered ? "#00ffc8" : "#00ddb0",
        boxShadow: hovered
          ? "0 0 24px rgba(0,255,200,.7), 0 0 48px rgba(0,255,200,.3)"
          : "0 0 10px rgba(0,255,200,.2)",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function FeatCard({ tag, title, desc, extra, delay }) {
  const [ref, visible] = useReveal();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? "rgba(0,255,200,.25)" : "rgba(0,255,200,.08)"}`,
        background: hovered ? "rgba(0,255,200,.03)" : "transparent",
        padding: "30px 36px",
        minHeight: 356,
        position: "relative",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity .6s ${delay}ms, transform .6s ${delay}ms, border-color .3s, background .3s`,
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
          background: "linear-gradient(90deg,transparent,#00ffc8,transparent)",
          opacity: hovered ? 1 : 0,
          transition: "opacity .3s",
        }}
      />
      <div
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 12,
          color: "#2a5550",
          letterSpacing: 2,
          marginBottom: 12,
        }}
      >
        {tag}
      </div>
      <h3
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 18,
          color: "#e0f0ed",
          letterSpacing: 1.4,
          marginBottom: 16,
          lineHeight: 1.45,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 13,
          color: "#3a6660",
          lineHeight: 2,
          marginBottom: 22,
        }}
      >
        {desc}
      </p>
      {extra ? (
        <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: "#2a5550", lineHeight: 1.8 }}>
          {extra}
        </div>
      ) : null}
      <div style={{ marginTop: 24, height: 1, background: "rgba(0,255,200,.06)" }}>
        <div
          style={{
            height: "100%",
            width: "55%",
            background: "linear-gradient(90deg,#00ffc8,transparent)",
          }}
        />
      </div>
    </div>
  );
}

function HowStep({ dot, title, desc, delay }) {
  const [ref, visible] = useReveal();

  return (
    <div
      className="how-step"
      ref={ref}
      style={{
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        padding: "34px 34px",
        minHeight: 182,
        border: "1px solid rgba(0,255,200,.07)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-20px)",
        transition: `opacity .6s ${delay}ms, transform .6s ${delay}ms`,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          flexShrink: 0,
          background: "rgba(0,255,200,.08)",
          border: "1px solid rgba(0,255,200,.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 24,
          color: "#00ddb0",
        }}
      >
        {dot}
      </div>
      <div>
        <div
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 18,
            color: "#cce8e4",
            letterSpacing: 1.4,
            marginBottom: 10,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 13,
            color: "#3a6660",
            lineHeight: 2,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

function UseCard({ title, desc, delay }) {
  const [ref, visible] = useReveal(0.1);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? "rgba(0,255,200,.2)" : "rgba(0,255,200,.07)"}`,
        background: hovered ? "rgba(0,255,200,.02)" : "transparent",
        padding: "32px 34px",
        minHeight: 186,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity .5s ${delay}ms, transform .5s ${delay}ms, border-color .3s`,
      }}
    >
      <div
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 18,
          color: "#00ddb0",
          letterSpacing: 2,
          marginBottom: 16,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 13,
          color: "#3a6660",
          lineHeight: 2,
        }}
      >
        {desc}
      </div>
    </div>
  );
}

function LandingPage({ onNavigateStart, onNavigateCreate, wallet, onConnect }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 680) {
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
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: #020d0f; }
        ::-webkit-scrollbar-thumb { background: #00806a; }
        body { background: #020d0f; margin: 0; overflow-x: hidden; }
        @keyframes cur { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes glitch {
          0%   { clip-path:inset(20% 0 60% 0); transform:translate(-2px,0); }
          33%  { clip-path:inset(60% 0 10% 0); transform:translate(2px,0); filter:hue-rotate(20deg); }
          66%  { clip-path:inset(40% 0 40% 0); transform:translate(-1px,0); }
          100% { clip-path:none; transform:translate(0); }
        }
        @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glowPulse {
          0%,100% { text-shadow: 0 0 28px rgba(0,255,200,.5),0 0 56px rgba(0,255,200,.2); }
          50%     { text-shadow: 0 0 48px rgba(0,255,200,.85),0 0 90px rgba(0,255,200,.4),0 0 130px rgba(0,255,200,.1); }
        }
        button { outline: none; }
        .mobile-menu-toggle, .mobile-menu-panel { display: none; }
        @media (max-width: 900px) {
          .top-nav { padding: 14px 20px !important; }
          .nav-actions { gap: 12px !important; }
          .nav-cta { padding: 12px 18px !important; }
          .content-section, .use-cases-section { padding: 72px 24px !important; }
          .site-footer { padding: 20px 24px !important; }
        }
        @media (max-width: 680px) {
          .top-nav {
            align-items: center !important;
            justify-content: space-between !important;
            flex-wrap: nowrap !important;
            gap: 12px !important;
            padding: 14px 16px !important;
          }
          .nav-brand {
            font-size: 11px !important;
            letter-spacing: 2px !important;
          }
          .nav-actions {
            display: none !important;
          }
          .mobile-menu-toggle {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .mobile-menu-panel {
            display: grid !important;
            position: absolute !important;
            top: calc(100% + 10px) !important;
            left: 16px !important;
            right: 16px !important;
            padding: 12px !important;
            background: rgba(2,13,15,.94) !important;
            border: 1px solid rgba(0,255,200,.14) !important;
            box-shadow: 0 20px 42px rgba(0,0,0,.36) !important;
            backdrop-filter: blur(14px) !important;
          }
          .nav-link {
            font-size: 11px !important;
            letter-spacing: 1.8px !important;
          }
          .nav-launch {
            display: none !important;
          }
          .hero-btn {
            width: 100% !important;
            justify-content: center !important;
            text-align: center !important;
          }
          .hero-section {
            min-height: auto !important;
            padding: 164px 16px 72px !important;
          }
          .hero-content {
            width: 100% !important;
            max-width: 520px !important;
          }
          .hero-eyebrow {
            width: 100% !important;
            max-width: 320px !important;
            font-size: 10px !important;
            letter-spacing: 2px !important;
            padding: 6px 10px !important;
          }
          .hero-title {
            font-size: clamp(36px, 17vw, 62px) !important;
            letter-spacing: 1px !important;
            line-height: 1.02 !important;
          }
          .typewriter-sub {
            max-width: none !important;
            width: 100% !important;
            min-height: 96px !important;
            font-size: 11px !important;
            margin: 20px auto 28px !important;
            line-height: 1.85 !important;
          }
          .hero-actions {
            flex-direction: column !important;
            gap: 10px !important;
            align-items: stretch !important;
          }
          .content-section, .use-cases-section, .ledger-section {
            padding-left: 16px !important;
            padding-right: 16px !important;
          }
          .feature-grid, .use-cases-grid {
            grid-template-columns: 1fr !important;
          }
          .how-step {
            flex-direction: column !important;
            gap: 12px !important;
            padding: 18px !important;
          }
          .ledger-copy { line-height: 1.85 !important; }
          .desktop-break { display: none !important; }
          .site-footer {
            flex-direction: column !important;
            gap: 16px !important;
            text-align: center !important;
            padding: 20px 16px 28px !important;
          }
          .footer-brand { justify-content: center !important; }
          .footer-copy, .footer-links { text-align: center !important; }
        }
      `}</style>

      <nav
        className="top-nav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          rowGap: 12,
          padding: "14px 40px",
          background: scrolled ? "rgba(2,13,15,.92)" : "transparent",
          backdropFilter: scrolled ? "blur(12px)" : "none",
          borderBottom: scrolled
            ? "1px solid rgba(0,255,200,.08)"
            : "1px solid transparent",
          transition: "all .4s",
        }}
      >
        <span
          className="nav-brand"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.hash = HOME_HASH;
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 14,
            color: "#00ffc8",
            letterSpacing: 3,
            textShadow: "0 0 14px rgba(0,255,200,.5)",
            cursor: "pointer",
          }}
        >
          ZUS_PROTOCOL
        </span>
        <button
          className="mobile-menu-toggle"
          type="button"
          onClick={() => setMobileMenuOpen((value) => !value)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
          style={{
            width: 46,
            height: 46,
            border: "1px solid rgba(0,255,200,.22)",
            background: mobileMenuOpen ? "rgba(0,255,200,.12)" : "rgba(2,13,15,.88)",
            cursor: "pointer",
            flexDirection: "column",
            gap: 5,
            padding: 0,
          }}
        >
          {[0, 1, 2].map((line) => (
            <span
              key={line}
              style={{
                width: 18,
                height: 1.5,
                background: "#00ffc8",
                boxShadow: "0 0 10px rgba(0,255,200,.4)",
              }}
            />
          ))}
        </button>
        <div className="nav-actions" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {["PRINCIPLES", "FEATURES"].map((item) => (
            <a
              className="nav-link"
              key={item}
              href={item === "PRINCIPLES" ? "#principles" : "#how-zus-works"}
              style={{
                fontFamily: "'Share Tech Mono',monospace",
                fontSize: 12,
                color: "#3a6660",
                letterSpacing: 2,
                textDecoration: "none",
                transition: "color .2s",
              }}
              onMouseEnter={(event) => {
                event.target.style.color = "#00ffc8";
              }}
              onMouseLeave={(event) => {
                event.target.style.color = "#3a6660";
              }}
            >
              {item}
            </a>
          ))}
          <a
            className="nav-link"
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: "'Share Tech Mono',monospace",
              fontSize: 12,
              color: "#3a6660",
              letterSpacing: 2,
              textDecoration: "none",
              transition: "color .2s",
            }}
            onMouseEnter={(event) => {
              event.target.style.color = "#00ffc8";
            }}
            onMouseLeave={(event) => {
              event.target.style.color = "#3a6660";
            }}
          >
            DOCS
          </a>
          <Btn className="nav-cta" outline onClick={() => void onConnect()}>
            {wallet.account ? shortAddress(wallet.account) : "CONNECT WALLET"}
          </Btn>
          <Btn className="nav-cta nav-launch" onClick={onNavigateStart}>
            LAUNCH APP
          </Btn>
        </div>
        {mobileMenuOpen ? (
          <div
            className="mobile-menu-panel"
            style={{
              gap: 10,
            }}
          >
            {[
              { label: "PRINCIPLES", href: "#principles" },
              { label: "FEATURES", href: "#how-zus-works" },
              { label: "DOCS", href: DOCS_URL, external: true },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noreferrer" : undefined}
                style={{
                  fontFamily: "'Share Tech Mono',monospace",
                  fontSize: 12,
                  letterSpacing: 2,
                  textDecoration: "none",
                  color: "#cce8e4",
                  border: "1px solid rgba(0,255,200,.12)",
                  background: "rgba(4,20,24,.88)",
                  padding: "14px 16px",
                  textAlign: "center",
                }}
              >
                {item.label}
              </a>
            ))}
            <Btn
              className="mobile-menu-wallet"
              outline
              onClick={() => {
                setMobileMenuOpen(false);
                void onConnect();
              }}
            >
              {wallet.account ? shortAddress(wallet.account) : "CONNECT WALLET"}
            </Btn>
          </div>
        ) : null}
      </nav>

      <section
        className="hero-section"
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "120px 24px 80px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            background:
              "radial-gradient(ellipse 65% 45% at 50% 35%, rgba(0,255,200,.055) 0%, transparent 70%), radial-gradient(ellipse 35% 25% at 15% 85%, rgba(0,180,140,.03) 0%, transparent 60%), radial-gradient(ellipse 35% 25% at 85% 70%, rgba(0,100,80,.03) 0%, transparent 60%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            backgroundImage:
              "linear-gradient(rgba(0,255,200,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.02) 1px,transparent 1px)",
            backgroundSize: "55px 55px",
            maskImage: "radial-gradient(ellipse at center, black 25%, transparent 75%)",
          }}
        />
        <Particles />

        <div className="hero-content" style={{ position: "relative", zIndex: 2 }}>
          <div
            className="hero-eyebrow"
            style={{
              fontFamily: "'Share Tech Mono',monospace",
              fontSize: 12,
              letterSpacing: 3,
              color: "#00ddb0",
              border: "1px solid rgba(0,255,200,.22)",
              display: "inline-block",
              padding: "4px 14px",
              marginBottom: 28,
              animation: "fadeUp .8s .2s both",
            }}
          >
            PRIVACY-PRESERVING PROTOCOL
          </div>

          <h1
            className="hero-title"
            style={{
              fontFamily: "'Share Tech Mono',monospace",
              fontSize: "clamp(46px,8vw,104px)",
              fontWeight: 400,
              lineHeight: 0.96,
              letterSpacing: 2,
              animation: "fadeUp .9s .4s both",
            }}
          >
            <Glitch color="#ffffff">REWARDS_</Glitch>
            <br />
            <span style={{ color: "#ffffff" }}>WITHOUT</span>
            <br />
            <span
              style={{
                color: "#00ffc8",
                display: "inline-block",
                animation: "glowPulse 3s 1.4s ease-in-out infinite",
              }}
            >
              <Glitch color="#00ffc8">EXPOSURE_</Glitch>
            </span>
          </h1>

          <TypewriterSub />

          <div
            className="hero-actions"
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
              animation: "fadeUp .9s .8s both",
            }}
          >
            <Btn className="hero-btn" outline onClick={() => void onConnect()}>
              {wallet.account ? shortAddress(wallet.account) : "CONNECT WALLET"}
            </Btn>
            <Btn className="hero-btn" onClick={onNavigateStart}>
              GET STARTED
            </Btn>
            <Btn className="hero-btn" outline onClick={() => window.open(DOCS_URL, "_blank", "noopener,noreferrer")}>
              OPEN DOCS
            </Btn>
          </div>

          <div
            style={{
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 14,
              maxWidth: 980,
              marginInline: "auto",
              animation: "fadeUp .9s 1s both",
            }}
          >
            {[
              {
                tag: "DOCS_LINK",
                title: "PROJECT DOCS",
                desc:
                  "Open the DeepWiki documentation for the full architecture, contracts, relayer flow, and Starknet rebuild details.",
                action: "OPEN DEEPWIKI",
              },
              {
                tag: "OFFCHAIN_LAYER",
                title: "FILECOIN + RUST API",
                desc:
                  "Campaign metadata, recipient sets, and Merkle trees stay off-chain here as the shared source of truth for the Starknet payment path.",
              },
              {
                tag: "STARKNET_PATH",
                title: "STARKNET CAIRO CONTRACTS",
                desc:
                  "The app routes claims to the Cairo contracts, relayed Starknet submission flow, and stealth recovery path.",
              },
              {
                tag: "PRIVATE_PAYMENT_PATH",
                title: "RELAYER + STEALTH PAYOUTS",
                desc:
                  "Users prepare the claim locally, the relayer broadcasts on Starknet, and funds land on a one-time stealth address.",
              },
            ].map((item) => (
              <div
                key={item.tag}
                style={{
                  textAlign: "left",
                  border: "1px solid rgba(0,255,200,.12)",
                  background: "rgba(0,255,200,.03)",
                  padding: "18px 18px 20px",
                  boxShadow: "0 0 18px rgba(0,255,200,.04)",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Share Tech Mono',monospace",
                    fontSize: 10,
                    color: "#2a5550",
                    letterSpacing: 2,
                    marginBottom: 10,
                  }}
                >
                  {item.tag}
                </div>
                <div
                  style={{
                    fontFamily: "'Share Tech Mono',monospace",
                    fontSize: 15,
                    color: "#00ffc8",
                    letterSpacing: 1.4,
                    marginBottom: 10,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontFamily: "'Share Tech Mono',monospace",
                    fontSize: 12,
                    color: "#3a6660",
                    lineHeight: 1.8,
                  }}
                >
                  {item.desc}
                </div>
                {item.action ? (
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: 14,
                      fontFamily: "'Share Tech Mono',monospace",
                      fontSize: 11,
                      letterSpacing: 1.8,
                      color: "#00ddb0",
                      textDecoration: "none",
                    }}
                  >
                    {item.action}
                  </a>
                ) : null}
              </div>
            ))}
          </div>

        </div>
      </section>

      <section id="principles" className="content-section" style={{ padding: "90px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: "#2a5550", letterSpacing: 2, marginBottom: 10 }}>
          ZRC_LAYER_LINE: 001
        </div>
        <h2 style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "clamp(24px,3.8vw,44px)", color: "#cce8e4", letterSpacing: 3, marginBottom: 8 }}>
          ENCRYPTED BY DESIGN.
        </h2>
        <p style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 13, color: "#3a6660", marginBottom: 40, lineHeight: 1.9 }}>
          Keep the campaign and Merkle data off-chain, prepare the claim in the browser, and relay the final execution step to Starknet Cairo contracts.
        </p>
        <div className="feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 22 }}>
          <FeatCard tag="// CONFIDENTIAL_AIRDROP" title="DROP TO THE RIGHT WALLETS. TELL NO ONE ELSE." desc="Distribute tokens to verified holders without exposing the recipient list or individual balances." extra="+ LIVE CAMPAIGNS >" delay={0} />
          <FeatCard tag="// STARKNET_PATH" title="ONE APP. ONE PRIVATE EXECUTION PATH." desc="The active on-chain path is Starknet, where Cairo contracts enforce nullifiers, Merkle checks, and private stealth payouts." delay={120} />
          <FeatCard tag="// SMART_CONTRACT_HANDOFF" title="KEEP DATA OFFCHAIN. EXECUTE ON STARKNET." desc="The app creates the campaign and Merkle tree in the shared Rust plus Filecoin layer first, then routes execution to Starknet through the relayer." extra="FILECOIN + APP + STARKNET" delay={240} />
        </div>
      </section>

      <section id="how-zus-works" className="content-section" style={{ padding: "90px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: "#2a5550", letterSpacing: 2, marginBottom: 10 }}>ZRC_LAYER_LINE: 002</div>
        <h2 style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "clamp(24px,3.8vw,44px)", color: "#cce8e4", letterSpacing: 3, marginBottom: 4 }}>
          HOW <span style={{ color: "#00ffc8", textShadow: "0 0 16px rgba(0,255,200,.4)" }}>ZUS</span> WORKS
        </h2>
        <div style={{ width: 36, height: 2, background: "#00ffc8", margin: "10px 0 40px", boxShadow: "0 0 8px #00ffc8" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 1280 }}>
          <HowStep dot="1" title="CONNECT STARKNET WALLET" desc="Connect Argent X or Braavos so the app can prepare a claimant-bound private payment flow." delay={0} />
          <HowStep dot="2" title="KEEP CAMPAIGN DATA OFFCHAIN" desc="The app posts campaign metadata and recipients into the shared Rust plus Filecoin layer, which builds and serves the Merkle tree." delay={150} />
          <HowStep dot="3" title="RELAY TO STARKNET" desc="After the off-chain data is ready, the browser prepares the claim package and the relayer submits the final Cairo transaction." delay={300} />
        </div>
      </section>

      <section className="content-section use-cases-section" style={{ padding: "90px 48px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,255,200,.02) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: "#2a5550", letterSpacing: 2, marginBottom: 10 }}>ZRC_LAYER_LINE: 003</div>
          <h2 style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "clamp(24px,3.8vw,44px)", color: "#cce8e4", letterSpacing: 4, marginBottom: 48 }}>
            OPERATIONAL USE CASES
          </h2>
          <div className="use-cases-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, maxWidth: 1400, margin: "0 auto" }}>
            <UseCard title="PRIVATE AIRDROPS" desc="Store allowlists and Merkle data off-chain, then send the on-chain payout path through Starknet." delay={0} />
            <UseCard title="LOYALTY CAMPAIGNS" desc="Run repeated reward drops while keeping the public dashboard free of full recipient disclosure." delay={100} />
            <UseCard title="GATED REBATES" desc="Use the same flow for consumer cashback or merchant promotions with a creator-controlled contract deployment." delay={200} />
            <UseCard title="STEALTH CLAIM SYSTEMS" desc="Use Starknet when you want the browser-based Cairo relayer flow and local stealth recovery note download." delay={300} />
          </div>
        </div>
      </section>

      <section className="ledger-section" style={{ padding: "120px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 55% 40% at 50% 50%, rgba(0,255,200,.035) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 600, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: "#2a5550", letterSpacing: 2, marginBottom: 16 }}>ZRC_LAYER_LINE: 004</div>
          <h2 style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: "clamp(30px,6vw,68px)", color: "#cce8e4", letterSpacing: 3, lineHeight: 1.05, marginBottom: 20 }}>
            THE LEDGER OF
            <br />
            SHADOWS.
          </h2>
          <p className="ledger-copy" style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 13, color: "#3a6660", lineHeight: 2, marginBottom: 36 }}>
            Start distributing rewards that respect the right to
            <br className="desktop-break" />
            privacy. Open the operator view, inspect the live Rust campaign
            <br className="desktop-break" />
            stream, and deploy the next drop from the same interface.
          </p>
          <Btn className="hero-btn" outline onClick={onNavigateCreate}>
            CREATE CAMPAIGN
          </Btn>
        </div>
      </section>

      <footer
        className="site-footer"
        style={{
          borderTop: "1px solid rgba(0,255,200,.06)",
          padding: "20px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 11,
          color: "#2a5550",
          letterSpacing: 1,
          textAlign: "center",
        }}
      >
        <div className="footer-brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#00ffc8" }}>ZUS_PROTOCOL</span>
        </div>
        <div className="footer-copy" style={{ textAlign: "center", lineHeight: 1.8 }}>
          <div>© 2026 ZUS PROTOCOL. ALL RIGHTS RESERVED.</div>
        </div>
        <span className="footer-links">
          X_FEED · DISCORD_SERVER · GITHUB_REPO · PRIVACY_POLICY ·{" "}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#00ddb0", textDecoration: "none" }}
          >
            DOCS
          </a>
        </span>
      </footer>
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(getCurrentRoute);
  const selectedChain = "starknet";
  const [walletSessions, setWalletSessions] = useState({
    starknet: { ...EMPTY_WALLET },
  });
  const [selectedCampaignId, setSelectedCampaignId] = useState(getSelectedCampaignId);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState("");
  const wallet = walletSessions[selectedChain];

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getCurrentRoute());
      setSelectedCampaignId(getSelectedCampaignId());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (selectedChain !== "starknet" || !wallet.walletProvider?.on) {
      return undefined;
    }

    const handleAccountsChanged = (accounts = []) => {
      const nextAccount = accounts?.[0] || "";
      setWalletSessions((current) => ({
        ...current,
        starknet: {
          ...current.starknet,
          account: nextAccount,
          walletAccount: nextAccount
            ? buildWalletAccountForChain("starknet", appConfig, current.starknet.walletProvider, nextAccount)
            : null,
          error: "",
        },
      }));
    };

    const handleNetworkChanged = (chainId, accounts = []) => {
      const nextAccount = accounts?.[0] || "";
      setWalletSessions((current) => ({
        ...current,
        starknet: {
          ...current.starknet,
          account: nextAccount || current.starknet.account,
          chainId: chainId ? String(chainId) : "",
          walletAccount: nextAccount
            ? buildWalletAccountForChain("starknet", appConfig, current.starknet.walletProvider, nextAccount)
            : current.starknet.walletAccount,
        },
      }));
    };

    wallet.walletProvider.on("accountsChanged", handleAccountsChanged);
    wallet.walletProvider.on("networkChanged", handleNetworkChanged);

    return () => {
      wallet.walletProvider.off?.("accountsChanged", handleAccountsChanged);
      wallet.walletProvider.off?.("networkChanged", handleNetworkChanged);
    };
  }, [selectedChain, wallet.walletProvider]);

  useEffect(() => {
    let cancelled = false;

    const reconnectWallet = async () => {
      try {
        const starknetSession = await connectWalletForChain("starknet", appConfig, {
          silent: true,
        }).catch(() => null);

        if (!cancelled) {
          setWalletSessions((current) => ({
            ...current,
            starknet: starknetSession?.address
              ? {
                  ...current.starknet,
                  account: starknetSession.address,
                  chainId: starknetSession.chainId,
                  walletProvider: starknetSession.walletProvider,
                  walletAccount: starknetSession.walletAccount,
                  walletName: starknetSession.walletName,
                  error: "",
                }
              : current.starknet,
          }));
        }
      } catch {
        // Silent reconnect failures should not block the initial render.
      }
    };

    void reconnectWallet();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCampaigns = async () => {
      setCampaignsLoading(true);
      setCampaignsError("");

      try {
        const data = await readJson(await fetch(resolveApiUrl("/campaigns")));
        if (!cancelled) {
          const nextCampaigns = Array.isArray(data) && data.length > 0 ? data : demoCampaigns;
          setCampaigns(nextCampaigns);
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
  }, []);

  const navigateTo = (nextRoute, campaignId = "") => {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      setSelectedCampaignId(campaignId);
      return;
    }

    if (nextRoute === "campaigns") {
      window.location.hash = CAMPAIGNS_HASH;
      return;
    }

    if (nextRoute === "dashboard") {
      window.location.hash = DASHBOARD_HASH;
      return;
    }

    if (nextRoute === "rewards") {
      window.location.hash = REWARDS_HASH;
      return;
    }

    if (nextRoute === "protocols") {
      window.location.hash = campaignId
        ? `${PROTOCOLS_HASH}/${encodeURIComponent(campaignId)}`
        : PROTOCOLS_HASH;
      return;
    }

    window.location.hash = HOME_HASH;
  };

  const connectWallet = async () => {
    setWalletSessions((current) => ({
      ...current,
      [selectedChain]: {
        ...current[selectedChain],
        connecting: true,
        error: "",
      },
    }));

    try {
      const session = await connectWalletForChain(selectedChain, appConfig);
      if (!session?.address) {
        throw new Error("No Starknet wallet connected. Install Argent X or Braavos.");
      }

      setWalletSessions((current) => ({
        ...current,
        [selectedChain]: {
          ...current[selectedChain],
          account: session.address,
          chainId: session.chainId,
          connecting: false,
          walletProvider: session.walletProvider,
          walletAccount: session.walletAccount,
          walletName: session.walletName,
          error: "",
        },
      }));

      return session.address;
    } catch (error) {
      const message = parseErrorMessage(error);
      setWalletSessions((current) => ({
        ...current,
        [selectedChain]: {
          ...current[selectedChain],
          connecting: false,
          error: message,
        },
      }));
      throw error;
    }
  };

  const visibleCampaigns = campaigns.filter((campaign) => {
    const campaignChain = normalizeChainKey(campaign.execution_chain || selectedChain);
    return campaignChain === selectedChain;
  });
  const selectedChainLabel = "Starknet";
  const selectedWalletHint = "Argent X / Braavos";
  const chainSelector = (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 18,
        zIndex: 160,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        minWidth: 220,
        border: "1px solid rgba(0,255,200,.18)",
        background: "rgba(2,13,15,.96)",
        boxShadow: "0 0 22px rgba(0,255,200,.08)",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 9,
            letterSpacing: 2,
            color: "#4a7a72",
            marginBottom: 6,
          }}
        >
          ACTIVE NETWORK
        </div>
        <div
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 12,
            letterSpacing: 1.4,
            color: "#00ffc8",
            marginBottom: 4,
          }}
        >
          {selectedChainLabel.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 9,
            letterSpacing: 1,
            color: "#3a6660",
            lineHeight: 1.6,
          }}
        >
          {getNetworkName(selectedChain)} · {selectedWalletHint}
        </div>
      </div>

      <div
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 9,
          letterSpacing: 1,
          color: "#3a6660",
          lineHeight: 1.7,
        }}
      >
        Starknet mode uses the Cairo contracts, relayed claims, and stealth recovery note download.
      </div>
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noreferrer"
        style={{
          fontFamily: "'Share Tech Mono',monospace",
          fontSize: 10,
          letterSpacing: 1.6,
          color: "#00ddb0",
          textDecoration: "none",
          borderTop: "1px solid rgba(0,255,200,.08)",
          paddingTop: 10,
        }}
      >
        OPEN DOCS
      </a>
    </div>
  );

  const renderWithChainSelector = (child) => (
    <>
      {chainSelector}
      {child}
    </>
  );

  if (route === "campaigns") {
    return renderWithChainSelector(
      <ZusCampaigns
        wallet={wallet}
        onConnect={connectWallet}
        onNavigateHome={() => navigateTo("home")}
        onNavigatePage={navigateTo}
        selectedChain={selectedChain}
      />
    );
  }

  if (route === "dashboard") {
    return renderWithChainSelector(
      <ZusDashboard
        wallet={wallet}
        onConnect={connectWallet}
        onNavigateHome={() => navigateTo("home")}
        onNavigatePage={navigateTo}
        campaigns={visibleCampaigns}
        campaignsLoading={campaignsLoading}
        campaignsError={campaignsError}
        onOpenCampaign={(campaignId) => navigateTo("protocols", campaignId)}
      />
    );
  }

  if (route === "rewards") {
    return renderWithChainSelector(
      <ZusRewards
        wallet={wallet}
        onConnect={connectWallet}
        onNavigateHome={() => navigateTo("home")}
        onNavigatePage={navigateTo}
        campaigns={visibleCampaigns}
        campaignsLoading={campaignsLoading}
        campaignsError={campaignsError}
        onOpenCampaign={(campaignId) => navigateTo("protocols", campaignId)}
      />
    );
  }

  if (route === "protocols") {
    return renderWithChainSelector(
      <ZusProtocolDetail
        wallet={wallet}
        onConnect={connectWallet}
        onNavigateBack={() => navigateTo("rewards")}
        onNavigateHome={() => navigateTo("home")}
        onNavigatePage={navigateTo}
        selectedChain={selectedChain}
        campaignId={selectedCampaignId}
        campaign={campaigns.find((item) => item.campaign_id === selectedCampaignId) || null}
      />
    );
  }

  return renderWithChainSelector(
    <>
      {wallet.error ? (
        <div
          style={{
            position: "fixed",
            top: 78,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 140,
            maxWidth: 720,
            width: "calc(100% - 32px)",
            border: "1px solid rgba(255,120,120,.25)",
            background: "rgba(44,14,16,.9)",
            color: "#d9a2a2",
            fontFamily: "'Share Tech Mono',monospace",
            fontSize: 10,
            letterSpacing: 1,
            lineHeight: 1.8,
            padding: "10px 14px",
          }}
        >
          {wallet.error}
        </div>
      ) : null}

      <LandingPage
        onNavigateStart={() => navigateTo("dashboard")}
        onNavigateCreate={() => navigateTo("campaigns")}
        wallet={wallet}
        onConnect={connectWallet}
      />
    </>
  );
}
