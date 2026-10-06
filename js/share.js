// Front Office: sharing a trade (link and image)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// SHARE A TRADE
// "Copy link" makes a link that reopens this exact trade: the league, both teams, every player
// and pick, and any FAAB. Anyone can open it; Sleeper league data is public, so they don't need
// to be in the league. Nothing is stored anywhere: the whole trade is written into the link.
// "Save image" draws the trade as a picture (both sides, totals, the verdict) to post in a
// group chat, on X or Reddit.
// ============================================================
const shortId = id => id.replace(/^p:/, "p").replace(/^k:/, "k");
const longId = s => s[0] === "p" ? "p:" + s.slice(1) : s[0] === "k" ? "k:" + s.slice(1) : "";
function tradeCode(){
  const ra = $("teamA").value, rb = $("teamB").value;
  return [S.league.league_id, ra, rb, [...S.sendIds].map(shortId).join("."), [...S.getIds].map(shortId).join("."), S.faab.send || 0, S.faab.get || 0].join("~");
}
function tradeLink(){ return location.origin + location.pathname + "?trade=" + encodeURIComponent(tradeCode()); }
function parseTradeCode(code){
  const [league, ra, rb, send, get, fs, fg] = String(code || "").split("~");
  if (!/^[A-Za-z0-9_-]+$/.test(league || "") || !ra || !rb) return null;
  const ids = x => (x || "").split(".").filter(Boolean).map(longId).filter(Boolean);
  return { league, ra: Number(ra), rb: Number(rb), send: ids(send), get: ids(get), faabSend: Math.max(0, Number(fs) || 0), faabGet: Math.max(0, Number(fg) || 0) };
}
$("shareLink").addEventListener("click", async () => {
  const url = tradeLink();
  try { await navigator.clipboard.writeText(url); toast("Trade link copied. Paste it anywhere to share this trade."); }
  catch(e){ window.prompt("Copy this link to share the trade:", url); }
});

// Opening a shared link: load that league, then rebuild the trade
const SHARED = parseTradeCode(new URLSearchParams(location.search).get("trade"));
async function openSharedTrade(t){
  try {
    if (window.userLoad) await window.userLoad.catch(() => {});
    if (!S.user) S.user = { user_id: "", display_name: "" };                 // viewers don't need to sign in
    if (!S.nflState){ S.nflState = await getJSON("/state/nfl"); S.season = S.nflState.league_season || S.nflState.season; }
    setStatus("Opening a shared trade...");
    await openLeague(t.league);
    if (!S.league || S.league.league_id !== t.league) return;
    if (!S.teams.has(t.ra) || !S.teams.has(t.rb)) throw new Error("teams");
    $("teamA").value = t.ra; $("teamB").value = t.rb;
    S.sendIds = new Set(t.send.filter(id => S.assets.get(id)?.owner === t.ra));
    S.getIds = new Set(t.get.filter(id => S.assets.get(id)?.owner === t.rb));
    S.faab = { send: Math.min(t.faabSend, faabBudget()), get: Math.min(t.faabGet, faabBudget()) };
    navTab("calc")?.click();
    renderCalc();
    const missing = t.send.length + t.get.length - S.sendIds.size - S.getIds.size;
    toast(missing ? `Shared trade opened. ${missing} piece${missing > 1 ? "s have" : " has"} since moved to another team, so ${missing > 1 ? "they were" : "it was"} left out.` : `Shared trade opened, with today's values for ${S.league.name}.`);
    history.replaceState(null, "", location.pathname + location.hash);      // a refresh shouldn't reapply it
  } catch(e){ console.warn(e); setStatus("Couldn't open that shared trade. The league may no longer exist.", true); }
}

// ---------- Trade image ----------
function wrapText(ctx, text, maxW){ const words = String(text).split(" "); let line = ""; const out = [];
  for (const w of words){ const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line){ out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out; }
function drawTradeImage(){
  const W = 1200, pad = 56, sendA = [...S.sendIds].map(id => S.assets.get(id)).filter(Boolean).sort((a, b) => b.value - a.value);
  const getA = [...S.getIds].map(id => S.assets.get(id)).filter(Boolean).sort((a, b) => b.value - a.value);
  const rowsS = sendA.map(a => [a.name, a.kind === "player" ? `${a.pos}${a.lgPosRank || ""} · ${a.nfl}` : a.nfl, a.value]).concat(S.faab.send ? [[`$${fmt(S.faab.send)} FAAB`, "waiver budget", faabValue(S.faab.send)]] : []);
  const rowsG = getA.map(a => [a.name, a.kind === "player" ? `${a.pos}${a.lgPosRank || ""} · ${a.nfl}` : a.nfl, a.value]).concat(S.faab.get ? [[`$${fmt(S.faab.get)} FAAB`, "waiver budget", faabValue(S.faab.get)]] : []);
  const n = Math.max(rowsS.length, rowsG.length), H = Math.max(630, 330 + n * 70);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), F = "Barlow, 'Segoe UI', Arial, sans-serif", D = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
  x.fillStyle = "#16212B"; x.fillRect(0, 0, W, H);
  // header
  x.fillStyle = "#1E6B47"; x.beginPath(); x.roundRect(pad, 40, 44, 44, 10); x.fill();
  x.fillStyle = "#F4F6F2"; x.font = `800 26px ${D}`; x.textAlign = "center"; x.fillText("FO", pad + 22, 71);
  x.textAlign = "left"; x.font = `700 30px ${D}`; x.fillText("Front Office", pad + 58, 72);
  x.fillStyle = "#93A2AC"; x.font = `500 20px ${F}`; x.textAlign = "right"; x.fillText(`${S.league.name} · values as of ${new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`, W - pad, 70);
  // the two sides
  const colW = (W - pad * 2 - 40) / 2, sides = [[S.teams.get(Number($("teamA").value))?.name, $("sendNum").textContent, rowsS, "SENDS"], [S.teams.get(Number($("teamB").value))?.name, $("getNum").textContent, rowsG, "SENDS"]];
  sides.forEach(([team, total, rows], i) => {
    const x0 = pad + i * (colW + 40);
    x.textAlign = "left"; x.fillStyle = i ? "#7BD3A2" : "#F2A08A"; x.font = `700 16px ${F}`; x.fillText("SENDS", x0, 130);
    x.fillStyle = "#F4F6F2"; x.font = `700 26px ${F}`; x.fillText(String(team || "").slice(0, 34), x0, 162);
    x.font = `800 54px ${D}`; x.textAlign = "right"; x.fillText(total, x0 + colW, 166);
    rows.forEach(([nm, sub, v], k) => {
      const y = 200 + k * 70;
      x.fillStyle = "rgba(255,255,255,.06)"; x.beginPath(); x.roundRect(x0, y, colW, 58, 10); x.fill();
      x.textAlign = "left"; x.fillStyle = "#F4F6F2"; x.font = `600 22px ${F}`; x.fillText(String(nm).slice(0, 30), x0 + 16, y + 26);
      x.fillStyle = "#93A2AC"; x.font = `500 16px ${F}`; x.fillText(String(sub || "").slice(0, 40), x0 + 16, y + 47);
      x.textAlign = "right"; x.fillStyle = "#F4F6F2"; x.font = `700 24px ${D}`; x.fillText(fmt(v), x0 + colW - 16, y + 37);
    });
  });
  // verdict
  const v = $("verdict").textContent, f = $("fill").classList;
  const col = f.contains("lopsided") ? "#E8890C" : f.contains("win") ? "#22A55A" : f.contains("lose") ? "#E5484D" : "#3B82F6";
  const vy = H - 82;
  x.fillStyle = col; x.beginPath(); x.roundRect(pad, vy, W - pad * 2, 48, 12); x.fill();
  x.fillStyle = "#fff"; x.textAlign = "center"; x.font = `700 26px ${D}`;
  // the image is shown to both teams, so name the winning side instead of "you"
  const nameA = S.teams.get(Number($("teamA").value))?.name, nameB = S.teams.get(Number($("teamB").value))?.name;
  const neutral = v.replace("favors you", `favors ${nameA}`).replace("Lopsided: you overpay", `Lopsided: ${nameA} overpays`)
    .replace(/^You win/, `${nameA} wins`).replace(/^You overpay/, `${nameA} overpays`)
    .replace("you're ahead", `${nameA} is ahead`).replace("they're ahead", `${nameB} is ahead`);
  x.fillText(neutral, W / 2, vy + 33);
  x.fillStyle = "#93A2AC"; x.font = `500 15px ${F}`; x.fillText("Values customized for this league's scoring and trades. Rankings data via FantasyPros.", W / 2, H - 16);
  return c;
}
$("shareImage").addEventListener("click", async () => {
  try { await document.fonts?.ready; } catch(e){}
  const c = drawTradeImage();
  c.toBlob(async blob => {
    if (!blob) return;
    const file = new File([blob], "front-office-trade.png", { type: "image/png" });
    // phones: the share sheet (Messages, group chats); computers: download the picture
    if (navigator.canShare && navigator.canShare({ files: [file] }) && window.matchMedia("(pointer:coarse)").matches){
      try { await navigator.share({ files: [file], title: "Front Office trade" }); return; } catch(e){ if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "front-office-trade.png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Trade image saved.");
  }, "image/png");
});
if (SHARED) openSharedTrade(SHARED);
