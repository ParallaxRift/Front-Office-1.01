// Front Office: Trophy Room tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// TROPHY ROOM
// Champions for every past season Sleeper links to, and the top scorer
// of every week for this season and the two before it.
// ============================================================
let trophy = null, trophySeason = null;
const HS_SEASONS = 3;   // this season + two previous
async function loadTrophyRoom(){
  if (!S.league) return;
  if (trophy && trophy.leagueId === S.league.league_id){ renderTrophyRoom(); return; }
  $("champList").innerHTML = `<p class="empty">Loading your league's history...</p>`;
  $("hsTable").innerHTML = ""; $("hsLeaders").innerHTML = ""; $("hsSeasons").innerHTML = "";
  const leagueId = S.league.league_id;
  try {
    // walk back through every linked season
    const chain = [S.league];
    let lg = S.league;
    while (chain.length < 20 && lg.previous_league_id && lg.previous_league_id !== "0"){
      lg = await getJSON(`/league/${lg.previous_league_id}`).catch(() => null);
      if (!lg) break; chain.push(lg);
    }
    const seasons = await Promise.all(chain.map(async (L, idx) => {
      const isCur = idx === 0;
      const [rosters, users, bracket] = await Promise.all([
        isCur ? S.rosters : getJSON(`/league/${L.league_id}/rosters`).catch(() => []),
        isCur ? S.users : getJSON(`/league/${L.league_id}/users`).catch(() => []),
        getJSON(`/league/${L.league_id}/winners_bracket`).catch(() => [])
      ]);
      const team = rid => {
        const r = (rosters || []).find(x => x.roster_id === rid), owner = r?.owner_id;
        const now = [...S.teams.values()].find(t => t.owner === owner);
        const u = (users || []).find(x => x.user_id === owner);
        return { rid, owner, name: now?.name || u?.metadata?.team_name || u?.display_name || `Team ${rid}`,
                 manager: u?.display_name || "", photo: now ? now.photo : (u?.metadata?.avatar || u?.avatar || null),
                 rec: r?.settings ? `${r.settings.wins || 0}-${r.settings.losses || 0}${r.settings.ties ? "-" + r.settings.ties : ""}` : "" };
      };
      const final = (bracket || []).find(m => m.p === 1), third = (bracket || []).find(m => m.p === 3);
      let weeks = [];
      if (idx < HS_SEASONS){
        // This season: count every finished week. Sleeper keeps calling a week "current" until midweek,
        // even after Monday night's game is over, so ask ESPN whether that week's games are all final.
        const last = isCur && S.nflState?.season_type === "regular" ? await lastFinishedWeek() : 18;
        const all = await Promise.all(Array.from({ length: Math.max(0, last) }, (_, w) => getJSON(`/league/${L.league_id}/matchups/${w + 1}`).catch(() => [])));
        weeks = all.map((ms, w) => {
          const scored = (ms || []).map(m => ({ rid: m.roster_id, pts: Number(m.custom_points ?? m.points ?? 0) })).filter(m => m.pts > 0);
          if (!scored.length) return null;
          scored.sort((a, b) => b.pts - a.pts);
          const avg = scored.reduce((t, m) => t + m.pts, 0) / scored.length;
          return { week: w + 1, top: { ...team(scored[0].rid), pts: scored[0].pts }, second: scored[1] ? { ...team(scored[1].rid), pts: scored[1].pts } : null, avg };
        }).filter(Boolean);
      }
      return { season: Number(L.season), status: L.status,
               champ: final?.w ? team(final.w) : null, runner: final?.l ? team(final.l) : null, third: third?.w ? team(third.w) : null, weeks };
    }));
    if (S.league?.league_id !== leagueId) return;
    trophy = { leagueId, seasons };
    trophySeason = seasons.find(x => x.weeks.length)?.season ?? null;
    renderTrophyRoom();
  } catch(e){
    console.error(e);
    $("champList").innerHTML = `<p class="empty">Couldn't load your league's history. Reopen this tab to try again.</p>`;
  }
}
function renderTrophyRoom(){
  const T = trophy; if (!T) return;
  const person = (t, size) => `${avatar(t.photo, t.name, size)}`;
  if (!isPhoneView()){ renderChampWall(T, person); } else
  $("champList").innerHTML = T.seasons.map(x => x.champ ? `
    <article class="tr-champ">
      <div class="yr">${x.season}</div>
      <div class="who">${person(x.champ, "lg")}<span><b>${esc(x.champ.name)}</b><small>${esc([x.champ.manager !== x.champ.name ? x.champ.manager : "", x.champ.rec ? x.champ.rec + " regular season" : ""].filter(Boolean).join(", "))}</small></span></div>
      <div class="rest">
        ${x.runner ? `<span>Runner-up: <b>${esc(x.runner.name)}</b></span>` : ""}
        ${x.third ? `<span>Third place: <b>${esc(x.third.name)}</b></span>` : ""}
      </div>
    </article>` : `
    <article class="tr-champ pending"><div class="yr" style="color:var(--muted)">${x.season}</div><p class="note" style="margin:10px 0 0">${x.season === Number(S.league.season) && x.status !== "complete" ? "Season in progress. The champion will appear here once the playoffs finish." : "No champion recorded for this season."}</p></article>`).join("");

  const withWeeks = T.seasons.filter(x => x.weeks.length);
  if (!withWeeks.length){ $("hsSeasons").innerHTML = ""; $("hsTable").innerHTML = ""; $("hsLeaders").innerHTML = ""; $("trophyNote").textContent = "No completed weeks yet."; return; }
  $("hsSeasons").innerHTML = withWeeks.map(x => `<button aria-pressed="${x.season === trophySeason}" data-season="${x.season}">${x.season}</button>`).join("");
  const cur = withWeeks.find(x => x.season === trophySeason) || withWeeks[0];
  // who had the most weekly high points this season
  const tally = {};
  for (const w of cur.weeks){ const k = w.top.owner || w.top.rid; (tally[k] = tally[k] || { t: w.top, n: 0 }).n++; }
  // every team that topped the league at least once, most weeks first (best single week breaks ties)
  for (const w of cur.weeks){ const k = w.top.owner || w.top.rid; tally[k].best = Math.max(tally[k].best || 0, w.top.pts); }
  const leaders = Object.values(tally).sort((a, b) => b.n - a.n || b.best - a.best);
  $("hsLeaders").innerHTML = `<thead><tr><th class="n">#</th><th>Team</th><th class="n">Weeks with high points</th><th class="n">Best week</th></tr></thead>
    <tbody>${leaders.map((l, i) => `<tr class="${l.t.rid === S.myRid && cur.season === Number(S.league.season) ? "me" : ""}">
      <td class="n rk">${i + 1}</td>
      <td><span class="teamcell">${person(l.t, "sm")}<b>${esc(l.t.name)}</b></span></td>
      <td class="n rec">${l.n}</td>
      <td class="n">${l.best.toFixed(2)}</td></tr>`).join("")}</tbody>`;
  const best = Math.max(...cur.weeks.map(w => w.top.pts));
  $("hsTable").innerHTML = `<thead><tr><th class="n">Week</th><th>High scorer</th><th class="n">Points</th><th class="n hide-sm">Ahead of 2nd</th><th class="n hide-sm">League average</th></tr></thead>
    <tbody>${cur.weeks.map(w => `<tr class="${w.top.rid === S.myRid && cur.season === Number(S.league.season) ? "me" : ""}">
      <td class="n rk">${w.week}</td>
      <td><span class="teamcell">${person(w.top, "sm")}<b>${esc(w.top.name)}</b>${w.top.pts === best ? ' <span class="badge b-high">Season high</span>' : ""}</span></td>
      <td class="n rec">${w.top.pts.toFixed(2)}</td>
      <td class="n hide-sm">${w.second ? "+" + (w.top.pts - w.second.pts).toFixed(2) : "–"}</td>
      <td class="n hide-sm">${w.avg.toFixed(2)}</td></tr>`).join("")}</tbody>`;
  $("trophyNote").textContent = "";
}
$("hsSeasons").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  trophySeason = Number(b.dataset.season); renderTrophyRoom();
});


// Computers: the League Champions wall. One trophy per finished season, newest first, with the champion
// (photo and name) under it and the runner-up and third place smaller below.
function renderChampWall(T, person){
  const done = T.seasons.filter(x => x.champ).sort((a, b) => b.season - a.season);
  const live = T.seasons.find(x => !x.champ && x.season === Number(S.league.season) && x.status !== "complete");
  const place = (t, k) => t ? `<span class="cw-place">${person(t, "xs")}<em>${k}</em><b>${esc(t.name)}</b></span>` : "";
  // the season being played: same trophy, still up for grabs, with the current leader
  const recOf = r => { const s = r?.settings || {}; return { w: s.wins || 0, l: s.losses || 0, t: s.ties || 0, pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100 }; };
  const lead = live ? [...S.rosters].sort((a, b) => { const x = recOf(a), y = recOf(b); return (y.w + y.t / 2) - (x.w + x.t / 2) || y.pf - x.pf; }) : [];
  const tm = r => { const t = S.teams.get(r.roster_id), x = recOf(r); return t ? { name: t.name, photo: t.photo, rec: `${x.w}-${x.l}${x.t ? "-" + x.t : ""}` } : null; };
  const leader = lead[0] && tm(lead[0]), odds = S.titleOdds?.odds, fav = odds ? [...odds.entries()].sort((a, b) => b[1] - a[1])[0] : null;
  const favT = fav && S.teams.get(fav[0]);
  const liveCard = live ? `
    <article class="cw-card cw-live-card">
      <div class="cw-trophy"><img src="icons/trophy.webp" alt="" loading="lazy"></div><span class="cw-year">${live.season}</span>
      <div class="cw-status"><span class="cw-dot"></span>Season in Progress</div>
      ${leader ? `<div class="cw-champ">${person(leader, "lg")}<span><small>Leading the league</small><b>${esc(leader.name)}</b><em>${esc(leader.rec)} so far</em></span></div>` : ""}
      <div class="cw-rest">${favT ? `<span class="cw-place">${person(favT, "xs")}<em>Fav</em><b>${esc(favT.name)} · ${Math.round(fav[1] * 100)}% title odds</b></span>` : ""}
        ${lead[1] && tm(lead[1]) ? `<span class="cw-place">${person(tm(lead[1]), "xs")}<em>2nd</em><b>${esc(tm(lead[1]).name)}</b></span>` : ""}</div>
    </article>` : "";
  $("champList").innerHTML = (done.length || live ? `<div class="champ-wall">${liveCard}${done.map(x => `
    <article class="cw-card">
      <div class="cw-trophy"><img src="icons/trophy.webp" alt="" loading="lazy"></div><span class="cw-year">${x.season}</span>
      <div class="cw-champ">${person(x.champ, "lg")}<span><small>Champion</small><b>${esc(x.champ.name)}</b>${x.champ.rec ? `<em>${esc(x.champ.rec)} regular season</em>` : ""}</span></div>
      <div class="cw-rest">${place(x.runner, "2nd")}${place(x.third, "3rd")}</div>
    </article>`).join("")}</div>` : `<p class="empty">No finished seasons yet. Your first champion will appear here once the playoffs finish.</p>`);
}
