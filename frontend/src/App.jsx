import { useState, useEffect, useRef, useCallback } from "react";
import { api, connectEvents, getToken, getStoredUser, storeSession, clearSession } from "./api.js";

const FONT_LINK = document.createElement("link");
FONT_LINK.rel = "stylesheet";
FONT_LINK.href = "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600;700&display=swap";
document.head.appendChild(FONT_LINK);

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#050F0A; --surface:#0A1A10; --panel:#0F2418; --border:#163320;
    --muted:#1F4D2E; --text:#D4F5DC; --dim:#5A9E6F; --accent:#10B981;
    --bright:#34D399; --green2:#6EE7B7; --red:#F87171; --orange:#FB923C;
    --yellow:#FCD34D; --teal:#2DD4BF; --lime:#A3E635;
    --font-mono:'Space Mono',monospace; --font-body:'DM Sans',sans-serif;
  }
  /* ── LIGHT THEME — background goes light, every text token darkened for contrast ── */
  body[data-theme="light"] {
    --bg:#F6FAF7; --surface:#FFFFFF; --panel:#EEF4F0; --border:#D3E2D8;
    --muted:#9DB6A8; --text:#0C2116; --dim:#3E5F4B; --accent:#059669;
    --bright:#047857; --green2:#0D9488; --red:#DC2626; --orange:#C2410C;
    --yellow:#A16207; --teal:#0F766E; --lime:#4D7C0F;
  }
  html,body,#root { height:100%; background:var(--bg); color:var(--text); font-family:var(--font-body); transition:background .2s ease,color .2s ease; }
  ::-webkit-scrollbar { width:4px; }
  ::-webkit-scrollbar-thumb { background:var(--muted); border-radius:4px; }

  @keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.25;transform:scale(1.5)} }
  @keyframes glow     { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.6)} 50%{box-shadow:0 0 0 10px rgba(16,185,129,0)} }
  @keyframes redGlow  { 0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,.6)} 50%{box-shadow:0 0 0 10px rgba(248,113,113,0)} }
  @keyframes slideDown{ from{transform:translateY(-110%);opacity:0} to{transform:none;opacity:1} }
  @keyframes fadeIn   { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:none} }
  @keyframes fadeUp   { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
  @keyframes shake    { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
  @keyframes flash    { 0%,100%{opacity:1} 50%{opacity:.2} }
  @keyframes spin     { to{transform:rotate(360deg)} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }

  /* ─── LANDING ── */
  .landing { min-height:100vh; display:flex; flex-direction:column; background:var(--bg); overflow-x:hidden; position:relative; }
  .land-bg { position:fixed; inset:0; pointer-events:none; z-index:0;
    background: radial-gradient(ellipse 60% 50% at 20% 20%, rgba(16,185,129,.07) 0%, transparent 70%),
                radial-gradient(ellipse 40% 60% at 80% 70%, rgba(45,212,191,.05) 0%, transparent 70%); }
  .grid-ov { position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image: linear-gradient(rgba(16,185,129,.04) 1px,transparent 1px),
                      linear-gradient(90deg,rgba(16,185,129,.04) 1px,transparent 1px);
    background-size:40px 40px; }
  .scan-bar { position:fixed; left:0; right:0; height:3px;
    background:linear-gradient(90deg,transparent,rgba(16,185,129,.3),transparent);
    animation:scanline 6s linear infinite; pointer-events:none; z-index:1; }
  .land-nav { position:relative; z-index:10; display:flex; align-items:center; justify-content:space-between;
    padding:20px 40px; border-bottom:1px solid rgba(22,51,32,.6);
    background:rgba(5,15,10,.8); backdrop-filter:blur(10px); }
  body[data-theme="light"] .land-nav { background:rgba(255,255,255,.85); }
  .land-brand { font-family:var(--font-mono); font-size:15px; font-weight:700; color:var(--accent);
    letter-spacing:4px; display:flex; align-items:center; gap:10px; }
  .land-btns { display:flex; gap:8px; align-items:center; }
  .lbtn { padding:9px 20px; border-radius:8px; font-size:13px; font-weight:600;
    cursor:pointer; transition:all .2s; font-family:var(--font-body); border:1px solid; }
  .lbtn-ghost { background:transparent; border-color:var(--border); color:var(--dim); }
  .lbtn-ghost:hover { border-color:var(--accent); color:var(--accent); background:rgba(16,185,129,.05); }
  .lbtn-solid { background:var(--accent); border-color:var(--accent); color:var(--bg); }
  .lbtn-solid:hover { background:var(--bright); }
  .land-hero { position:relative; z-index:5; flex:1; display:flex; flex-direction:column;
    align-items:center; justify-content:center; text-align:center; padding:80px 24px 60px; gap:28px; }
  .eyebrow { display:inline-flex; align-items:center; gap:8px; padding:5px 16px; border-radius:20px;
    background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.2);
    font-family:var(--font-mono); font-size:10px; letter-spacing:2.5px;
    color:var(--accent); text-transform:uppercase; animation:fadeUp .6s ease both; }
  .hero-title { font-size:clamp(42px,8vw,80px); font-weight:700; line-height:1.05;
    letter-spacing:-2px; color:var(--text); animation:fadeUp .7s .1s ease both; }
  .hero-title span { color:var(--accent); }
  .hero-sub { font-size:clamp(14px,2.5vw,17px); color:var(--dim); max-width:520px;
    line-height:1.7; animation:fadeUp .7s .2s ease both; }
  .hero-cta { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; animation:fadeUp .7s .3s ease both; }
  .cta-p { padding:14px 32px; border-radius:9px; font-size:14px; font-weight:700;
    background:var(--accent); border:none; color:var(--bg); cursor:pointer; transition:all .2s;
    font-family:var(--font-body); box-shadow:0 0 30px rgba(16,185,129,.25); }
  .cta-p:hover { background:var(--bright); transform:translateY(-2px); box-shadow:0 0 40px rgba(16,185,129,.4); }
  .hero-device { width:min(480px,90vw); background:var(--surface); border:1px solid var(--border);
    border-radius:16px; padding:20px; box-shadow:0 30px 80px rgba(0,0,0,.5);
    position:relative; overflow:hidden; animation:fadeUp .8s .4s ease both; margin-top:10px; }
  .hero-device::before { content:''; position:absolute; top:0; left:0; right:0; height:1px;
    background:linear-gradient(90deg,transparent,rgba(16,185,129,.5),transparent); }
  .hd-bar  { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .hd-ttl  { font-family:var(--font-mono); font-size:9px; letter-spacing:2px; color:var(--dim); }
  .hd-dots { display:flex; gap:5px; }
  .hd-dot  { width:8px; height:8px; border-radius:50%; }
  .hd-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px; }
  .hd-stat { background:var(--panel); border-radius:8px; padding:10px; border:1px solid var(--border); }
  .hd-sval { font-family:var(--font-mono); font-size:18px; font-weight:700; }
  .hd-slbl { font-size:9px; color:var(--dim); margin-top:3px; }
  .hd-seq  { display:flex; gap:6px; justify-content:center; }
  .hd-si   { padding:5px 12px; border-radius:5px; font-size:10px; font-family:var(--font-mono); border:1px solid var(--border); color:var(--dim); }
  .hd-si.a { background:rgba(16,185,129,.15); color:var(--accent); border-color:var(--accent); }
  .hd-si.f { background:rgba(248,113,113,.15); color:var(--red); border-color:var(--red); animation:flash .5s infinite; }
  .land-feats { position:relative; z-index:5; display:grid;
    grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
    gap:16px; padding:40px; max-width:1100px; margin:0 auto 60px; width:100%; }
  .feat { background:var(--surface); border:1px solid var(--border); border-radius:12px;
    padding:24px; transition:all .25s; animation:fadeUp .7s ease both; }
  .feat:hover { border-color:var(--muted); transform:translateY(-3px); background:var(--panel); }
  .feat-icon  { font-size:28px; margin-bottom:12px; display:block; }
  .feat-title { font-size:15px; font-weight:700; margin-bottom:8px; color:var(--text); }
  .feat-desc  { font-size:13px; color:var(--dim); line-height:1.6; }
  .land-foot  { position:relative; z-index:5; border-top:1px solid var(--border); padding:24px 40px;
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;
    background:rgba(5,15,10,.6); font-family:var(--font-mono); font-size:11px; }
  body[data-theme="light"] .land-foot { background:rgba(238,244,240,.6); }
  .land-foot-brand { color:var(--dim); letter-spacing:2px; }
  .land-foot-copy  { color:var(--muted); }

  /* ─── LOGIN ── */
  .login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:var(--bg); position:relative; padding:24px; }
  .login-bg { position:fixed; inset:0; pointer-events:none;
    background:radial-gradient(ellipse 50% 60% at 50% 40%,rgba(16,185,129,.06) 0%,transparent 70%); }
  .login-card { position:relative; z-index:5; width:100%; max-width:420px;
    background:var(--surface); border:1px solid var(--border); border-radius:16px;
    padding:40px 36px; box-shadow:0 40px 100px rgba(0,0,0,.3); animation:fadeUp .5s ease; }
  .login-card::before { content:''; position:absolute; top:0; left:0; right:0; height:2px;
    border-radius:16px 16px 0 0; background:linear-gradient(90deg,transparent,var(--accent),transparent); }
  .login-brand { display:flex; align-items:center; gap:10px; margin-bottom:8px;
    font-family:var(--font-mono); font-size:16px; font-weight:700; color:var(--accent); letter-spacing:3px; }
  .login-sub  { font-size:12px; color:var(--dim); margin-bottom:28px; font-family:var(--font-mono); }
  .login-field { margin-bottom:16px; }
  .login-lbl  { display:block; font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
    color:var(--dim); font-family:var(--font-mono); margin-bottom:7px; }
  .login-in   { width:100%; padding:11px 14px; border-radius:8px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:13px; font-family:var(--font-body);
    outline:none; transition:all .2s; }
  .login-in:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(16,185,129,.1); }
  .login-in::placeholder { color:var(--muted); }
  .login-in.err { border-color:var(--red); }
  .login-err  { display:flex; align-items:center; gap:6px;
    background:rgba(248,113,113,.08); border:1px solid rgba(248,113,113,.2);
    border-radius:7px; padding:10px 14px; margin-bottom:16px;
    font-size:12px; color:var(--red); font-family:var(--font-mono); animation:fadeIn .3s ease; }
  .login-btn  { width:100%; padding:13px; border-radius:8px;
    background:var(--accent); border:none; color:var(--bg);
    font-size:14px; font-weight:700; font-family:var(--font-body);
    cursor:pointer; transition:all .2s; margin-top:6px;
    display:flex; align-items:center; justify-content:center; gap:8px; }
  .login-btn:hover:not(:disabled) { background:var(--bright); transform:translateY(-1px); box-shadow:0 8px 24px rgba(16,185,129,.3); }
  .login-btn:disabled { opacity:.6; cursor:not-allowed; }
  .login-hint { background:rgba(16,185,129,.06); border:1px solid rgba(16,185,129,.15);
    border-radius:7px; padding:10px 14px; margin-top:14px;
    font-size:11px; color:var(--dim); font-family:var(--font-mono); line-height:1.8; }
  .login-hint span { color:var(--accent); }
  .login-back { display:flex; align-items:center; gap:6px; margin-top:24px;
    font-size:12px; color:var(--muted); font-family:var(--font-mono);
    cursor:pointer; transition:color .2s; justify-content:center;
    background:none; border:none; }
  .login-back:hover { color:var(--accent); }
  .spin { width:16px; height:16px; border:2px solid rgba(5,15,10,.3);
    border-top-color:var(--bg); border-radius:50%; animation:spin .7s linear infinite; }

  /* ─── THEME TOGGLE ── */
  .theme-toggle { display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:20px;
    background:var(--panel); border:1px solid var(--border); cursor:pointer;
    font-family:var(--font-mono); font-size:11px; color:var(--dim); transition:all .15s; }
  .theme-toggle:hover { border-color:var(--accent); color:var(--accent); }

  /* ─── NAVBAR ── */
  .navbar { height:56px;
    background:linear-gradient(90deg,var(--surface),var(--bg));
    border-bottom:1px solid var(--border);
    display:flex; align-items:center; padding:0 16px; gap:0;
    position:sticky; top:0; z-index:100; flex-shrink:0;
    box-shadow:0 2px 20px rgba(16,185,129,.08); }
  .nav-brand { font-family:var(--font-mono); font-size:14px; font-weight:700;
    color:var(--accent); letter-spacing:3px;
    display:flex; align-items:center; gap:10px; margin-right:16px; flex-shrink:0; }
  .brand-dot { width:10px; height:10px; border-radius:50%; background:var(--accent);
    animation:pulse 2s infinite; box-shadow:0 0 12px var(--accent); }
  .nav-right { display:flex; align-items:center; gap:6px; margin-left:auto; flex-shrink:0; }
  .nb { padding:4px 10px; border-radius:6px; font-size:10px; font-weight:600;
    font-family:var(--font-mono); white-space:nowrap; }
  .nb-live  { background:rgba(16,185,129,.12); color:var(--accent); border:1px solid rgba(16,185,129,.3); }
  .nb-rat   { background:rgba(248,113,113,.12); color:var(--red);    border:1px solid rgba(248,113,113,.3); }
  .nb-rpi   { background:rgba(52,211,153,.12);  color:var(--bright); border:1px solid rgba(52,211,153,.3); }
  .nb-admin { background:rgba(16,185,129,.12);  color:var(--accent); border:1px solid rgba(16,185,129,.3); }
  .nb-user  { background:rgba(45,212,191,.12);  color:var(--teal);   border:1px solid rgba(45,212,191,.3); }
  .nb-off   { background:rgba(90,158,111,.1);   color:var(--dim);    border:1px solid var(--border); }
  .nav-time { font-family:var(--font-mono); font-size:12px; color:var(--accent); }
  .nav-user { display:flex; align-items:center; gap:7px; padding:5px 10px; border-radius:6px;
    background:var(--panel); border:1px solid var(--border);
    font-size:11px; font-family:var(--font-mono); color:var(--dim); }
  .nav-out  { padding:5px 10px; border-radius:6px; font-size:10px; font-weight:600;
    font-family:var(--font-mono); background:rgba(248,113,113,.08);
    border:1px solid rgba(248,113,113,.2); color:var(--red); cursor:pointer; transition:all .2s; }
  .nav-out:hover { background:rgba(248,113,113,.15); }

  /* ─── LAYOUT ── */
  .app  { display:flex; flex-direction:column; height:100vh; overflow:hidden; }
  .body { display:flex; flex:1; overflow:hidden; }

  /* ─── SIDEBAR — always visible on desktop ── */
  .sidebar {
    width:220px; min-width:220px; flex-shrink:0;
    background:var(--surface); border-right:1px solid var(--border);
    display:flex; flex-direction:column; padding:14px 0; overflow-y:auto;
  }
  .sb-section { padding:0 10px; margin-bottom:4px; }
  .sb-label { font-size:9px; letter-spacing:2.5px; color:var(--muted); text-transform:uppercase;
    padding:8px 8px 4px; font-family:var(--font-mono); display:flex; align-items:center; gap:6px; }
  .sb-label.admin-lbl { color:var(--accent); }
  .sb-item { display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:7px;
    cursor:pointer; font-size:13px; font-weight:500; color:var(--dim); transition:all .18s;
    margin-bottom:1px; border:1px solid transparent; }
  .sb-item:hover { background:var(--panel); color:var(--text); }
  .sb-item.active { background:rgba(16,185,129,.1); color:var(--accent);
    border-color:rgba(16,185,129,.2); box-shadow:inset 3px 0 0 var(--accent); }
  .sb-icon { font-size:15px; width:20px; text-align:center; }
  .sb-divider { height:1px; background:var(--border); margin:8px 10px; }
  .admin-zone { margin:2px 6px 6px; padding:6px; border-radius:10px; border:1px solid rgba(16,185,129,.16); background:rgba(16,185,129,.03); }

  /* ADMIN PANEL bar (consolidated System Config / User Management / Detection Analytics) */
  .admin-panel-bar { display:flex; align-items:center; justify-content:space-between; gap:14px;
    flex-wrap:wrap; margin-bottom:18px; padding:12px 16px; border-radius:10px;
    background:rgba(16,185,129,.05); border:1px solid rgba(16,185,129,.18); }
  .admin-panel-lbl { font-family:var(--font-mono); font-size:11px; letter-spacing:2px; color:var(--accent);
    display:flex; align-items:center; gap:8px; text-transform:uppercase; }
  .admin-panel-sub { color:var(--dim); letter-spacing:0.5px; text-transform:none; font-size:11px; }
  .admin-panel-tabs { display:flex; gap:8px; flex-wrap:wrap; }
  .admin-tab { display:flex; align-items:center; gap:7px; padding:9px 18px; border-radius:20px;
    border:1px solid var(--border); background:var(--panel); color:var(--dim);
    font-size:12px; font-weight:600; font-family:var(--font-body); cursor:pointer; transition:all .18s; }
  .admin-tab:hover { border-color:var(--muted); color:var(--text); }
  .admin-tab.active { background:rgba(16,185,129,.14); border-color:var(--accent); color:var(--accent);
    box-shadow:0 0 0 1px rgba(16,185,129,.25) inset; }
  .rpi-panel { margin:8px 10px; border-radius:8px; background:rgba(16,185,129,.06);
    border:1px solid rgba(16,185,129,.2); padding:11px; }
  .rpi-panel.offline { background:rgba(248,113,113,.05); border-color:rgba(248,113,113,.2); }
  .rpi-lbl  { font-size:9px; font-family:var(--font-mono); color:var(--accent); letter-spacing:2px; margin-bottom:5px; }
  .rpi-stat { font-size:11px; font-family:var(--font-mono); display:flex; align-items:center; gap:6px; }
  .rpi-ip   { font-size:10px; color:var(--dim); margin-top:4px; font-family:var(--font-mono); }
  .det-panel { margin:6px 10px 0; border-radius:8px; background:rgba(248,113,113,.05);
    border:1px solid rgba(248,113,113,.15); padding:11px; }
  .det-panel.active { animation:redGlow 2.5s infinite; }
  .det-lbl  { font-size:9px; font-family:var(--font-mono); color:var(--red); letter-spacing:2px; margin-bottom:5px; }
  .det-stat { font-size:11px; font-family:var(--font-mono); display:flex; align-items:center; gap:6px; }
  .det-cnt  { font-size:10px; color:var(--dim); margin-top:4px; }
  .pdot { display:inline-block; width:7px; height:7px; border-radius:50%; animation:pulse 1.2s infinite; }
  .sb-footer { margin-top:auto; padding:12px 16px; border-top:1px solid var(--border);
    font-size:10px; color:var(--dim); font-family:var(--font-mono); }

  /* ─── MAIN ── */
  .main { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }
  .rat-alert { background:linear-gradient(90deg,rgba(248,113,113,.14),rgba(251,146,60,.06));
    border-bottom:1px solid rgba(248,113,113,.3); padding:10px 16px;
    display:flex; align-items:center; gap:10px;
    animation:slideDown .35s ease; flex-shrink:0; flex-wrap:wrap; }
  .rat-icon { font-size:20px; animation:shake .6s infinite; }
  .rat-msg  { font-family:var(--font-mono); font-size:11px; color:var(--red);
    letter-spacing:1px; flex:1; font-weight:700; min-width:160px; }
  .seq-row  { display:flex; gap:5px; flex-wrap:wrap; }
  .ss { padding:3px 8px; border-radius:4px; font-size:10px; font-family:var(--font-mono);
    border:1px solid; transition:all .3s; }
  .ss.done { background:rgba(16,185,129,.15); color:var(--accent); border-color:var(--accent); }
  .ss.now  { background:rgba(248,113,113,.18); color:var(--red); border-color:var(--red); animation:flash .5s infinite; }
  .ss.wait { color:var(--muted); border-color:var(--muted); }
  .ss.last-now { background:rgba(251,146,60,.18); color:var(--orange); border-color:var(--orange); animation:flash .4s infinite; }
  .dismiss { padding:5px 11px; border-radius:5px; border:1px solid var(--red);
    background:transparent; color:var(--red); font-size:11px; cursor:pointer; font-family:var(--font-mono); }
  .dismiss:hover { background:rgba(248,113,113,.12); }
  .content { flex:1; overflow-y:auto; padding:18px 20px; }

  /* TOAST */
  .toast { position:fixed; bottom:20px; right:20px; z-index:300; background:var(--surface);
    border:1px solid var(--red); color:var(--red); padding:12px 18px; border-radius:8px;
    font-family:var(--font-mono); font-size:12px; box-shadow:0 12px 30px rgba(0,0,0,.35);
    animation:fadeUp .25s ease; max-width:320px; }

  /* ACCESS DENIED */
  .access-denied { display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:60vh; gap:16px; text-align:center; }
  .ad-icon  { font-size:48px; }
  .ad-title { font-family:var(--font-mono); font-size:18px; color:var(--red); letter-spacing:2px; }
  .ad-sub   { font-size:13px; color:var(--dim); }

  /* STATUS BAR */
  .status-bar { display:grid; grid-template-columns:repeat(5,1fr); gap:10px;
    background:var(--surface); border:1px solid var(--border);
    border-radius:10px; padding:14px; margin-bottom:16px; }
  .si-label { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--dim);
    font-family:var(--font-mono); margin-bottom:4px; }
  .si-val   { font-family:var(--font-mono); font-size:14px; font-weight:700; }
  .si-sub   { font-size:10px; color:var(--dim); margin-top:3px; }

  /* METRICS */
  .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .mc { background:var(--surface); border:1px solid var(--border);
    border-radius:10px; padding:16px; position:relative; overflow:hidden; transition:all .2s; }
  .mc:hover { border-color:var(--muted); transform:translateY(-1px); }
  .mc::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; border-radius:10px 10px 0 0; }
  .mc1::before { background:linear-gradient(90deg,#10B981,#34D399); }
  .mc2::before { background:linear-gradient(90deg,#2DD4BF,#6EE7B7); }
  .mc3::before { background:linear-gradient(90deg,#FCD34D,#FB923C); }
  .mc4::before { background:linear-gradient(90deg,#F87171,#F472B6); }
  .mc-lbl { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim);
    font-family:var(--font-mono); margin-bottom:9px; }
  .mc-val { font-family:var(--font-mono); font-size:28px; font-weight:700; line-height:1; }
  .mc-sub { font-size:11px; color:var(--dim); margin-top:7px; }
  .badge { display:inline-flex; align-items:center; gap:3px; font-size:10px;
    padding:2px 7px; border-radius:4px; font-family:var(--font-mono); }
  .bg { background:rgba(16,185,129,.12); color:var(--accent); }
  .br { background:rgba(248,113,113,.12); color:var(--red); }
  .bt { background:rgba(45,212,191,.12);  color:var(--teal); }

  /* CHARTS */
  .charts-row { display:grid; grid-template-columns:1fr 260px; gap:12px; margin-bottom:16px; }
  .cc { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .cc-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px; }
  .cc-title { font-family:var(--font-mono); font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); }
  .cc-canvas { width:100%; height:145px; }
  .donut-ring { width:90px; height:90px; margin:0 auto 12px; }
  svg.donut { transform:rotate(-90deg); }

  /* TRIGGERS */
  .tgrid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .tcard { background:var(--surface); border:1px solid var(--border);
    border-radius:10px; padding:16px; transition:all .25s; position:relative; overflow:hidden; }
  .tcard.armed   { border-color:rgba(16,185,129,.35); background:rgba(16,185,129,.04); }
  .tcard.firing  { border-color:var(--accent); animation:glow .6s infinite; }
  .tcard.d-armed { border-color:rgba(248,113,113,.3); background:rgba(248,113,113,.04); }
  .tcard.d-fire  { border-color:var(--red); animation:redGlow .4s infinite; }
  .t-icon { font-size:24px; margin-bottom:8px; display:block; }
  .t-name { font-size:13px; font-weight:600; color:var(--text); margin-bottom:2px; }
  .t-desc { font-size:10px; color:var(--dim); font-family:var(--font-mono); margin-bottom:12px; }
  .chip { display:inline-flex; align-items:center; gap:3px; font-size:9px;
    padding:2px 7px; border-radius:10px; font-family:var(--font-mono); margin-bottom:8px; }
  .chip-auto { background:rgba(251,146,60,.1); color:var(--orange); border:1px solid rgba(251,146,60,.2); }
  .chip-rpi  { background:rgba(45,212,191,.1); color:var(--teal);   border:1px solid rgba(45,212,191,.2); }
  .trow { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .tlbl { font-size:11px; color:var(--dim); }
  .tog { width:35px; height:18px; border-radius:9px; border:1px solid var(--muted);
    background:var(--panel); cursor:pointer; position:relative; transition:all .2s; }
  .tog.on  { background:var(--accent); border-color:var(--accent); box-shadow:0 0 8px rgba(16,185,129,.5); }
  .tog.red.on { background:var(--red); border-color:var(--red); box-shadow:0 0 8px rgba(248,113,113,.5); }
  .tog::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px;
    border-radius:50%; background:#fff; transition:transform .2s; }
  .tog.on::after { transform:translateX(16px); }
  .tbtn { width:100%; padding:7px; border-radius:6px; border:1px solid var(--muted);
    background:transparent; color:var(--dim); font-size:11px; cursor:pointer;
    font-family:var(--font-mono); transition:all .15s; }
  .tbtn:hover { background:var(--panel); color:var(--text); }
  .tbtn.ac  { border-color:var(--accent); color:var(--accent); }
  .tbtn.ac:hover { background:rgba(16,185,129,.1); }
  .tbtn.rd  { border-color:var(--red); color:var(--red); }
  .tbtn.rd:hover { background:rgba(248,113,113,.1); }
  .tbtn.now { background:rgba(16,185,129,.18); color:var(--accent); border-color:var(--accent); animation:flash .4s infinite; }
  .tlast { font-size:10px; color:var(--dim); font-family:var(--font-mono); margin-top:7px; }

  /* WEBCAM TEST CAPTURE */
  .capture-card { background:var(--surface); border:1px solid rgba(56,189,248,.3); border-radius:10px; padding:16px; margin-bottom:16px; }
  .capture-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; flex-wrap:wrap; gap:8px; }
  .capture-title { font-family:var(--font-mono); font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#38BDF8; display:flex; align-items:center; gap:8px; }
  .capture-body { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
  .capture-video-wrap { width:220px; height:165px; border-radius:8px; overflow:hidden; background:#000; border:1px solid var(--border); flex-shrink:0; position:relative; }
  .capture-video-wrap video, .capture-video-wrap img { width:100%; height:100%; object-fit:cover; display:block; }
  .capture-actions { display:flex; flex-direction:column; gap:8px; flex:1; min-width:180px; }
  .capture-btn { padding:9px 16px; border-radius:6px; border:1px solid #38BDF8; background:rgba(56,189,248,.1);
    color:#38BDF8; font-weight:600; font-size:13px; cursor:pointer; transition:all .15s; font-family:var(--font-body); }
  .capture-btn:hover:not(:disabled) { background:rgba(56,189,248,.2); }
  .capture-btn:disabled { opacity:.5; cursor:not-allowed; }
  .capture-btn.stop { border-color:var(--red); color:var(--red); background:rgba(248,113,113,.08); }
  .capture-status { font-size:11px; font-family:var(--font-mono); color:var(--dim); }
  .capture-status.ok  { color:var(--accent); }
  .capture-status.err { color:var(--red); }

  /* TABS (Activity: Log / Photos) */
  .tabbar { display:flex; gap:6px; margin-bottom:14px; }
  .tabbtn { padding:8px 18px; border-radius:8px; border:1px solid var(--border); background:var(--surface);
    color:var(--dim); font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; display:flex; align-items:center; gap:6px; }
  .tabbtn.active { background:rgba(16,185,129,.1); color:var(--accent); border-color:rgba(16,185,129,.3); }
  .tabbtn:hover:not(.active) { background:var(--panel); color:var(--text); }

  /* LOG */
  .lcard { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .lhdr  { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
  .lsearch { padding:6px 11px; border-radius:6px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:12px; outline:none;
    font-family:var(--font-body); width:180px; }
  .lsearch:focus { border-color:var(--accent); }
  .lfilters { display:flex; gap:5px; flex-wrap:wrap; }
  .fb { padding:4px 9px; border-radius:5px; border:1px solid var(--border);
    background:transparent; color:var(--dim); font-size:10px; cursor:pointer;
    font-family:var(--font-mono); transition:all .15s; }
  .fb:hover,.fb.on { background:var(--panel); color:var(--text); border-color:var(--muted); }
  .ltable { width:100%; border-collapse:collapse; }
  .ltable th { text-align:left; font-size:9px; letter-spacing:2px; text-transform:uppercase;
    color:var(--dim); padding:7px 9px; border-bottom:1px solid var(--border); font-family:var(--font-mono); }
  .ltable td { padding:9px; font-size:12px; border-bottom:1px solid var(--border); }
  .ltable tr:last-child td { border-bottom:none; }
  .ltable tr:hover td { background:rgba(16,185,129,.03); }
  .ts { font-family:var(--font-mono); font-size:10px; color:var(--dim); }
  .tbadge { display:inline-flex; align-items:center; gap:4px; padding:2px 7px; border-radius:4px;
    font-size:10px; font-family:var(--font-mono); font-weight:700; }
  .tbl  { background:rgba(16,185,129,.1);  color:var(--accent); }
  .tba  { background:rgba(252,211,77,.1);  color:var(--yellow); }
  .tbp  { background:rgba(110,231,183,.1); color:var(--green2); }
  .tblr { background:rgba(248,113,113,.1); color:var(--red); }
  .tbd  { background:rgba(251,146,60,.1);  color:var(--orange); }
  .tbc  { background:rgba(56,189,248,.1);  color:#38BDF8; }
  .sok  { color:var(--accent); font-size:10px; font-family:var(--font-mono); }
  .sfail{ color:var(--red);    font-size:10px; font-family:var(--font-mono); }
  .spending{ color:var(--yellow); font-size:10px; font-family:var(--font-mono); }
  .new-r td { animation:fadeIn .4s ease; }
  .rat-r td { background:rgba(248,113,113,.025); }
  .lst-r td { background:rgba(251,146,60,.025); }
  .pgbtn { padding:3px 9px; border-radius:4px; border:1px solid var(--border);
    background:transparent; color:var(--dim); font-family:var(--font-mono); font-size:10px; cursor:pointer; }
  .pgbtn.on { background:var(--accent); color:var(--bg); border-color:var(--accent); }
  .photo-link-btn { background:transparent; border:1px solid var(--border); color:var(--dim);
    padding:3px 9px; border-radius:4px; font-family:var(--font-mono); font-size:9px; cursor:pointer; }
  .photo-link-btn:hover { border-color:var(--teal); color:var(--teal); }

  /* GALLERY */
  .gallery-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  .gallery-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; }
  .gallery-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; transition:all .2s; }
  .gallery-card:hover { border-color:var(--accent); transform:translateY(-2px); }
  .gallery-thumb { width:100%; aspect-ratio:4/3; display:block; background:var(--panel); object-fit:cover; }
  .gallery-meta { padding:10px 12px; }
  .gallery-time { font-family:var(--font-mono); font-size:10px; color:var(--dim); }
  .gallery-type { font-size:12px; font-weight:600; margin-top:3px; }
  .gallery-empty { text-align:center; padding:60px 20px; color:var(--dim); background:var(--surface);
    border:1px solid var(--border); border-radius:10px; font-size:13px; line-height:1.7; }

  /* IOT / DEVICE (within Settings) */
  .iot-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:18px; }
  .iot-title { font-family:var(--font-mono); font-size:10px; letter-spacing:2px;
    text-transform:uppercase; color:var(--dim); margin-bottom:14px; }
  .input-iot { padding:8px 12px; border-radius:6px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:13px; font-family:var(--font-mono);
    outline:none; flex:1; min-width:180px; }
  .input-iot:focus { border-color:var(--accent); }
  .input-iot:disabled { opacity:.5; cursor:not-allowed; }
  .iot-btn { padding:9px 18px; border-radius:6px; border:1px solid; font-family:var(--font-body);
    font-weight:600; font-size:13px; cursor:pointer; transition:all .15s; }
  .iot-btn.prim { border-color:var(--accent); color:var(--accent); background:rgba(16,185,129,.08); }
  .iot-btn.prim:hover { background:rgba(16,185,129,.18); }
  .iot-btn.ghost { border-color:var(--border); color:var(--dim); background:transparent; }
  .iot-btn.ghost:hover { border-color:var(--red); color:var(--red); }
  .iot-btn:disabled { opacity:.4; cursor:not-allowed; }
  .locked-banner { display:flex; align-items:center; gap:10px; padding:12px 16px; border-radius:8px;
    background:rgba(252,211,77,.08); border:1px solid rgba(252,211,77,.25); color:var(--yellow);
    font-size:13px; margin-bottom:14px; }
  .owner-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; border-radius:6px;
    background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.25); color:var(--accent);
    font-family:var(--font-mono); font-size:12px; }
  .setup-wizard { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:14px; }
  .setup-step { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; position:relative; }
  .setup-step.done { border-color:rgba(16,185,129,.35); background:rgba(16,185,129,.03); }
  .setup-step-num { width:24px; height:24px; border-radius:50%; background:var(--panel); border:1px solid var(--border);
    display:flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-weight:700; font-size:11px; color:var(--dim); margin-bottom:8px; }
  .setup-step.done .setup-step-num { background:var(--accent); border-color:var(--accent); color:var(--bg); }
  .setup-step-title { font-size:12px; font-weight:700; margin-bottom:4px; }
  .setup-step-desc { font-size:10px; color:var(--dim); line-height:1.5; }
  .command-box { background:var(--panel); border:1px solid var(--border); border-radius:8px;
    padding:14px 16px; font-family:var(--font-mono); font-size:12px; color:var(--accent);
    display:flex; align-items:center; justify-content:space-between; gap:10px; overflow-x:auto; }
  .copy-btn { flex-shrink:0; padding:5px 12px; border-radius:5px; background:transparent;
    border:1px solid var(--border); color:var(--dim); cursor:pointer; font-family:var(--font-mono); font-size:10px; }
  .copy-btn:hover { border-color:var(--accent); color:var(--accent); }
  .pin-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:4px; }
  .pin-item { background:var(--panel); border-radius:7px; padding:12px;
    border:1px solid var(--border); text-align:center; }
  .pin-num  { font-family:var(--font-mono); font-size:17px; font-weight:700; }
  .pin-name { font-size:11px; color:var(--dim); margin-top:3px; }

  /* SETTINGS */
  .sg { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .scard { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:18px; }
  .scard.full { grid-column:span 2; }
  .sc-title { font-family:var(--font-mono); font-size:10px; letter-spacing:2px;
    text-transform:uppercase; color:var(--dim); margin-bottom:14px; }
  .srow { display:flex; align-items:center; justify-content:space-between;
    padding:9px 0; border-bottom:1px solid var(--border); }
  .srow:last-child { border-bottom:none; }
  .sn { font-size:13px; font-weight:500; }
  .sd { font-size:11px; color:var(--dim); margin-top:2px; }
  .sin { padding:5px 9px; border-radius:5px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:12px; font-family:var(--font-mono);
    outline:none; width:70px; text-align:right; }
  .sin:focus { border-color:var(--accent); }

  /* ACCOUNTS PAGE */
  .acct-toolbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px; }
  .acct-add-form { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px;
    display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
  .af-field { display:flex; flex-direction:column; gap:5px; }
  .af-lbl { font-size:10px; color:var(--dim); font-family:var(--font-mono); letter-spacing:1px; }
  .af-in { padding:8px 11px; border-radius:6px; border:1px solid var(--border); background:var(--panel);
    color:var(--text); font-size:13px; outline:none; width:150px; }
  .af-in:focus { border-color:var(--accent); }
  .af-sel { padding:8px 11px; border-radius:6px; border:1px solid var(--border); background:var(--panel);
    color:var(--text); font-size:13px; outline:none; cursor:pointer; }
  .af-btn { padding:9px 20px; border-radius:6px; border:1px solid var(--accent); background:rgba(16,185,129,.1);
    color:var(--accent); font-weight:600; font-size:13px; cursor:pointer; transition:all .15s; }
  .af-btn:hover { background:rgba(16,185,129,.2); }
  .acct-list { display:flex; flex-direction:column; gap:10px; }
  .acct-row { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 18px;
    display:flex; align-items:center; gap:16px; flex-wrap:wrap; transition:all .15s; }
  .acct-row.inactive { opacity:.55; }
  .acct-avatar { width:38px; height:38px; border-radius:50%; background:rgba(16,185,129,.12);
    display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--accent); flex-shrink:0; }
  .acct-info { flex:1; min-width:140px; }
  .acct-name { font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .acct-meta { font-size:11px; color:var(--dim); font-family:var(--font-mono); margin-top:2px; }
  .acct-stats { display:flex; gap:14px; font-size:11px; color:var(--dim); font-family:var(--font-mono); }
  .acct-stats b { color:var(--text); }
  .acct-actions { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .role-sel { padding:5px 9px; border-radius:5px; border:1px solid var(--border); background:var(--panel);
    color:var(--text); font-size:11px; font-family:var(--font-mono); cursor:pointer; }
  .status-pill { font-size:10px; font-family:var(--font-mono); padding:3px 9px; border-radius:10px; font-weight:700; }
  .status-pill.active { background:rgba(16,185,129,.12); color:var(--accent); }
  .status-pill.inactive { background:rgba(248,113,113,.12); color:var(--red); }
  .deact-btn { padding:6px 12px; border-radius:5px; border:1px solid var(--border); background:transparent;
    color:var(--dim); font-size:11px; cursor:pointer; font-family:var(--font-mono); }
  .deact-btn:hover { border-color:var(--red); color:var(--red); }
  .react-btn { padding:6px 12px; border-radius:5px; border:1px solid var(--accent); background:rgba(16,185,129,.08);
    color:var(--accent); font-size:11px; cursor:pointer; font-family:var(--font-mono); }
  .react-btn:hover { background:rgba(16,185,129,.16); }

  /* ANALYTICS PAGE */
  .an-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .an-stat { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .an-stat-lbl { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); font-family:var(--font-mono); margin-bottom:8px; }
  .an-stat-val { font-family:var(--font-mono); font-size:26px; font-weight:700; }
  .an-stat-sub { font-size:11px; color:var(--dim); margin-top:6px; }
  .an-row { display:grid; grid-template-columns:1.4fr 1fr; gap:12px; margin-bottom:16px; }
  .conf-bars { display:flex; align-items:flex-end; gap:8px; height:120px; padding-top:10px; }
  .conf-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; justify-content:flex-end; height:100%; }
  .conf-fill { width:100%; border-radius:4px 4px 0 0; background:var(--accent); transition:height .4s ease; min-height:2px; }
  .conf-lbl { font-size:9px; color:var(--dim); font-family:var(--font-mono); }
  .conf-count { font-size:10px; color:var(--text); font-weight:700; }
  .eff-bar-track { height:14px; background:var(--panel); border-radius:7px; overflow:hidden; display:flex; margin:10px 0; }
  .eff-bar-resolved { background:var(--accent); }
  .eff-bar-escalated { background:var(--red); }
  .eff-legend { display:flex; gap:16px; font-size:11px; color:var(--dim); flex-wrap:wrap; }
  .eff-legend b { color:var(--text); }
  .export-btn { padding:9px 18px; border-radius:6px; border:1px solid var(--accent); background:rgba(16,185,129,.1);
    color:var(--accent); font-weight:600; font-size:13px; cursor:pointer; transition:all .15s; display:flex; align-items:center; gap:8px; }
  .export-btn:hover { background:rgba(16,185,129,.2); }

  /* DAILY REPORT — card summary + weekly bar chart + horizontal distributions */
  .ds-cards { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px; }
  .ds-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:22px 16px; text-align:center; }
  .ds-val { font-family:var(--font-mono); font-size:32px; font-weight:700; line-height:1; }
  .ds-lbl { font-size:12px; color:var(--dim); margin-top:8px; }
  .ds-trend { font-size:11px; margin-top:9px; font-family:var(--font-mono); }
  .ds-trend.up { color:var(--accent); }
  .ds-trend.down { color:var(--red); }
  .ds-trend.flat { color:var(--dim); }
  .week-row { display:grid; grid-template-columns:1.4fr 1fr; gap:12px; margin-bottom:16px; }
  .week-bars { display:flex; align-items:flex-end; gap:12px; height:150px; padding-top:10px; }
  .week-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; }
  .week-bar-pair { display:flex; gap:3px; align-items:flex-end; flex:1; width:100%; justify-content:center; }
  .week-bar { width:11px; border-radius:3px 3px 0 0; min-height:2px; transition:height .4s ease; }
  .week-lbl { font-size:9px; color:var(--dim); font-family:var(--font-mono); margin-top:6px; }
  .hbar-list { display:flex; flex-direction:column; gap:13px; }
  .hbar-row { display:flex; align-items:center; gap:10px; }
  .hbar-icon-lbl { width:92px; font-size:12px; color:var(--dim); display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .hbar-track { flex:1; height:10px; background:var(--panel); border-radius:6px; overflow:hidden; }
  .hbar-fill { height:100%; border-radius:6px; transition:width .4s ease; }
  .hbar-val { width:34px; text-align:right; font-family:var(--font-mono); font-size:11px; color:var(--text); flex-shrink:0; }

  @media (max-width:900px) {
    .status-bar { grid-template-columns:repeat(3,1fr); }
    .metrics    { grid-template-columns:repeat(2,1fr); }
    .tgrid      { grid-template-columns:repeat(2,1fr); }
    .charts-row { grid-template-columns:1fr; }
    .sg         { grid-template-columns:1fr; }
    .scard.full { grid-column:span 1; }
    .setup-wizard { grid-template-columns:1fr; }
    .an-grid    { grid-template-columns:repeat(2,1fr); }
    .an-row     { grid-template-columns:1fr; }
  }
  @media (max-width:600px) {
    .metrics    { grid-template-columns:1fr; }
    .tgrid      { grid-template-columns:1fr; }
    .status-bar { grid-template-columns:repeat(2,1fr); }
    .an-grid    { grid-template-columns:1fr; }
  }
`;

const stEl = document.createElement("style");
stEl.textContent = css;
document.head.appendChild(stEl);

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIGGER_TYPES = ["lights", "audio", "pepper", "last"];
const TYPE_META = {
  lights: { label: "Lights",     icon: "💡", cls: "tbl",  color: "#10B981" },
  audio:  { label: "Audio",      icon: "🔊", cls: "tba",  color: "#FCD34D" },
  pepper: { label: "Peppermint", icon: "🌿", cls: "tbp",  color: "#6EE7B7" },
  last:   { label: "Last Resort",icon: "🚨", cls: "tblr", color: "#F87171" },
  capture:{ label: "Test Capture",icon: "📸", cls: "tbc", color: "#38BDF8" },
};
const AUTO_SEQ = ["lights", "audio", "pepper"];

function fmtT(d) { return new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmtD(d) { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
function statusBadge(status) {
  if (status === "ok") return <span className="sok">● OK</span>;
  if (status === "fail") return <span className="sfail">✕ FAIL</span>;
  return <span className="spending">◌ PENDING</span>;
}

// ── Landing ───────────────────────────────────────────────────────────────────
function LandingPage({ onLogin, theme, onToggleTheme }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 2000); return () => clearInterval(t); }, []);
  const seq = ["💡 LIGHTS", "🔊 AUDIO", "🌿 PEPPER", "🚨 LAST"];
  const ai = tick % 4;
  return (
    <div className="landing">
      <div className="land-bg" /><div className="grid-ov" /><div className="scan-bar" />
      <nav className="land-nav">
        <div className="land-brand"><span className="pdot" style={{ background: "var(--accent)" }} /> RATAVERT</div>
        <div className="land-btns">
          <button className="theme-toggle" onClick={onToggleTheme}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
          <button className="lbtn lbtn-ghost" onClick={onLogin}>Sign In</button>
          <button className="lbtn lbtn-solid" onClick={onLogin}>Launch Dashboard →</button>
        </div>
      </nav>
      <section className="land-hero">
        <div className="eyebrow"><span className="pdot" />IoT · YOLOv8 · Raspberry Pi</div>
        <h1 className="hero-title">Smart Rat<br /><span>Deterrence</span><br />System</h1>
        <p className="hero-sub">Real-time detection + multi-sensory response. Lights, audio, peppermint, and adaptive trapping — with every detection captured on camera by your own Raspberry Pi.</p>
        <div className="hero-cta">
          <button className="cta-p" onClick={onLogin}>⚡ Open Dashboard</button>
        </div>
        <div className="hero-device">
          <div className="hd-bar">
            <span className="hd-ttl">RATAVERT LIVE MONITOR</span>
            <div className="hd-dots">
              <div className="hd-dot" style={{ background: "var(--red)" }} />
              <div className="hd-dot" style={{ background: "var(--yellow)" }} />
              <div className="hd-dot" style={{ background: "var(--accent)" }} />
            </div>
          </div>
          <div className="hd-stats">
            <div className="hd-stat"><div className="hd-sval" style={{ color: "var(--red)" }}>--</div><div className="hd-slbl">Rats Today</div></div>
            <div className="hd-stat"><div className="hd-sval" style={{ color: "var(--accent)" }}>--</div><div className="hd-slbl">Armed</div></div>
            <div className="hd-stat"><div className="hd-sval" style={{ color: "var(--teal)" }}>🍓</div><div className="hd-slbl">Sign in to view</div></div>
          </div>
          <div className="hd-seq">
            {seq.map((s, i) => <div key={i} className={`hd-si ${i < ai ? "a" : i === ai ? "f" : ""}`}>{s}</div>)}
          </div>
        </div>
      </section>
      <section className="land-feats">
        {[
          { icon: "🎯", title: "YOLOv8 Detection", desc: "Computer vision model trained on rat images, running real-time inference on Raspberry Pi edge hardware." },
          { icon: "🔊", title: "Multi-Sensory Response", desc: "Ultrasonic sound, LED strobe, and peppermint oil diffusion activate in sequence to deter rats without chemicals." },
          { icon: "🎲", title: "Anti-Habituation Trap", desc: "Servo-controlled snap trap fires using randomized timing so rats cannot predict or adapt to the pattern." },
          { icon: "📷", title: "Photo Capture", desc: "Every detection saves a timestamped photo from the Pi camera, viewable anytime in Activity → Photos." },
          { icon: "🍓", title: "Guided Setup", desc: "Connect your Raspberry Pi in three simple steps from Settings — no manual code editing required." },
          { icon: "📊", title: "Reports & Analytics", desc: "Detection frequency, deterrence effectiveness, and confidence distributions — exportable for documentation." },
        ].map((f, i) => (
          <div className="feat" key={i} style={{ animationDelay: `${i * 0.08}s` }}>
            <span className="feat-icon">{f.icon}</span>
            <div className="feat-title">{f.title}</div>
            <div className="feat-desc">{f.desc}</div>
          </div>
        ))}
      </section>
      <footer className="land-foot">
        <div className="land-foot-brand">RATAVERT · DNSC · BSIT 2026</div>
        <div className="land-foot-copy">Quita · Talento · Lodovice</div>
      </footer>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({ onSuccess, onBack, theme, onToggleTheme }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    setErr("");
    if (!user || !pass) { setErr("Enter both username and password."); return; }
    setLoading(true);
    try {
      const { token, user: acc } = await api.login(user.trim().toLowerCase(), pass);
      onSuccess(token, acc);
    } catch (e) {
      setErr(e.message || "Invalid credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-bg" /><div className="grid-ov" style={{ opacity: 0.4 }} />
      <button className="theme-toggle" style={{ position: "absolute", top: 24, right: 24, zIndex: 6 }} onClick={onToggleTheme}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
      <div className="login-card">
        <div className="login-brand"><span className="pdot" style={{ background: "var(--accent)" }} />RATAVERT</div>
        <div className="login-sub">// SECURE ACCESS · MONITORING SYSTEM</div>

        {err && <div className="login-err"><span>⚠</span>{err}</div>}

        <div className="login-field">
          <label className="login-lbl">Username</label>
          <input className={`login-in ${err ? "err" : ""}`} placeholder="Username"
            value={user} onChange={(e) => { setUser(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        </div>
        <div className="login-field">
          <label className="login-lbl">Password</label>
          <input className={`login-in ${err ? "err" : ""}`} type="password" placeholder="Password"
            value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        </div>

        <button className="login-btn" onClick={doLogin} disabled={loading}>
          {loading ? <><div className="spin" />Authenticating…</> : "→ Sign In"}
        </button>

        <div className="login-hint">
          First time running the server? Sign in with the seed admin account you
          set in the backend's <span>.env</span> file, then create real accounts
          from Admin Panel → User Management.
        </div>
        <button className="login-back" onClick={onBack}>← Back to landing page</button>
      </div>
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────
function LineChart({ data }) {
  const W = 600, H = 140, p = { t: 8, r: 8, b: 26, l: 26 };
  const iW = W - p.l - p.r, iH = H - p.t - p.b, n = data.length;
  const mx = Math.max(...data.flatMap((d) => [d.lights, d.audio, d.pepper, d.last]), 1);
  const pts = (k) => data.map((d, i) => [p.l + (i / (n - 1)) * iW, p.t + iH - (d[k] / mx) * iH]);
  const path = (k) => pts(k).map((pt, i) => `${i === 0 ? "M" : "L"} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(" ");
  const area = (k) => { const pp = pts(k); return pp.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(" ") + ` L ${(p.l + iW).toFixed(1)} ${(p.t + iH).toFixed(1)} L ${p.l.toFixed(1)} ${(p.t + iH).toFixed(1)} Z`; };
  if (n < 2) return <div style={{ color: "var(--dim)", fontSize: 12, textAlign: "center", padding: "50px 0" }}>Not enough data yet.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>{Object.entries(TYPE_META).map(([k, m]) => (
        <linearGradient key={k} id={`lg${k}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={m.color} stopOpacity=".3" />
          <stop offset="100%" stopColor={m.color} stopOpacity="0" />
        </linearGradient>
      ))}</defs>
      {[.25, .5, .75, 1].map((f) => <line key={f} x1={p.l} y1={p.t + iH * (1 - f)} x2={p.l + iW} y2={p.t + iH * (1 - f)} stroke="var(--border)" strokeWidth="1" />)}
      {Object.keys(TYPE_META).map((k) => <path key={k} d={area(k)} fill={`url(#lg${k})`} />)}
      {Object.entries(TYPE_META).map(([k, m]) => <path key={k} d={path(k)} fill="none" stroke={m.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
      {[0, 4, 8, 12, 16, 20, n - 1].map((i) => (
        <text key={i} x={p.l + (i / (n - 1)) * iW} y={H - 5} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="Space Mono,monospace">{data[i]?.label}</text>
      ))}
    </svg>
  );
}
function DonutChart({ totals }) {
  const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(totals); let cur = 0;
  const r = 36, cx = 46, cy = 46, circ = 2 * Math.PI * r;
  const segs = keys.map((k) => { const f = totals[k] / total; const s = { key: k, off: cur, dash: f * circ }; cur += f * circ; return s; });
  return (
    <div>
      <div className="donut-ring">
        <svg viewBox="0 0 92 92" className="donut" width="90" height="90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="9" />
          {segs.map((s) => <circle key={s.key} cx={cx} cy={cy} r={r} fill="none" stroke={TYPE_META[s.key].color} strokeWidth="9" strokeDasharray={`${s.dash} ${circ - s.dash}`} strokeDashoffset={-s.off} />)}
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {keys.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <div style={{ width: "7px", height: "7px", borderRadius: "2px", background: TYPE_META[k].color }} />
              <span style={{ color: "var(--dim)" }}>{TYPE_META[k].label}</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>{totals[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RatAlert({ seqStep, lastNow, onDismiss }) {
  const steps = ["💡 LIGHTS", "🔊 AUDIO", "🌿 PEPPER"];
  return (
    <div className="rat-alert">
      <span className="rat-icon">🐀</span>
      <div className="rat-msg">⚠ RAT DETECTED — AUTO-RESPONSE ACTIVE</div>
      <div className="seq-row">
        {steps.map((s, i) => <span key={i} className={`ss ${i < seqStep ? "done" : i === seqStep ? "now" : "wait"}`}>{s}</span>)}
        <span className={`ss ${lastNow ? "last-now" : "wait"}`}>🚨 LAST RESORT</span>
      </div>
      <button className="dismiss" onClick={onDismiss}>✕ CLEAR</button>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="access-denied">
      <div className="ad-icon">🔒</div>
      <div className="ad-title">ACCESS DENIED</div>
      <div className="ad-sub">You don't have permission to view this page.<br />Contact an administrator.</div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────
function Dashboard({ logs, chartData, enabled, counts, ratCount, detecting, rpiConnected, photoCount }) {
  const today = logs.filter((l) => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(l.ts) >= d; }).length;
  const lastTs = logs[0];
  return (
    <>
      <div className="status-bar">
        {[
          { label: "Detection",     val: detecting ? "🔴 SCANNING" : "⚪ STANDBY",   color: detecting ? "var(--red)" : "var(--dim)",     sub: detecting ? "Sensors active" : "Paused" },
          { label: "Rats Detected", val: ratCount,                                    color: "var(--red)",                                 sub: "total events" },
          { label: "Photos Saved",  val: photoCount,                                  color: "var(--teal)",                                sub: "see Activity" },
          { label: "Raspberry Pi",  val: rpiConnected ? "🟢 ONLINE" : "🔴 OFFLINE",   color: rpiConnected ? "var(--accent)" : "var(--red)",sub: rpiConnected ? "Reporting in" : "Not connected" },
          { label: "Last Update",   val: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), color: "var(--accent)", sub: "real-time" },
        ].map((s, i) => (
          <div key={i}><div className="si-label">{s.label}</div>
            <div className="si-val" style={{ color: s.color }}>{s.val}</div>
            <div className="si-sub">{s.sub}</div></div>
        ))}
      </div>
      <div className="metrics">
        {[
          { cls: "mc1", label: "Triggers Today", val: today, sub: <span className="badge bg">all sources</span> },
          { cls: "mc2", label: "Armed Devices",  val: Object.values(enabled).filter(Boolean).length, sub: <span style={{ color: "var(--teal)" }}>of 4</span> },
          { cls: "mc3", label: "Last Trigger",   val: lastTs ? lastTs.tsStr : "--:--", sm: true, sub: lastTs ? (lastTs.isRat ? "🐀 Rat detected" : `${TYPE_META[lastTs.type]?.icon || ""} ${TYPE_META[lastTs.type]?.label || ""}`) : "—" },
          { cls: "mc4", label: "Rats Detected",  val: ratCount, sub: <span className="badge br">🐀 confirmed</span> },
        ].map((m, i) => (
          <div key={i} className={`mc ${m.cls}`}>
            <div className="mc-lbl">{m.label}</div>
            <div className="mc-val" style={{ fontSize: m.sm ? "17px" : undefined }}>{m.val}</div>
            <div className="mc-sub">{m.sub}</div>
          </div>
        ))}
      </div>
      <div className="charts-row">
        <div className="cc">
          <div className="cc-hdr">
            <span className="cc-title">Trigger Frequency — Last 24h</span>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {Object.entries(TYPE_META).map(([k, m]) => (
                <span key={k} style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: m.color, display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 7, height: 2, background: m.color, display: "inline-block", borderRadius: 1 }} />{m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="cc-canvas"><LineChart data={chartData} /></div>
        </div>
        <div className="cc"><div className="cc-hdr"><span className="cc-title">Distribution</span></div><DonutChart totals={counts} /></div>
      </div>
      <div className="lcard">
        <div className="lhdr"><span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Recent Activity</span></div>
        <table className="ltable">
          <thead><tr><th>Time</th><th>Type</th><th>By</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--dim)", padding: "26px", fontFamily: "var(--font-mono)", fontSize: "11px" }}>NO ACTIVITY YET — WAITING ON THE PI</td></tr>}
            {logs.slice(0, 8).map((l, i) => (
              <tr key={l.id} className={`${i === 0 ? "new-r" : ""} ${l.isRat ? "rat-r" : ""} ${l.isLast ? "lst-r" : ""}`}>
                <td><span className="ts">{l.dateStr} {l.tsStr}</span></td>
                <td>{l.isRat ? <span className="tbadge tbd">🐀 RAT</span> : l.isLast ? <span className="tbadge tblr">🚨 LAST</span> : <span className={`tbadge ${TYPE_META[l.type]?.cls}`}>{TYPE_META[l.type]?.icon} {TYPE_META[l.type]?.label}</span>}</td>
                <td style={{ fontSize: "11px", color: "var(--dim)" }}>{l.user}</td>
                <td>{statusBadge(l.status)}</td>
                <td style={{ fontSize: "11px", color: "var(--dim)" }}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function describeCameraError(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Click the camera/lock icon in the address bar, allow camera access, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "No camera was found. Make sure your webcam is connected and not already in use by another app (Zoom, Teams, Camera app, another browser tab), then try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy — close any other app or browser tab using it, then try again.";
  }
  return "Camera access failed: " + (e?.message || String(e));
}

// ── Real webcam test capture — actually grabs a frame from the device camera
// and uploads it through the same photo pipeline a Pi detection would use.
// Useful for verifying storage/gallery/log wiring before the Pi is connected.
function CaptureTest({ onCaptured }) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {ok:boolean, msg:string}
  const [preview, setPreview] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  async function start() {
    setStatus(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ ok: false, msg: "This browser doesn't support camera access, or the page isn't loaded over localhost/HTTPS." });
      return;
    }
    let stream;
    try {
      // Prefer a rear camera on phones; harmless "ideal" hint on laptops.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
    } catch {
      try {
        // Fall back to whatever camera is available at all (typical laptop webcam).
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        setStatus({ ok: false, msg: describeCameraError(e2) });
        return;
      }
    }
    streamRef.current = stream;
    setActive(true);
    setPreview(null);
    setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 0);
  }
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }
  function snap() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      async (blob) => {
        if (!blob) { setStatus({ ok: false, msg: "Could not capture frame" }); return; }
        setPreview(URL.createObjectURL(blob));
        setBusy(true);
        try {
          const entry = await api.uploadCapture(blob);
          setStatus({ ok: true, msg: "✅ Uploaded and saved — check Activity → Photos" });
          onCaptured && onCaptured(entry);
        } catch (e) {
          setStatus({ ok: false, msg: "⚠ " + (e.message || "Upload failed") });
        } finally {
          setBusy(false);
        }
      },
      "image/jpeg",
      0.9
    );
    stop();
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return (
    <div className="capture-card">
      <div className="capture-hdr">
        <span className="capture-title">📸 Webcam Test Capture</span>
        <span style={{ fontSize: 11, color: "var(--dim)" }}>Uses this device's camera — a real end-to-end test of the photo pipeline, independent of the Pi</span>
      </div>
      <div className="capture-body">
        <div className="capture-video-wrap">
          {active ? <video ref={videoRef} autoPlay playsInline muted /> : preview ? <img src={preview} alt="Last capture" /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dim)", fontSize: 24 }}>📷</div>}
        </div>
        <div className="capture-actions">
          {!active && <button className="capture-btn" onClick={start}>▶ Start Camera</button>}
          {active && <button className="capture-btn" onClick={snap} disabled={busy}>{busy ? "Uploading…" : "📸 Capture & Upload"}</button>}
          {active && <button className="capture-btn stop" onClick={stop}>✕ Cancel</button>}
          {status && <div className={`capture-status ${status.ok ? "ok" : "err"}`}>{status.msg}</div>}
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

function Triggers({ enabled, setEnabled, logs, onFire, firingKey, rpiConnected, notice, onCaptured }) {
  const types = [
    { key: "lights", icon: "💡", name: "Lights",      desc: "Strobe / illuminate", danger: false },
    { key: "audio",  icon: "🔊", name: "Audio Alert", desc: "Broadcast alarm",     danger: false },
    { key: "pepper", icon: "🌿", name: "Peppermint",  desc: "Trigger spray",       danger: false },
    { key: "last",   icon: "🚨", name: "Last Resort", desc: "Auto if rat stays",   danger: true },
  ];
  const lastFor = (k) => logs.find((l) => l.type === k && !l.isRat);
  return (
    <>
      <div style={{ marginBottom: "16px", padding: "12px 16px", background: "rgba(16,185,129,.06)", border: "1px solid rgba(16,185,129,.18)", borderRadius: "8px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--accent)", marginBottom: "3px", letterSpacing: "1px" }}>🐀 AUTO-RESPONSE SEQUENCE</div>
        <div style={{ fontSize: "12px", color: "var(--dim)" }}>Triggers fire automatically when the Pi confirms a rat: 💡→🔊→🌿→🚨. You can also arm/disarm and test-fire manually — the Pi is the one that actually performs the action and acknowledges it back here.</div>
      </div>
      {!rpiConnected && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(248,113,113,.06)", border: "1px solid rgba(248,113,113,.2)", borderRadius: 8, color: "var(--red)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          🔴 Pi is offline — test-fires will be queued but won't run until it reconnects.
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(252,211,77,.08)", border: "1px solid rgba(252,211,77,.25)", borderRadius: 8, color: "var(--yellow)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {notice}
        </div>
      )}
      <CaptureTest onCaptured={onCaptured} />

      <div className="tgrid">
        {types.map((t) => {
          const on = enabled[t.key], firing = firingKey === t.key, last = lastFor(t.key);
          return (
            <div key={t.key} className={`tcard ${on && !t.danger ? "armed" : ""} ${firing && !t.danger ? "firing" : ""} ${on && t.danger ? "d-armed" : ""} ${firing && t.danger ? "d-fire" : ""}`}>
              <span className="t-icon">{t.icon}</span>
              <div className="t-name">{t.name}</div>
              <div className="t-desc">{t.desc}</div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
                <span className="chip chip-auto">🚨 AUTO</span>
                {rpiConnected && <span className="chip chip-rpi">🍓 GPIO</span>}
              </div>
              <div className="trow">
                <span className="tlbl">Armed</span>
                <div className={`tog ${on ? "on" : ""} ${t.danger ? "red" : ""}`}
                  onClick={() => setEnabled(t.key, !on)}
                  style={{ cursor: "pointer" }} />
              </div>
              <button className={`tbtn ${on ? (t.danger ? "rd" : "ac") : ""} ${firing ? "now" : ""}`}
                onClick={() => on && onFire(t.key)}
                style={{ cursor: on ? "pointer" : "not-allowed", opacity: on ? 1 : 0.4 }}>
                {firing ? "⚡ FIRING..." : t.danger ? "⚠ TEST" : "▶ TEST FIRE"}
              </button>
              {last && <div className="tlast">Last: {last.dateStr} {last.tsStr} · {last.status === "ok" ? "confirmed" : "failed"}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Activity Log table ──────────────────────────────────────────────────────
function ActivityLogTable({ logs, onViewPhoto }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [pg, setPg] = useState(0); const PP = 12;
  const filtered = logs.filter((l) => {
    const mt = filter === "all" || l.type === filter || (filter === "rat" && l.isRat) || (filter === "last" && l.isLast);
    const ms = search === "" || (l.detail || "").toLowerCase().includes(search.toLowerCase()) || (l.user || "").includes(search);
    return mt && ms;
  });
  const pages = Math.ceil(filtered.length / PP);
  const visible = filtered.slice(pg * PP, (pg + 1) * PP);
  return (
    <div className="lcard">
      <div className="lhdr">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Activity Log <span style={{ color: "var(--accent)", marginLeft: 6 }}>{filtered.length}</span></span>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <input className="lsearch" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPg(0); }} />
          <div className="lfilters">
            {["all", "rat", "lights", "audio", "pepper", "last"].map((f) => (
              <button key={f} className={`fb ${filter === f ? "on" : ""}`} onClick={() => { setFilter(f); setPg(0); }}>
                {f === "all" ? "ALL" : f === "rat" ? "🐀 RAT" : TYPE_META[f]?.icon + " " + TYPE_META[f]?.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ltable">
          <thead><tr><th>Date</th><th>Time</th><th>Type</th><th>By</th><th>Status</th><th>Detail</th><th>Photo</th></tr></thead>
          <tbody>
            {visible.map((l, i) => (
              <tr key={l.id} className={`${i === 0 && pg === 0 ? "new-r" : ""} ${l.isRat ? "rat-r" : ""} ${l.isLast ? "lst-r" : ""}`}>
                <td><span className="ts">{l.dateStr}</span></td>
                <td><span className="ts">{l.tsStr}</span></td>
                <td>{l.isRat ? <span className="tbadge tbd">🐀 RAT</span> : l.isLast ? <span className="tbadge tblr">🚨 LAST</span> : <span className={`tbadge ${TYPE_META[l.type]?.cls}`}>{TYPE_META[l.type]?.icon} {TYPE_META[l.type]?.label}</span>}</td>
                <td style={{ fontSize: "11px", color: "var(--dim)" }}>{l.user}</td>
                <td>{statusBadge(l.status)}</td>
                <td style={{ fontSize: "11px", color: "var(--dim)" }}>{l.detail}</td>
                <td>{l.photoId ? <button className="photo-link-btn" onClick={() => onViewPhoto && onViewPhoto(l.photoId)}>📷 View</button> : <span style={{ color: "var(--muted)", fontSize: "10px" }}>—</span>}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--dim)", padding: "26px", fontFamily: "var(--font-mono)", fontSize: "11px" }}>NO RESULTS FOUND</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>{Array.from({ length: pages }, (_, i) => <button key={i} className={`pgbtn ${i === pg ? "on" : ""}`} onClick={() => setPg(i)}>{i + 1}</button>)}</div>}
    </div>
  );
}

// ── Photo gallery grid ───────────────────────────────────────────────────────
function PhotoGallery({ photos }) {
  return (
    <>
      <div className="gallery-toolbar">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Captured Photos <span style={{ color: "var(--accent)", marginLeft: 6 }}>{photos.length}</span></span>
      </div>
      {photos.length === 0 ? (
        <div className="gallery-empty">No photos captured yet.<br />Photos are saved automatically whenever the Pi detects a rat.</div>
      ) : (
        <div className="gallery-grid">
          {photos.map((p) => {
            const m = TYPE_META[p.type] || TYPE_META[p.escalated ? "last" : "pepper"];
            const label = p.isRat
              ? `🐀 Rat Detected${p.confidence != null ? ` · ${Math.round(p.confidence * 100)}%` : ""}`
              : `📸 Test Capture${p.capturedBy ? ` · ${p.capturedBy}` : ""}`;
            return (
              <div className="gallery-card" key={p.id} id={`photo-${p.id}`}>
                {p.url ? <img className="gallery-thumb" src={api.photoUrl(p.url)} alt="Captured detection" /> : <div className="gallery-thumb" />}
                <div className="gallery-meta">
                  <div className="gallery-time">{p.dateStr} {p.tsStr}</div>
                  <div className="gallery-type" style={{ color: m.color }}>{label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Activity page — Log / Photos tabs ───────────────────────────────────────
function ActivityPage({ logs, photos }) {
  const [tab, setTab] = useState("log");
  return (
    <>
      <div className="tabbar">
        <button className={`tabbtn ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>☰ Log</button>
        <button className={`tabbtn ${tab === "photos" ? "active" : ""}`} onClick={() => setTab("photos")}>📷 Photos ({photos.length})</button>
      </div>
      {tab === "log"
        ? <ActivityLogTable logs={logs} onViewPhoto={() => setTab("photos")} />
        : <PhotoGallery photos={photos} />}
    </>
  );
}

// ── Accounts Page (admin) ───────────────────────────────────────────────────
function AccountsPage({ accounts, loading, currentUser, onCreate, onSetRole, onToggleActive }) {
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function addAccount() {
    const u = newUser.trim().toLowerCase();
    if (!u || !newPass) { setErr("Username and password are required."); return; }
    setBusy(true);
    try {
      await onCreate(u, newPass, newRole);
      setNewUser(""); setNewPass(""); setNewRole("user"); setErr("");
    } catch (e) {
      setErr(e.message || "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="acct-toolbar">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Accounts <span style={{ color: "var(--accent)", marginLeft: 6 }}>{accounts.length}</span></span>
      </div>

      <div className="acct-add-form">
        <div className="af-field"><span className="af-lbl">USERNAME</span><input className="af-in" value={newUser} onChange={(e) => { setNewUser(e.target.value); setErr(""); }} placeholder="new username" /></div>
        <div className="af-field"><span className="af-lbl">PASSWORD</span><input className="af-in" type="text" value={newPass} onChange={(e) => { setNewPass(e.target.value); setErr(""); }} placeholder="temporary password" /></div>
        <div className="af-field"><span className="af-lbl">ROLE</span>
          <select className="af-sel" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="user">User (view only)</option>
            <option value="admin">Admin (full access)</option>
          </select>
        </div>
        <button className="af-btn" onClick={addAccount} disabled={busy}>{busy ? "Creating…" : "+ Create Account"}</button>
        {err && <span style={{ color: "var(--red)", fontSize: "12px", fontFamily: "var(--font-mono)" }}>{err}</span>}
      </div>

      {loading && <div style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-mono)" }}>Loading accounts…</div>}

      <div className="acct-list">
        {accounts.map((acc) => (
          <div key={acc.username} className={`acct-row ${acc.active ? "" : "inactive"}`}>
            <div className="acct-avatar">{acc.username[0].toUpperCase()}</div>
            <div className="acct-info">
              <div className="acct-name">{acc.username} {acc.username === currentUser && <span style={{ fontSize: 10, color: "var(--dim)", fontWeight: 400 }}>(you)</span>}
                <span className={`status-pill ${acc.active ? "active" : "inactive"}`}>{acc.active ? "ACTIVE" : "DEACTIVATED"}</span>
              </div>
              <div className="acct-meta">Created {new Date(acc.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="acct-stats">
              <span>Triggers fired: <b>{acc.triggersFired}</b></span>
              <span>Last activity: <b>{acc.lastActivity ? new Date(acc.lastActivity).toLocaleString() : "No activity yet"}</b></span>
            </div>
            <div className="acct-actions">
              <select className="role-sel" value={acc.role} onChange={(e) => onSetRole(acc.username, e.target.value)} disabled={acc.username === currentUser}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {acc.active
                ? <button className="deact-btn" onClick={() => onToggleActive(acc.username, false)} disabled={acc.username === currentUser}>⛔ Deactivate</button>
                : <button className="react-btn" onClick={() => onToggleActive(acc.username, true)}>✓ Reactivate</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Analytics / Reports Page (admin) ────────────────────────────────────────
function AnalyticsPage({ logs, chartData, counts, ratCount }) {
  const confLogs = logs.filter((l) => typeof l.confidence === "number");
  const buckets = [0, 0, 0, 0, 0, 0];
  const bucketLabels = ["<50", "50-60", "60-70", "70-80", "80-90", "90+"];
  confLogs.forEach((l) => {
    const c = l.confidence;
    if (c < .5) buckets[0]++; else if (c < .6) buckets[1]++; else if (c < .7) buckets[2]++;
    else if (c < .8) buckets[3]++; else if (c < .9) buckets[4]++; else buckets[5]++;
  });
  const avgConf = confLogs.length ? confLogs.reduce((a, l) => a + l.confidence, 0) / confLogs.length : 0;
  const maxBucket = Math.max(...buckets, 1);

  const escalated = logs.filter((l) => l.isLast).length;
  const resolved = Math.max(ratCount - escalated, 0);
  const effTotal = resolved + escalated || 1;
  const resolvedPct = Math.round((resolved / effTotal) * 100);
  const escalatedPct = 100 - resolvedPct;

  const dayMap = new Map();
  logs.forEach((l) => {
    const tsDate = new Date(l.ts);
    const dayKey = tsDate.toDateString();
    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        dayKey, dateStr: l.dateStr, dateObj: new Date(tsDate.getFullYear(), tsDate.getMonth(), tsDate.getDate()),
        detections: 0, escalated: 0, lights: 0, audio: 0, pepper: 0, last: 0, confSum: 0, confCount: 0,
      });
    }
    const d = dayMap.get(dayKey);
    if (l.isRat) d.detections++;
    if (l.isLast) d.escalated++;
    if (l.type && !l.isRat) d[l.type] = (d[l.type] || 0) + 1;
    if (typeof l.confidence === "number") { d.confSum += l.confidence; d.confCount++; }
  });

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const daysSinceMonday = (today0.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(today0); monday.setDate(monday.getDate() - daysSinceMonday);
  function dayAt(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
  const last7Days = Array.from({ length: 7 }, (_, i) => dayAt(monday, i));           // this week, Mon → Sun
  const prev7Days = Array.from({ length: 7 }, (_, i) => dayAt(monday, i - 7));       // previous week, Mon → Sun
  function sumWindow(days) {
    let detections = 0, escalated = 0, confSum = 0, confCount = 0, lights = 0, audio = 0, pepper = 0, last = 0;
    days.forEach((d) => {
      const row = dayMap.get(d.toDateString());
      if (!row) return;
      detections += row.detections; escalated += row.escalated;
      lights += row.lights; audio += row.audio; pepper += row.pepper; last += row.last;
      confSum += row.confSum; confCount += row.confCount;
    });
    const resolved = Math.max(detections - escalated, 0);
    const total = resolved + escalated || 1;
    return { detections, resolved, escalated, resolvedPct: Math.round((resolved / total) * 100), avgConf: confCount ? confSum / confCount : 0, lights, audio, pepper, last };
  }
  const wk = sumWindow(last7Days);
  const prevWk = sumWindow(prev7Days);
  const detTrend = prevWk.detections ? Math.round(((wk.detections - prevWk.detections) / prevWk.detections) * 100) : null;
  const effTrend = prevWk.resolvedPct ? wk.resolvedPct - prevWk.resolvedPct : null;
  const confTrend = prevWk.avgConf ? wk.avgConf - prevWk.avgConf : null;

  const weekChartData = last7Days.map((d) => {
    const row = dayMap.get(d.toDateString());
    return { label: d.toLocaleDateString("en-GB", { weekday: "short" }), detections: row ? row.detections : 0, deterred: row ? row.resolved : 0 };
  });
  const weekMax = Math.max(...weekChartData.flatMap((r) => [r.detections, r.deterred]), 1);
  const triggerMax = Math.max(wk.lights, wk.audio, wk.pepper, wk.last, 1);

  function downloadCsv(rows, filename) {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function exportDailyReport() {
    const rows = [["Date", "Detections", "Resolved", "Escalated", "Resolution Rate", "Avg Confidence", "Lights", "Audio", "Pepper", "Last Resort"]];
    Array.from(dayMap.values()).sort((a, b) => b.dateObj - a.dateObj).forEach((d) => {
      const resolved = Math.max(d.detections - d.escalated, 0);
      const total = resolved + d.escalated || 1;
      rows.push([d.dateStr, d.detections, resolved, d.escalated, Math.round((resolved / total) * 100) + "%", Math.round((d.confCount ? d.confSum / d.confCount : 0) * 100) + "%", d.lights, d.audio, d.pepper, d.last]);
    });
    downloadCsv(rows, `ratavert-daily-report-${Date.now()}.csv`);
  }
  function exportReport() {
    const rows = [["Date", "Time", "Type", "Triggered By", "Status", "Confidence", "Detail"]];
    logs.forEach((l) => rows.push([l.dateStr, l.tsStr, l.isRat ? "RAT DETECTED" : TYPE_META[l.type]?.label || l.type, l.user, l.status, l.confidence != null ? Math.round(l.confidence * 100) + "%" : "—", l.detail]));
    downloadCsv(rows, `ratavert-report-${Date.now()}.csv`);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Detection Reports & Analytics</span>
        <button className="export-btn" onClick={exportReport}>⬇ Export Report (CSV)</button>
      </div>

      <div className="an-grid">
        <div className="an-stat"><div className="an-stat-lbl">Total Detections</div><div className="an-stat-val" style={{ color: "var(--orange)" }}>{ratCount}</div><div className="an-stat-sub">All-time events</div></div>
        <div className="an-stat"><div className="an-stat-lbl">Avg Confidence</div><div className="an-stat-val" style={{ color: "var(--teal)" }}>{Math.round(avgConf * 100)}%</div><div className="an-stat-sub">Per detection</div></div>
        <div className="an-stat"><div className="an-stat-lbl">Deterrences Fired</div><div className="an-stat-val" style={{ color: "var(--accent)" }}>{counts.lights + counts.audio + counts.pepper + counts.last}</div><div className="an-stat-sub">Total actuations</div></div>
        <div className="an-stat"><div className="an-stat-lbl">Resolution Rate</div><div className="an-stat-val" style={{ color: "var(--accent)" }}>{resolvedPct}%</div><div className="an-stat-sub">Without escalation</div></div>
      </div>

      <div className="an-row">
        <div className="cc">
          <div className="cc-hdr"><span className="cc-title">Detection Frequency — Last 24h</span></div>
          <div className="cc-canvas"><LineChart data={chartData} /></div>
        </div>
        <div className="cc">
          <div className="cc-hdr"><span className="cc-title">Confidence Score Distribution</span></div>
          {confLogs.length === 0 ? (
            <div style={{ color: "var(--dim)", fontSize: 12, textAlign: "center", padding: "30px 0" }}>No detection confidence data yet.</div>
          ) : (
            <div className="conf-bars">
              {buckets.map((v, i) => (
                <div className="conf-col" key={i}>
                  <span className="conf-count">{v}</span>
                  <div className="conf-fill" style={{ height: `${Math.round((v / maxBucket) * 90) + 2}px` }} />
                  <span className="conf-lbl">{bucketLabels[i]}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cc" style={{ marginBottom: 16 }}>
        <div className="cc-hdr"><span className="cc-title">Deterrence Effectiveness</span></div>
        <div className="eff-bar-track">
          <div className="eff-bar-resolved" style={{ width: `${resolvedPct}%` }} />
          <div className="eff-bar-escalated" style={{ width: `${escalatedPct}%` }} />
        </div>
        <div className="eff-legend">
          <span><b style={{ color: "var(--accent)" }}>■</b> Resolved by Lights/Audio/Peppermint: <b>{resolvedPct}%</b> ({resolved} events)</span>
          <span><b style={{ color: "var(--red)" }}>■</b> Escalated to Last Resort: <b>{escalatedPct}%</b> ({escalated} events)</span>
        </div>
      </div>

      <div className="cc" style={{ marginBottom: 16 }}><div className="cc-hdr"><span className="cc-title">Trigger Type Distribution</span></div><DonutChart totals={counts} /></div>

      <div className="lhdr" style={{ marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--dim)" }}>Daily Report <span style={{ color: "var(--accent)", marginLeft: 6 }}>This Week (Mon–Sun)</span></span>
        <button className="export-btn" onClick={exportDailyReport}>⬇ Export Daily Report (CSV)</button>
      </div>

      <div className="ds-cards">
        <div className="ds-card">
          <div className="ds-val" style={{ color: "var(--red)" }}>{wk.detections}</div>
          <div className="ds-lbl">Total Detections</div>
          <div className={`ds-trend ${detTrend == null ? "flat" : detTrend >= 0 ? "up" : "down"}`}>
            {detTrend == null ? "— no prior week data" : `${detTrend >= 0 ? "▲ +" : "▼ "}${detTrend}% vs last week`}
          </div>
        </div>
        <div className="ds-card">
          <div className="ds-val" style={{ color: "var(--accent)" }}>{wk.resolvedPct}%</div>
          <div className="ds-lbl">Deterrence Effectiveness</div>
          <div className={`ds-trend ${effTrend == null ? "flat" : effTrend >= 0 ? "up" : "down"}`}>
            {effTrend == null ? "— no prior week data" : `${effTrend >= 0 ? "▲ +" : "▼ "}${effTrend}% vs last week`}
          </div>
        </div>
        <div className="ds-card">
          <div className="ds-val" style={{ color: "var(--teal)" }}>{wk.avgConf ? Math.round(wk.avgConf * 100) + "%" : "—"}</div>
          <div className="ds-lbl">Avg Confidence Score</div>
          <div className={`ds-trend ${confTrend == null ? "flat" : confTrend >= 0 ? "up" : "down"}`}>
            {confTrend == null ? "— no prior week data" : `${confTrend >= 0 ? "▲ +" : "▼ "}${confTrend.toFixed(2)} vs last week`}
          </div>
        </div>
      </div>

      <div className="week-row">
        <div className="cc">
          <div className="cc-hdr">
            <span className="cc-title">Detection Frequency — This Week (Mon–Sun)</span>
            <div style={{ display: "flex", gap: "12px" }}>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--red)", display: "flex", alignItems: "center", gap: "4px" }}><span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--red)", display: "inline-block" }} />Detections</span>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--teal)", display: "flex", alignItems: "center", gap: "4px" }}><span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--teal)", display: "inline-block" }} />Deterred</span>
            </div>
          </div>
          <div className="week-bars">
            {weekChartData.map((d, i) => (
              <div className="week-col" key={i}>
                <div className="week-bar-pair">
                  <div className="week-bar" style={{ height: `${Math.round((d.detections / weekMax) * 120) + 2}px`, background: "var(--red)" }} title={`${d.detections} detections`} />
                  <div className="week-bar" style={{ height: `${Math.round((d.deterred / weekMax) * 120) + 2}px`, background: "var(--teal)" }} title={`${d.deterred} deterred`} />
                </div>
                <span className="week-lbl">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cc">
          <div className="cc-hdr"><span className="cc-title">Trigger Usage Distribution</span></div>
          <div className="hbar-list">
            {[
              { icon: "💡", label: "Lights", val: wk.lights, color: TYPE_META.lights.color },
              { icon: "🔊", label: "Audio",  val: wk.audio,  color: TYPE_META.audio.color },
              { icon: "🌿", label: "Pepper", val: wk.pepper, color: TYPE_META.pepper.color },
              { icon: "🚨", label: "Last",   val: wk.last,   color: TYPE_META.last.color },
            ].map((row) => (
              <div className="hbar-row" key={row.label}>
                <span className="hbar-icon-lbl">{row.icon} {row.label}</span>
                <div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.round((row.val / triggerMax) * 100)}%`, background: row.color }} /></div>
                <span className="hbar-val">{row.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cc">
        <div className="cc-hdr"><span className="cc-title">Confidence Score Distribution (this week)</span></div>
        {confLogs.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 12, textAlign: "center", padding: "30px 0" }}>No detection confidence data yet.</div>
        ) : (
          <div className="hbar-list">
            {buckets.map((v, i) => (
              <div className="hbar-row" key={i}>
                <span className="hbar-icon-lbl">{bucketLabels[i]}%</span>
                <div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.round((v / maxBucket) * 100)}%`, background: "var(--teal)" }} /></div>
                <span className="hbar-val">{confLogs.length ? Math.round((v / confLogs.length) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Change password form (self-service, any logged-in user) ────────────────
function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {ok, text}

  async function submit() {
    setMsg(null);
    if (!current || !next || !confirm) { setMsg({ ok: false, text: "Fill in all three fields." }); return; }
    if (next.length < 6) { setMsg({ ok: false, text: "New password must be at least 6 characters." }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: "New password and confirmation don't match." }); return; }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: "✅ Password updated." });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setMsg({ ok: false, text: "⚠ " + (e.message || "Could not update password.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scard">
      <div className="sc-title">🔑 Change Password</div>
      <div className="login-field">
        <label className="login-lbl">Current Password</label>
        <input className="login-in" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" />
      </div>
      <div className="login-field">
        <label className="login-lbl">New Password</label>
        <input className="login-in" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" />
      </div>
      <div className="login-field">
        <label className="login-lbl">Confirm New Password</label>
        <input className="login-in" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Repeat new password" />
      </div>
      <button className="login-btn" onClick={submit} disabled={busy} style={{ marginTop: 4 }}>{busy ? "Updating…" : "Update Password"}</button>
      {msg && <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 12, color: msg.ok ? "var(--accent)" : "var(--red)" }}>{msg.text}</div>}
    </div>
  );
}

// ── Settings Page — system settings + Device (Pi) setup ────────────────────
function Settings({ enabled, setEnabled, detecting, setDetecting, detInt, setDetInt, rpiConnected, rpiIp, rpiOwner, currentUser, isAdmin, onConnect, onDisconnect, fetchInstallCommand }) {
  const [tab, setTab] = useState("system");
  const [ip, setIp] = useState(rpiIp || "");
  const [msg, setMsg] = useState(null);
  const [installCmd, setInstallCmd] = useState(null);
  const [busy, setBusy] = useState(false);
  const isOwner = rpiOwner === currentUser;
  const lockedByOther = rpiOwner && !isOwner;

  useEffect(() => { setIp(rpiIp || ""); }, [rpiIp]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(null), 3500); }

  async function connect() {
    if (lockedByOther || !ip || busy) return;
    setBusy(true);
    try { await onConnect(ip); flash("✅ Linked — waiting for the Pi's first heartbeat"); }
    catch (e) { flash("⚠ " + (e.message || "Could not connect")); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!isOwner || busy) return;
    setBusy(true);
    try { await onDisconnect(); setIp(""); flash("🔴 Disconnected and unlinked"); }
    catch (e) { flash("⚠ " + (e.message || "Could not disconnect")); }
    finally { setBusy(false); }
  }
  async function loadInstallCommand() {
    try { const { command } = await fetchInstallCommand(); setInstallCmd(command); }
    catch { setInstallCmd(null); }
  }
  function copyCommand() {
    if (!installCmd) return;
    navigator.clipboard?.writeText(installCmd);
    flash("📋 Command copied");
  }

  return (
    <>
      <div className="tabbar">
        <button className={`tabbtn ${tab === "system" ? "active" : ""}`} onClick={() => setTab("system")}>⚙ System</button>
        <button className={`tabbtn ${tab === "account" ? "active" : ""}`} onClick={() => setTab("account")}>🔑 Account</button>
        <button className={`tabbtn ${tab === "device" ? "active" : ""}`} onClick={() => { setTab("device"); if (isAdmin && !installCmd) loadInstallCommand(); }}>🍓 Device</button>
      </div>

      {tab === "system" && (
        <div className="sg">
          <div className="scard">
            <div className="sc-title">🐀 Detection Settings</div>
            <div className="srow"><div><div className="sn">Auto-Detection</div><div className="sd">Pi scans and responds automatically</div></div><div className={`tog ${detecting ? "on" : ""} red`} onClick={() => setDetecting(!detecting)} style={{ cursor: "pointer" }} /></div>
            <div className="srow"><div><div className="sn">Detection Interval</div><div className="sd">How often the Pi checks (seconds)</div></div><input className="sin" type="number" value={detInt} min={5} max={120} onChange={(e) => setDetInt(Number(e.target.value))} /></div>
            <div className="srow"><div><div className="sn">Sequence</div><div className="sd">💡→🔊→🌿→🚨 (Pi-controlled timing)</div></div><span style={{ fontSize: "14px" }}>💡🔊🌿🚨</span></div>
          </div>
          <div className="scard">
            <div className="sc-title">Trigger Config</div>
            {Object.entries(TYPE_META).map(([k, m]) => (
              <div key={k} className="srow">
                <div><div className="sn">{m.icon} {m.label}</div><div className="sd">{enabled[k] ? "Armed" : "Disabled"}</div></div>
                <div className={`tog ${enabled[k] ? "on" : ""} ${k === "last" ? "red" : ""}`} onClick={() => setEnabled(k, !enabled[k])} style={{ cursor: "pointer" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "account" && (
        <div className="sg">
          <ChangePasswordForm />
        </div>
      )}

      {tab === "device" && (
        <>
          <div className="setup-wizard">
            <div className="setup-step done">
              <div className="setup-step-num">1</div>
              <div className="setup-step-title">Power on your Pi</div>
              <div className="setup-step-desc">Plug in the Pi and connect it to the same network as this backend.</div>
            </div>
            <div className={`setup-step ${installCmd ? "done" : ""}`}>
              <div className="setup-step-num">2</div>
              <div className="setup-step-title">Run one command</div>
              <div className="setup-step-desc">Copy the command below (admin-only, includes your device key) and run it once on the Pi.</div>
            </div>
            <div className={`setup-step ${rpiConnected ? "done" : ""}`}>
              <div className="setup-step-num">3</div>
              <div className="setup-step-title">Connect from here</div>
              <div className="setup-step-desc">Enter the Pi's IP below and click Connect, then wait for its first heartbeat.</div>
            </div>
          </div>

          {isAdmin ? (
            <div className="iot-card" style={{ marginBottom: 14 }}>
              <div className="iot-title">Install Command — run once on the Pi</div>
              <div className="command-box">
                <span>{installCmd || "Loading…"}</span>
                <button className="copy-btn" onClick={copyCommand} disabled={!installCmd}>Copy</button>
              </div>
            </div>
          ) : (
            <div className="locked-banner">🔒 Only admins can view the install command and pair the device.</div>
          )}

          {lockedByOther && (
            <div className="locked-banner">🔒 This device is linked to account <b style={{ color: "var(--text)" }}>"{rpiOwner}"</b>. Ask them to disconnect it before connecting here.</div>
          )}

          {isAdmin && (
            <div className="iot-card" style={{ marginBottom: 14 }}>
              <div className="iot-title">Connect Your Pi</div>
              {rpiIp && isOwner ? (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span className="owner-pill">🔗 Linked to {rpiOwner} · {rpiIp} · {rpiConnected ? "online" : "waiting for heartbeat"}</span>
                  <button className="iot-btn ghost" onClick={disconnect} disabled={busy}>Disconnect & Unlink</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <input className="input-iot" placeholder="Pi IP address, e.g. 192.168.1.42" value={ip}
                      onChange={(e) => setIp(e.target.value)} disabled={lockedByOther} />
                    <button className="iot-btn prim" onClick={connect} disabled={lockedByOther || !ip || busy}>⚡ Connect</button>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--dim)", marginTop: "10px" }}>Find the IP by running <b style={{ color: "var(--text)" }}>hostname -I</b> on the Pi after setup finishes.</div>
                </>
              )}
              {msg && <div style={{ marginTop: "10px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent)" }}>{msg}</div>}
            </div>
          )}

          <div className="iot-card">
            <div className="iot-title">📍 Wiring Reference (optional)</div>
            <div className="pin-grid">
              {[{ num: 17, name: "Lights", color: "#10B981" }, { num: 27, name: "Audio", color: "#FCD34D" },
                { num: 22, name: "Pepper", color: "#6EE7B7" }, { num: 18, name: "L.Resort", color: "#F87171" },
                { num: 11, name: "PIR", color: "#34D399" }, { num: 9, name: "IR", color: "#2DD4BF" },
                { num: 10, name: "Camera", color: "#FB923C" }, { num: 25, name: "Buzzer", color: "#A3E635" },
              ].map((p) => (
                <div key={p.num} className="pin-item">
                  <div className="pin-num" style={{ color: p.color }}>GPIO{p.num}</div>
                  <div className="pin-name">{p.name}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Admin Panel — user management only now; Detection Analytics lives at the
// top level so every user can see it, not just admins ──────────────────────
function AdminPanel({ accountsProps }) {
  return (
    <>
      <div className="admin-panel-bar">
        <div className="admin-panel-lbl"><span className="pdot" style={{ background: "var(--accent)" }} />Admin Panel <span className="admin-panel-sub">· User management</span></div>
      </div>
      <AccountsPage {...accountsProps} />
    </>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState("dark");
  const [screen, setScreen] = useState(getToken() && getStoredUser() ? "dashboard" : "landing");
  const [currentUser, setUser] = useState(getStoredUser()?.username || null);
  const [role, setRole] = useState(getStoredUser()?.role || null);

  const [page, setPage] = useState("dashboard");
  const [logs, setLogs] = useState([]);
  const [chart, setChart] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [enabled, setEnabledState] = useState({ lights: true, audio: true, pepper: true, last: true });
  const [clock, setClock] = useState(new Date());
  const [ratAlert, setRatAlert] = useState(false);
  const [seqStep, setSeqStep] = useState(0);
  const [lastNow, setLastNow] = useState(false);
  const [ratCount, setRatCount] = useState(0);
  const [detecting, setDetectingState] = useState(true);
  const [firingKey, setFiringKey] = useState(null);
  const [triggerNotice, setTriggerNotice] = useState(null);
  const [detInt, setDetIntState] = useState(20);
  const [rpiConnected, setRpi] = useState(false);
  const [rpiIp, setRpiIp] = useState("");
  const [rpiOwner, setRpiOwner] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const ratAlertTimer = useRef(null);

  const isAdmin = role === "admin";

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { document.body.dataset.theme = theme; }, [theme]);

  function toggleTheme() { setTheme((t) => (t === "dark" ? "light" : "dark")); }
  function flashToast(m) { setToast(m); setTimeout(() => setToast(null), 4000); }

  // ── initial data load once authenticated ─────────────────────────────────
  const refreshCore = useCallback(async () => {
    try {
      const [status, settings, logsRes, detRes, chartRes] = await Promise.all([
        api.getStatus(), api.getSettings(), api.getLogs({ limit: 150 }), api.getDetections({ limit: 60 }), api.getHourlyAnalytics(),
      ]);
      setRpi(status.online); setRpiIp(status.ip || ""); setRpiOwner(status.owner || null);
      setEnabledState(status.armed);
      setDetectingState(settings.detecting); setDetIntState(settings.detectionInterval);
      setLogs(logsRes);
      setPhotos(detRes);
      setRatCount(logsRes.filter((l) => l.isRat).length);
      setChart(chartRes);
    } catch (e) {
      if (e.status === 401) signOut();
    }
  }, []);

  useEffect(() => {
    if (screen !== "dashboard") return;
    refreshCore();
    const poll = setInterval(refreshCore, 30000);
    const chartPoll = setInterval(() => api.getHourlyAnalytics().then(setChart).catch(() => {}), 5 * 60000);

    const closeWs = connectEvents((evt) => {
      if (evt.type === "detection") {
        setLogs((prev) => [evt.payload, ...prev].slice(0, 300));
        setPhotos((prev) => [{ id: evt.payload.id.replace("det-", ""), ts: evt.payload.ts, tsStr: evt.payload.tsStr, dateStr: evt.payload.dateStr, confidence: evt.payload.confidence, url: evt.payload.photoId, escalated: evt.payload.isLast }, ...prev].slice(0, 100));
        setRatCount((c) => c + 1);
        setRatAlert(true); setSeqStep(0); setLastNow(false);
        clearTimeout(ratAlertTimer.current);
        ratAlertTimer.current = setTimeout(() => setRatAlert(false), 60000);
      } else if (evt.type === "capture") {
        setLogs((prev) => (prev.some((l) => l.id === evt.payload.id) ? prev : [evt.payload, ...prev]).slice(0, 300));
        setPhotos((prev) => {
          const photoId = evt.payload.id.replace("det-", "");
          if (prev.some((p) => p.id === photoId)) return prev;
          return [{ id: photoId, ts: evt.payload.ts, tsStr: evt.payload.tsStr, dateStr: evt.payload.dateStr, confidence: null, url: evt.payload.photoId, actionsFired: [], escalated: false, type: "capture", isRat: false, capturedBy: evt.payload.user }, ...prev].slice(0, 100);
        });
      } else if (evt.type === "trigger_ack" || evt.type === "trigger_requested") {
        const p = evt.payload;
        setLogs((prev) => {
          const idx = prev.findIndex((l) => l.id === p.id);
          if (idx === -1) return [p, ...prev].slice(0, 300);
          const copy = [...prev]; copy[idx] = { ...copy[idx], ...p }; return copy;
        });
        if (evt.type === "trigger_ack") {
          setFiringKey((cur) => (cur === p.type ? null : cur));
          if (p.user === "auto-detect") {
            const stepIdx = AUTO_SEQ.indexOf(p.type);
            if (stepIdx !== -1) setSeqStep(stepIdx + 1);
            if (p.isLast) { setLastNow(true); setTimeout(() => setLastNow(false), 5000); }
          }
        } else {
          setFiringKey(p.type);
        }
      } else if (evt.type === "status") {
        setRpi(evt.payload.online); setRpiIp(evt.payload.ip || ""); setRpiOwner(evt.payload.owner || null); setEnabledState(evt.payload.armed);
      } else if (evt.type === "settings") {
        setDetectingState(evt.payload.detecting); setDetIntState(evt.payload.detectionInterval);
      } else if (evt.type === "accounts_changed" && page === "admin") {
        loadAccounts();
      }
    });

    return () => { clearInterval(poll); clearInterval(chartPoll); closeWs(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  async function loadAccounts() {
    if (!isAdmin) return;
    setAccountsLoading(true);
    try { setAccounts(await api.getAccounts()); }
    catch (e) { flashToast(e.message); }
    finally { setAccountsLoading(false); }
  }
  useEffect(() => { if (screen === "dashboard" && page === "admin") loadAccounts(); }, [screen, page]); // eslint-disable-line

  const counts = {
    lights: logs.filter((l) => l.type === "lights").length,
    audio: logs.filter((l) => l.type === "audio").length,
    pepper: logs.filter((l) => l.type === "pepper").length,
    last: logs.filter((l) => l.type === "last").length,
  };

  function signOut() {
    clearSession();
    setScreen("landing"); setUser(null); setRole(null); setPage("dashboard");
  }

  async function onFire(type) {
    setFiringKey(type);
    setTriggerNotice(null);
    try {
      await api.fireTrigger(type, 2);
    } catch (e) {
      setFiringKey(null);
      setTriggerNotice(e.message || "Could not fire trigger");
      setTimeout(() => setTriggerNotice(null), 5000);
    }
  }

  async function setEnabledOne(key, value) {
    const next = { ...enabled, [key]: value };
    setEnabledState(next);
    try { await api.updateSettings({ armed: { [key]: value } }); }
    catch (e) { setEnabledState(enabled); flashToast(e.message); }
  }
  async function setDetecting(value) {
    setDetectingState(value);
    try { await api.updateSettings({ detecting: value }); }
    catch (e) { setDetectingState(!value); flashToast(e.message); }
  }
  async function setDetInt(value) {
    setDetIntState(value);
    try { await api.updateSettings({ detectionInterval: value }); }
    catch (e) { flashToast(e.message); }
  }

  async function onConnectDevice(ip) {
    const status = await api.connectDevice(ip);
    setRpiIp(status.ip); setRpiOwner(status.owner); setRpi(status.online);
  }
  async function onDisconnectDevice() {
    const status = await api.disconnectDevice();
    setRpiIp(""); setRpiOwner(null); setRpi(false);
  }

  async function onCreateAccount(username, password, role) {
    await api.createAccount(username, password, role);
    await loadAccounts();
  }
  async function onSetRole(username, role) {
    try { await api.patchAccount(username, { role }); await loadAccounts(); }
    catch (e) { flashToast(e.message); }
  }
  async function onToggleActive(username, active) {
    try { await api.patchAccount(username, { active }); await loadAccounts(); }
    catch (e) { flashToast(e.message); }
  }

  const MAIN_NAV = [
    { key: "dashboard", icon: "◈", label: "Dashboard" },
    { key: "triggers",  icon: "⚡", label: "Triggers" },
    { key: "activity",  icon: "☰", label: "Activity" },
    { key: "analytics", icon: "📊", label: "Analytics" },
    { key: "settings",  icon: "⚙", label: "Settings" },
  ];

  // ── Screen router ─────────────────────────────────────────────────────
  if (screen === "landing") return <LandingPage onLogin={() => setScreen("login")} theme={theme} onToggleTheme={toggleTheme} />;
  if (screen === "login") return (
    <LoginPage
      onSuccess={(token, user) => { storeSession(token, user); setUser(user.username); setRole(user.role); setScreen("dashboard"); }}
      onBack={() => setScreen("landing")}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand"><div className="brand-dot" />RATAVERT</div>
        <div className="nav-right" style={{ marginLeft: "auto" }}>
          <button className="theme-toggle" onClick={toggleTheme}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
          <span className="nav-time">{fmtT(clock)}</span>
          {ratCount > 0 && <span className="nb nb-rat">🐀 {ratCount}</span>}
          <span className={`nb ${rpiConnected ? "nb-rpi" : "nb-off"}`}>{rpiConnected ? "🍓 Online" : "🍓 Offline"}</span>
          <span className="nb nb-live">● LIVE</span>
          <span className={`nb ${isAdmin ? "nb-admin" : "nb-user"}`}>{isAdmin ? "🛡 Admin" : "👤 User"}</span>
          <div className="nav-user">👤 {currentUser}</div>
          <button className="nav-out" onClick={signOut}>Sign Out</button>
        </div>
      </nav>

      <div className="body">
        <aside className="sidebar">
          <div className="sb-section">
            <div className="sb-label">Navigation</div>
            {MAIN_NAV.map((n) => (
              <div key={n.key} className={`sb-item ${page === n.key ? "active" : ""}`} onClick={() => setPage(n.key)}>
                <span className="sb-icon">{n.icon}</span>{n.label}
              </div>
            ))}
          </div>

          {isAdmin && (
            <div className="admin-zone">
              <div className="sb-label admin-lbl">🛡 Admin</div>
              <div className={`sb-item ${page === "admin" ? "active" : ""}`} onClick={() => setPage("admin")}>
                <span className="sb-icon">🛡</span>Admin Panel
              </div>
            </div>
          )}

          <div className="sb-divider" />

          <div className={`rpi-panel ${rpiConnected ? "" : "offline"}`}>
            <div className="rpi-lbl">🍓 RASPBERRY PI</div>
            <div className="rpi-stat" style={{ color: rpiConnected ? "var(--accent)" : "var(--red)" }}>
              <span className="pdot" style={{ background: rpiConnected ? "var(--accent)" : "var(--red)" }} />
              {rpiConnected ? "ONLINE" : "OFFLINE"}
            </div>
            <div className="rpi-ip">{rpiIp ? `IP: ${rpiIp}${rpiOwner ? ` · ${rpiOwner}` : ""}` : "Not connected"}</div>
          </div>

          <div className={`det-panel ${detecting ? "active" : ""}`}>
            <div className="det-lbl">DETECTION</div>
            <div className="det-stat" style={{ color: detecting ? "var(--red)" : "var(--dim)" }}>
              <span className="pdot" style={{ background: detecting ? "var(--red)" : "var(--muted)" }} />
              {detecting ? "ACTIVE" : "PAUSED"}
            </div>
            <div className="det-cnt">🐀 {ratCount} detected</div>
          </div>

          <div className="sb-footer">
            <div><span className="pdot" style={{ background: "var(--accent)", marginRight: 6 }} />{isAdmin ? "Admin access" : "Standard access"}</div>
            <div style={{ marginTop: "3px", color: "var(--muted)" }}>v1.0 · {currentUser}</div>
          </div>
        </aside>

        <div className="main">
          {ratAlert && <RatAlert seqStep={seqStep} lastNow={lastNow} onDismiss={() => setRatAlert(false)} />}
          <div className="content">
            {page === "dashboard" && <Dashboard logs={logs} chartData={chart} enabled={enabled} counts={counts} ratCount={ratCount} detecting={detecting} rpiConnected={rpiConnected} photoCount={photos.length} />}
            {page === "triggers" && <Triggers logs={logs} enabled={enabled} setEnabled={setEnabledOne} onFire={onFire} firingKey={firingKey} rpiConnected={rpiConnected} notice={triggerNotice} />}
            {page === "activity" && <ActivityPage logs={logs} photos={photos} />}
            {page === "analytics" && <AnalyticsPage logs={logs} chartData={chart} counts={counts} ratCount={ratCount} />}
            {page === "settings" && (
              <Settings
                enabled={enabled} setEnabled={setEnabledOne}
                detecting={detecting} setDetecting={setDetecting}
                detInt={detInt} setDetInt={setDetInt}
                rpiConnected={rpiConnected} rpiIp={rpiIp} rpiOwner={rpiOwner}
                currentUser={currentUser} isAdmin={isAdmin}
                onConnect={onConnectDevice} onDisconnect={onDisconnectDevice}
                fetchInstallCommand={api.getInstallCommand}
              />
            )}
            {page === "admin" && (isAdmin
              ? <AdminPanel accountsProps={{ accounts, loading: accountsLoading, currentUser, onCreate: onCreateAccount, onSetRole, onToggleActive }} />
              : <AccessDenied />)}
          </div>
        </div>
      </div>
      {toast && <div className="toast">⚠ {toast}</div>}
    </div>
  );
}
