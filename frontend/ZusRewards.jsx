import { useState, useEffect, useRef } from "react";

/* ─── shared tokens ─── */
const CYAN    = "#00ffc8";
const CYAN_DIM = "#00ddb0";
const CYAN_MID = "#00c49a";
const BG      = "#020d0f";
const MUTED   = "#3a6660";
const MUTED2  = "#2a5550";
const TEXT    = "#cce8e4";
const MONO    = "'Share Tech Mono', monospace";
const BORDER  = "rgba(0,255,200,.08)";
const BORDER_HOV = "rgba(0,255,200,.22)";
const TREE_MAX_LEAVES = 1 << 12;

/* ─── pixel cat ─── */
function PixelCat() {
  const [hov, setHov] = useState(false);
  const pixels = [
    "0011011100","0111111110","1111111111",
    "1010110101","1111111111","0111111110",
    "0101000101","0101000101",
  ];
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ cursor:"pointer", display:"inline-block", transition:"transform .2s",
        transform: hov ? "scale(1.3) translateY(-2px)" : "scale(1)" }} title="=^._.^=">
      {pixels.map((row, ri) => (
        <div key={ri} style={{ display:"flex" }}>
          {row.split("").map((px, ci) => (
            <div key={ci} style={{
              width:3, height:3,
              background: px==="1" ? (hov ? CYAN : CYAN_MID) : "transparent",
              boxShadow: px==="1" && hov ? "0 0 4px rgba(0,255,200,.6)" : "none",
              transition:"background .2s, box-shadow .2s",
            }}/>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── scroll reveal ─── */
function useReveal(threshold = 0.1) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVis(true); obs.disconnect(); }
    }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, vis];
}

/* ─── egress bar ─── */
function EgressBar({ pct }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 500); return () => clearTimeout(t); }, [pct]);
  const color = pct > 80 ? CYAN : pct > 40 ? CYAN_DIM : MUTED;
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontFamily:MONO, fontSize:8, color:MUTED2, letterSpacing:1.5 }}>DISTRIBUTION STATUS</span>
        <span style={{ fontFamily:MONO, fontSize:8, color:color, letterSpacing:1 }}>{pct}%</span>
      </div>
      <div style={{ height:2, background:"rgba(0,255,200,.07)", borderRadius:1 }}>
        <div style={{
          height:"100%", width:`${w}%`,
          background:`linear-gradient(90deg,${MUTED2},${color})`,
          borderRadius:1, transition:"width 1.4s cubic-bezier(.4,0,.2,1)",
          boxShadow: w > 0 ? `0 0 6px rgba(0,255,200,.4)` : "none",
        }}/>
      </div>
    </div>
  );
}

/* ─── action button ─── */
function ActionBtn({ children, locked, onClick }) {
  const [hov, setHov] = useState(false);
  if (locked) return (
    <div style={{
      fontFamily:MONO, fontSize:9, letterSpacing:2, color:MUTED2,
      border:`1px solid ${BORDER}`, padding:"9px 0", textAlign:"center",
      cursor:"not-allowed",
    }}>{children}</div>
  );
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        fontFamily:MONO, fontSize:9, letterSpacing:2,
        color: hov ? BG : CYAN,
        border:`1px solid ${hov ? CYAN : CYAN_DIM}`,
        padding:"9px 0", textAlign:"center", cursor:"pointer",
        background: hov ? CYAN : "transparent",
        boxShadow: hov ? `0 0 20px rgba(0,255,200,.5)` : `0 0 8px rgba(0,255,200,.1)`,
        transition:"all .25s",
        userSelect:"none",
      }}>{children}</div>
  );
}

/* ─── outline nav button ─── */
function walletLabel(account, connecting) {
  if (connecting) {
    return "WALLET_<br/>CONNECTING";
  }

  if (!account) {
    return "CONNECT_<br/>WALLET";
  }

  return `${account.slice(0, 6)}<br/>${account.slice(-4)}`;
}

function NavBtn({ wallet, onConnect }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => void onConnect()}
      style={{
        fontFamily:MONO, fontSize:9, letterSpacing:2,
        color: hov ? BG : CYAN,
        border:`1px solid ${CYAN}`,
        padding:"8px 18px", cursor:"pointer",
        background: hov ? CYAN : "transparent",
        boxShadow: hov ? `0 0 20px rgba(0,255,200,.5)` : `0 0 10px rgba(0,255,200,.15)`,
        transition:"all .25s", lineHeight:1.4, textAlign:"center",
      }}
      dangerouslySetInnerHTML={{ __html: walletLabel(wallet.account, wallet.connecting) }}
    />
  );
}

/* ─── reward card ─── */
function RewardCard({ status, id, name, egress, recipients, reEgress, btnLabel, locked, pending, delay, onAction }) {
  const [ref, vis] = useReveal();
  const [hov, setHov] = useState(false);
  const [claimed, setClaimed] = useState(false);

  return (
    <div ref={ref} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        border:`1px solid ${hov && !locked ? BORDER_HOV : BORDER}`,
        background: hov && !locked ? "rgba(0,255,200,.025)" : "rgba(4,20,24,.6)",
        padding:20, display:"flex", flexDirection:"column", gap:16,
        position:"relative", overflow:"hidden",
        opacity: vis ? 1 : 0,
        transform: vis ? "translateY(0) scale(1)" : "translateY(24px) scale(.98)",
        transition:`opacity .55s ${delay}ms, transform .55s ${delay}ms, border-color .3s, background .3s`,
      }}>

      {/* top accent */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, height:1,
        background:`linear-gradient(90deg,transparent,${CYAN},transparent)`,
        opacity: hov && !locked ? 1 : 0, transition:"opacity .3s",
      }}/>

      {/* left accent bar */}
      <div style={{
        position:"absolute", left:0, top:0, bottom:0, width:2,
        background:`linear-gradient(180deg,${CYAN},transparent)`,
        opacity: hov && !locked ? .6 : 0, transition:"opacity .3s",
      }}/>

      {pending ? (
        /* pending placeholder */
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"24px 0" }}>
          <div style={{ fontFamily:MONO, fontSize:11, color:MUTED2, opacity:.5, letterSpacing:2, lineHeight:1.6, textAlign:"center" }}>
            {"[==]"}<br/>{"[  ]"}<br/>{"[__]"}
          </div>
          <div style={{ fontFamily:MONO, fontSize:8, color:MUTED2, letterSpacing:2 }}>NEXT_PHASE_PENDING</div>
        </div>
      ) : (
        <>
          {/* header row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{
              fontFamily:MONO, fontSize:8, letterSpacing:1.5,
              color: locked ? MUTED2 : CYAN,
              border:`1px solid ${locked ? BORDER : "rgba(0,255,200,.3)"}`,
              padding:"2px 8px",
            }}>LIVE</div>
            <div style={{ fontFamily:MONO, fontSize:8, color:MUTED2, letterSpacing:1 }}>ID: {id}</div>
          </div>

          {/* name */}
          <h3 style={{ fontFamily:MONO, fontSize:15, color: locked ? MUTED : TEXT, letterSpacing:2, lineHeight:1.3 }}>{name}</h3>

          {/* bar */}
          <EgressBar pct={egress} />

          {/* stats */}
          <div style={{ display:"flex", gap:28 }}>
            <div>
              <div style={{ fontFamily:MONO, fontSize:7, color:MUTED2, letterSpacing:1.5, marginBottom:3 }}>RECIPIENTS</div>
              <div style={{ fontFamily:MONO, fontSize:14, color: locked ? MUTED : TEXT }}>{recipients.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontFamily:MONO, fontSize:7, color:MUTED2, letterSpacing:1.5, marginBottom:3 }}>EGRESS</div>
              <div style={{ fontFamily:MONO, fontSize:14, color: locked ? MUTED2 : TEXT }}>{reEgress}%</div>
            </div>
          </div>

          {/* action */}
          <ActionBtn locked={locked} onClick={() => {
            if (claimed) return;
            setClaimed(btnLabel === "CLAIM");
            onAction?.();
          }}>
            {claimed ? "CLAIMED ✓" : btnLabel}
          </ActionBtn>
        </>
      )}
    </div>
  );
}

/* ─── tab ─── */
function Tab({ label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily:MONO, fontSize:9, letterSpacing:2,
        color: active ? TEXT : hov ? TEXT : MUTED,
        padding:"10px 20px",
        borderBottom:`2px solid ${active ? CYAN : "transparent"}`,
        cursor:"pointer", transition:"color .2s, border-color .2s",
        userSelect:"none",
      }}>{label}</div>
  );
}

/* ─── glitch title ─── */
function GlitchTitle({ children }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => { setOn(true); setTimeout(() => setOn(false), 120); }, 4000 + Math.random() * 2000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span style={{ animation: on ? "glitch .12s steps(2) both" : "none", display:"inline-block" }}>
      {children}
    </span>
  );
}

/* ─── typewriter ─── */
function Typewriter({ text, speed=22, delay=0, style: s }) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let i = 0, alive = true;
    const t = setTimeout(function tick() {
      if (!alive) return;
      if (i <= text.length) { setOut(text.slice(0, i)); i++; setTimeout(tick, speed); }
      else setDone(true);
    }, delay);
    return () => { alive = false; clearTimeout(t); };
  }, [text]);
  return (
    <span style={s}>
      {out}
      {!done && <span style={{ animation:"cur .7s steps(1) infinite", color:CYAN }}>▋</span>}
    </span>
  );
}

/* ─── nav link ─── */
function NavLink({ label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span style={{
      fontFamily:MONO, fontSize:10, letterSpacing:2,
      color: active ? TEXT : hov ? TEXT : MUTED,
      borderBottom:`2px solid ${active ? CYAN : "transparent"}`,
      paddingBottom:4, cursor:"pointer",
      transition:"color .2s, border-color .2s",
      userSelect:"none",
    }}
      onMouseEnter={e => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={onClick}>
      {label}
    </span>
  );
}

/* ─── main ─── */
export default function App({
  wallet,
  onConnect,
  onNavigatePage,
  campaigns,
  campaignsLoading,
  campaignsError,
  onOpenCampaign,
}) {
  const [tab, setTab] = useState("ALL_CAMPAIGNS");
  const normalizedCampaigns = campaigns.map((campaign) => {
    const egress = Number(((Number(campaign.leaf_count) / TREE_MAX_LEAVES) * 100).toFixed(1));

    return {
      id: campaign.onchain_campaign_id.slice(0, 10).toUpperCase(),
      campaignId: campaign.campaign_id,
      name: campaign.name,
      egress,
      recipients: Number(campaign.leaf_count),
      reEgress: egress,
      btnLabel: "VIEW DETAILS",
      filter: "all",
    };
  });

  const filtered = normalizedCampaigns.filter((campaign) => {
    if (tab === "ALL_CAMPAIGNS") return true;
    if (tab === "CLAIMABLE") return false;
    if (tab === "COMPLETED") return false;
    return true;
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:${BG}; margin:0; font-family:${MONO}; overflow-x:hidden; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:${BG}; }
        ::-webkit-scrollbar-thumb { background:#00806a; }
        @keyframes cur { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
        @keyframes glitch {
          0%  { clip-path:inset(20% 0 60% 0); transform:translate(-2px,0); }
          33% { clip-path:inset(60% 0 10% 0); transform:translate(2px,0); filter:hue-rotate(20deg); }
          66% { clip-path:inset(40% 0 40% 0); transform:translate(-1px,0); }
          100%{ clip-path:none; transform:translate(0); }
        }
        @keyframes scanline {
          0%   { top:-2px; opacity:.06; }
          50%  { opacity:.03; }
          100% { top:100%; opacity:.06; }
        }
        @keyframes pulse {
          0%,100% { box-shadow:0 0 5px ${CYAN},0 0 12px rgba(0,255,200,.3); }
          50%     { box-shadow:0 0 10px ${CYAN},0 0 24px rgba(0,255,200,.55); }
        }
        @keyframes borderGlow {
          0%,100% { border-color: rgba(0,255,200,.08); }
          50%     { border-color: rgba(0,255,200,.18); }
        }
      `}</style>

      <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>

        {/* bg ambience */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
          background:"radial-gradient(ellipse 55% 40% at 75% 20%, rgba(0,255,200,.04) 0%, transparent 70%), radial-gradient(ellipse 40% 30% at 20% 80%, rgba(0,180,140,.025) 0%, transparent 60%)" }}/>
        {/* grid */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
          backgroundImage:"linear-gradient(rgba(0,255,200,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.015) 1px,transparent 1px)",
          backgroundSize:"55px 55px",
          maskImage:"radial-gradient(ellipse at 70% 20%, black 20%, transparent 70%)" }}/>

        {/* ── HEADER ── */}
        <header style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"0 40px", height:56,
          borderBottom:`1px solid ${BORDER}`,
          background:"rgba(2,13,15,.85)", backdropFilter:"blur(10px)",
          position:"sticky", top:0, zIndex:50,
          animation:"fadeUp .5s both",
        }}>
          <span style={{ fontFamily:MONO, fontSize:13, color:CYAN, letterSpacing:3,
            textShadow:`0 0 14px rgba(0,255,200,.5)` }}>ZUS_PROTOCOL</span>

          <div style={{ display:"flex", gap:32, alignItems:"center" }}>
            {["Campaigns","Analytics","Vault","Protocols"].map(t => (
              <NavLink
                key={t}
                label={t}
                active={t === "Vault"}
                onClick={() => {
                  if (t === "Campaigns") onNavigatePage("campaigns");
                  if (t === "Vault") onNavigatePage("vault");
                  if (t === "Protocols") onNavigatePage("protocols");
                }}
              />
            ))}
          </div>

          <NavBtn wallet={wallet} onConnect={onConnect} />
        </header>

        {/* ── MAIN ── */}
        <main style={{ flex:1, padding:"48px 40px 60px", position:"relative", zIndex:1 }}>

          {/* hero heading */}
          <div style={{ marginBottom:36, animation:"fadeUp .6s .15s both",
            borderLeft:`3px solid ${CYAN}`,
            paddingLeft:20,
            boxShadow:`-8px 0 24px rgba(0,255,200,.08)`,
          }}>
            <h1 style={{ fontFamily:MONO, fontSize:"clamp(28px,4.5vw,52px)", color:TEXT, letterSpacing:4, lineHeight:1.1, marginBottom:12 }}>
              <GlitchTitle>ACTIVE REWARDS_</GlitchTitle>
            </h1>
            <p style={{ fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:2, lineHeight:2, maxWidth:480 }}>
              <Typewriter
                text="VALIDATING NETWORK INTEGRITY. CLAIM CONFIDENTIAL PERKS AND LIQUIDITY INCENTIVES FROM THE MONOLITH."
                speed={18} delay={400}
                style={{ fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:2, lineHeight:2 }}
              />
            </p>
          </div>

          {/* filter bar */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:28, animation:"fadeUp .6s .3s both" }}>
            {/* tabs */}
            <div style={{ display:"flex", borderBottom:`1px solid ${BORDER}` }}>
              {["ALL_CAMPAIGNS","CLAIMABLE","COMPLETED"].map(t => (
                <Tab key={t} label={t} active={tab===t} onClick={() => setTab(t)} />
              ))}
            </div>

            {/* status panel */}
            <div style={{
              display:"flex", gap:0,
              border:`1px solid ${BORDER}`,
              background:"rgba(4,20,24,.8)",
              animation:"borderGlow 4s ease-in-out infinite",
            }}>
              <div style={{ padding:"8px 16px", borderRight:`1px solid ${BORDER}` }}>
                <div style={{ fontFamily:MONO, fontSize:7, color:MUTED2, letterSpacing:2, marginBottom:4 }}>SYSTEM_STATUS</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:CYAN,
                    animation:"pulse 2s ease-in-out infinite" }}/>
                  <span style={{ fontFamily:MONO, fontSize:9, color:TEXT, letterSpacing:1 }}>STABLE.OPERATIONAL</span>
                </div>
              </div>
              <div style={{ padding:"8px 16px" }}>
                <div style={{ fontFamily:MONO, fontSize:7, color:MUTED2, letterSpacing:2, marginBottom:4 }}>FILTER_SCOPE</div>
                <div style={{ fontFamily:MONO, fontSize:9, color:TEXT, letterSpacing:1 }}>GLOBAL_REWARDS</div>
              </div>
            </div>
          </div>

          {/* grid */}
          <div style={{
            display:"grid",
            gridTemplateColumns:"repeat(4, 1fr)",
            gap:12,
            animation:"fadeUp .6s .45s both",
          }}>
            {filtered.map((c, i) => (
              <RewardCard key={c.id || i}
                status="LIVE"
                id={c.id}
                name={c.name}
                egress={c.egress}
                recipients={c.recipients}
                reEgress={c.reEgress}
                btnLabel={c.btnLabel}
                locked={c.locked}
                pending={c.pending}
                delay={i * 70}
                onAction={() => {
                  onOpenCampaign(c.campaignId);
                }}
              />
            ))}
          </div>

          {!campaignsLoading && campaignsError ? (
            <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 9, color: "#a58787", lineHeight: 1.8 }}>
              CAMPAIGN API UNAVAILABLE. START THE RUST SERVICE TO POPULATE ACTIVE REWARDS.
            </div>
          ) : null}

          {!campaignsLoading && !campaignsError && filtered.length === 0 ? (
            <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 9, color: MUTED, lineHeight: 1.8 }}>
              NO ACTIVE CAMPAIGNS RETURNED YET.
            </div>
          ) : null}

        </main>

        {/* ── FOOTER ── */}
        <footer style={{
          borderTop:`1px solid ${BORDER}`,
          padding:"14px 40px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          fontFamily:MONO, fontSize:8, color:MUTED2, letterSpacing:1,
          background:"rgba(2,13,15,.8)",
          position:"relative", zIndex:1,
        }}>
          <div>
            <div style={{ color:CYAN, marginBottom:4 }}>ZUS_PROTOCOL_CORE</div>
            <div style={{ color:"#1a4040", lineHeight:1.9 }}>
              © 2026 ZUS PROTOCOL. CATS ARE AMAZING!<br/>
              BUILD_2984-X | NODE_STABLE | UPTIME_99.9%
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ color:"#1a5550", fontSize:7, letterSpacing:2 }}>i like cats</span>
            <PixelCat />
          </div>

          <div style={{ display:"flex", gap:24 }}>
            {["X_FEED","DISCORD_SERVER","GITHUB_REPO","PRIVACY_POLICY","NEWSLETTER_SUB"].map(l => (
              <span key={l} style={{ color:MUTED2, cursor:"pointer", transition:"color .2s", letterSpacing:1.5 }}
                onMouseEnter={e => e.target.style.color = CYAN}
                onMouseLeave={e => e.target.style.color = MUTED2}>{l}</span>
            ))}
          </div>
        </footer>

      </div>
    </>
  );
}
