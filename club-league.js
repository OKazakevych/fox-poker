/* Presentation only. Ratings and saves are owned by the existing Poker app. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const ui={query:'',sort:'rank',derived:null,players:new Map(),manualView:false,profileOpener:null};
  const esc=value=>escapeHtml(String(value??''));
  const number=value=>formatPoints(value);
  const dateLabel=date=>date?new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')):'';
  const gameTitle=game=>game.day?'День '+game.day+' · Гра '+game.number:game.name||game.gameName;
  function filterRows(rows){
    const query=ui.query.trim().toLocaleLowerCase('uk-UA');
    const selected=rows.filter(row=>!query||row.player.nickname.toLocaleLowerCase('uk-UA').includes(query));
    const ranks=new Map(rows.map((row,index)=>[row.player.id,index]));
    return [...selected].sort((a,b)=>{
      const delta=ui.sort==='name'?a.player.nickname.localeCompare(b.player.nickname,'uk'):ui.sort==='wins'?b.wins-a.wins:ui.sort==='games'?b.games-a.games:0;
      return delta||ranks.get(a.player.id)-ranks.get(b.player.id);
    });
  }
  function formHTML(id){
    const played=ui.players.get(id)?.last5||[];
    if(!played.length)return '<span class="league-form-empty">Ще без зіграних ігор</span>';
    const descriptions=played.map(game=>gameTitle(game)+': '+(game.place?game.place+' місце':'місце невідоме'));
    return `<span class="league-form" role="group" aria-label="Останні ігри, від новішої: ${esc(descriptions.join('; '))}">${played.map((game,index)=>{
      const label=descriptions[index]+(game.placeSource==='derived'?' · місце обчислено з результатів гри':'');
      return `<span class="league-form-chip ${game.place&&game.place<=3?'podium-place place-'+game.place:''}${game.place?'':' missing'}" title="${esc(label)}" aria-label="${esc(label)}">${game.place||'?'}</span>`;
    }).join('')}</span>`;
  }
  function movementHTML(id){
    const movement=ui.players.get(id)?.movement;
    if(!movement)return '';
    const rise=movement.places>0,label=`${rise?'Підйом':'Спад'} на ${Math.abs(movement.places)}: ${movement.from} → ${movement.to} місце після ${movement.gameName}`;
    return `<span class="league-rank-move ${rise?'up':'down'}" title="${esc(label)}" aria-label="${esc(label)}">${rise?'↑':'↓'}${Math.abs(movement.places)}</span>`;
  }
  function renderDeck(rows){
    const selected=filterRows(rows);
    el('clubDeckCount').textContent=selected.length+' '+(ui.query?'із '+rows.length+' гравців':'гравців');
    el('leagueFilterStatus').textContent=ui.query?`Знайдено ${selected.length} із ${rows.length} гравців · місця в сезоні збережені`:`${seasonLabel()} · ${rows.length} гравців · натисни нікнейм або картку, щоб відкрити профіль`;
    el('clubDeckGrid').innerHTML=selected.length?selected.map(row=>{
      const player=ui.players.get(row.player.id),rank=player?.rank||'—';
      const award=activeSeasonId==='season2'?compactPlayerAwardsHTML(row.player):'';
      return `<a class="deck-card" data-deck-player="${esc(row.player.id)}" href="${profileHref(row.player.id)}" aria-label="${esc(row.player.nickname)}, ${rank} місце, ${number(row.points)} балів. Відкрити профіль"><div class="deck-art">${avatarHTML(row.player,'deck-avatar')}<span class="deck-corner" aria-hidden="true"><span class="deck-number">${rank}</span><span class="deck-suit">${['♠','♥','♣','♦'][(Number(rank)-1)%4]||'♠'}</span></span><span class="deck-art-season">${esc(seasonLabel())}</span></div><div class="deck-copy"><div class="deck-meta"><span>#${rank} у сезоні</span><span class="deck-rating">${number(row.points)} <small>б.</small></span></div><h3 class="deck-nickname">${esc(row.player.nickname)}</h3><div class="deck-awards">${award}</div><dl class="deck-metrics"><div><dt>Ігри</dt><dd>${row.games}</dd></div><div><dt>Перемоги</dt><dd>${row.wins}</dd></div><div><dt>${activeSeasonId==='season2'?'Вибивання':'Призові'}</dt><dd>${activeSeasonId==='season2'?number(row.eliminations):row.top3}</dd></div></dl><div class="deck-form"><small>Форма · останні ігри</small>${formHTML(row.player.id)}</div><span class="deck-profile-link">Профіль гравця <span aria-hidden="true">↗</span></span></div></a>`;
    }).join(''):'<div class="empty">'+(rows.length?'За цим нікнеймом нікого не знайдено. Спробуй інший запит.':'Клубна колода з’явиться після додавання гравців.')+'</div>';
  }
  function personLink(person){return `<a href="${profileHref(person.id)}">${esc(person.player.nickname)}</a>`;}
  function renderEvening(){
    const evening=ui.derived.latestEvening,root=el('leagueEvening');
    root.hidden=!evening;
    if(!evening){root.innerHTML='';return;}
    const date=evening.ambiguousDate?'У записах вечора є різні дати':dateLabel(evening.date)||'Дату ще не вказано';
    const visibleWinners=evening.games.map(game=>({...game,hasHiddenWinner:game.winners.some(winner=>winner.player.hidden),winners:game.winners.filter(winner=>!winner.player.hidden)}));
    root.innerHTML=`<div class="evening-heading"><div><p class="league-kicker">Після останньої роздачі</p><h2 class="league-heading" id="leagueEveningTitle">Останній ігровий вечір${evening.day?' · День '+evening.day:''}</h2></div><span class="evening-date">${esc(date)}</span></div><div class="evening-body"><div class="evening-winners">${visibleWinners.map(game=>`<div class="evening-winner"><span class="evening-game-label">${esc(gameTitle(game))}</span>${game.winners.length?game.winners.map(winner=>`${avatarHTML(winner.player)}<div><span class="label">Переможець гри</span><strong>${personLink(winner)}</strong>${winner.placeSource==='derived'?'<small>Місце за результатами гри</small>':''}</div>`).join(''):game.hasHiddenWinner?'<span class="muted">Переможець прихований у таблиці</span>':'<span class="muted">Переможця ще не визначено у записах</span>'}</div>`).join('')}</div><div class="evening-metrics"><div class="evening-metric"><strong>${evening.participantCount}</strong><span>учасників за вечір</span></div><div class="evening-metric"><strong>${evening.games.length}</strong><span>ігор за вечір</span></div>${evening.biggestGain?`<div class="evening-rise"><span class="league-rank-move up">↑${evening.biggestGain.places}</span><div><span class="label">Найбільший підйом за вечір</span><strong>${evening.biggestGain.leaders.map(personLink).join(' · ')}</strong><small>${evening.biggestGain.leaders.map(p=>p.from+' → '+p.to+' місце').join(' · ')}</small></div></div>`:''}</div></div>`;
  }
  function renderRecords(){
    el('leagueRecordsScope').textContent=seasonLabel()+' · видимі гравці';
    const definitions=[['mostWins','♠','Найбільше перемог','перемог'],['podiumRun','♦','Найдовша призова серія','ігор поспіль у топ-3'],['mostGames','♣','Найбільше зіграних ігор','зіграних ігор']];
    el('leagueRecords').innerHTML=definitions.map(([key,icon,title,unit])=>{
      const record=ui.derived.records[key];
      return `<article class="league-record"><span class="record-icon" aria-hidden="true">${icon}</span><h3 class="record-title">${title}</h3>${record.available?`<p class="record-value">${record.value} <small>${unit}</small></p><div class="record-holders">${record.leaders.map(personLink).join(' · ')}</div>${record.leaders.some(p=>p.containsDerived)?'<p class="league-form-help">За місцями у наявних результатах ігор</p>':''}`:'<p class="record-value">—</p><p class="league-form-help">Поки немає підтверджених результатів</p>'}</article>`;
    }).join('');
  }
  function render(){
    if(!window.FoxLeagueStats)return;
    ui.derived=FoxLeagueStats.derive(state,{getStats,gameOrder,gameDetails,seasonId:activeSeasonId});
    ui.players=new Map(ui.derived.players.map(player=>[player.id,player]));
    const rows=visibleRows(getStats().rows);
    el('leagueSeasonStatus').textContent=seasonLabel()+(activeSeasonId==='season2'?' · активний':' · архів');
    el('leagueHeroAvatars').innerHTML=rows.filter(row=>row.player.avatar).slice(0,3).map(row=>`<div class="club-hero-identity">${avatarHTML(row.player)}</div>`).join('');
    // Counts refer to games with actual played records, not future scheduled columns.
    el('gamesCount').textContent=ui.derived.totals.games;
    renderDeck(rows);renderEvening();renderRecords();
    const pokerRoute=!/^#(?:mafia|root|account)(?:\/|$)/.test(location.hash);
    document.body.classList.toggle('league-other-route',!pokerRoute);
  }
  function refreshFiltered(){
    const stats=getStats(),rows=visibleRows(stats.rows);
    renderLeaderboard(rows,stats.games);renderDeck(rows);
  }
  function setView(compact,manual=true){
    if(manual)ui.manualView=true;
    document.body.classList.toggle('league-compact',compact);
    document.body.classList.toggle('league-full-results',!compact);
    el('leagueViewCompact').setAttribute('aria-pressed',String(compact));
    el('leagueViewFull').setAttribute('aria-pressed',String(!compact));
    requestAnimationFrame(()=>{if(typeof connectLeaderboardScroll==='function')connectLeaderboardScroll(document.getElementById('leaderboardScrollBottom')?.scrollLeft||0);});
  }
  function enhanceProfile(row){
    const root=el('profileContent');
    root.querySelector('.profile-formsection')?.remove();
    const section=document.createElement('section');section.className='profile-formsection';
    section.innerHTML=`<div class="panel-title"><h3>Форма за останні 5 ігор</h3>${formHTML(row.player.id)}</div><p class="league-form-help">Від новішої гри до давнішої. Число — місце; «?» — місце невідоме. Враховуються лише ігри за участі гравця.</p>`;
    root.querySelector('.profile-stats')?.after(section);
    const title=el('profileHeading');if(title)title.tabIndex=-1;
    requestAnimationFrame(()=>title?.focus({preventScroll:true}));
  }
  window.clubLeague={render,filterRows,formHTML,movementHTML,enhanceProfile,setView};
  // Reuse the existing sections and all their IDs/listeners, with standings first.
  const records=el('leagueRecordsSection'),fund=el('prizeFundSection'),rules=el('finalRules'),analyzer=document.querySelector('.analyzer-launch');
  records.after(fund,rules,analyzer);
  const summary=document.querySelector('.summary');summary?.querySelector('.champion')?.closest('.panel')?.classList.add('league-champion-duplicate');
  const subnav=document.createElement('nav');subnav.className='club-subnav';subnav.setAttribute('aria-label','Розділи покерної ліги');
  subnav.innerHTML='<a href="#leagueStandings" data-league-anchor="leagueStandings">Таблиця сезону</a><a href="#clubDeck" data-league-anchor="clubDeck">Клубна колода</a><a href="#leagueRecordsSection" data-league-anchor="leagueRecordsSection">Рекорди</a><a href="#recentResultsSection" data-league-anchor="recentResultsSection">Історія ігор</a>';
  const seasonBar=document.createElement('div');seasonBar.className='league-season-bar';
  const seasonSwitcher=document.querySelector('.season-switcher');seasonSwitcher.before(seasonBar);seasonBar.append(seasonSwitcher,subnav);
  ['clubDeck','leagueRecordsSection','recentResultsSection'].forEach(id=>el(id).tabIndex=-1);
  el('leagueTableSearch').addEventListener('input',event=>{ui.query=event.target.value;refreshFiltered();});
  el('leagueTableSort').addEventListener('change',event=>{ui.sort=event.target.value;refreshFiltered();});
  el('leagueViewCompact').addEventListener('click',()=>setView(true));el('leagueViewFull').addEventListener('click',()=>setView(false));
  // Mobile begins with the three essential columns, with full results one tap away.
  const viewport=matchMedia('(max-width:700px)');setView(viewport.matches,false);
  viewport.addEventListener('change',event=>{if(!ui.manualView)setView(event.matches,false);});
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('[data-league-anchor]');
    if(anchor){event.preventDefault();const target=el(anchor.dataset.leagueAnchor);target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});target?.focus({preventScroll:true});return;}
    const profile=event.target.closest?.('a[href*="/player/"]');if(profile)ui.profileOpener={element:profile,href:profile.getAttribute('href'),deck:profile.classList.contains('deck-card')};
  });
  const modal=el('profileModal');let wasOpen=false;
  new MutationObserver(()=>{
    const open=modal.classList.contains('show');
    if(wasOpen&&!open){
      const opener=ui.profileOpener;
      const target=opener?.element.isConnected?opener.element:opener?[...document.querySelectorAll(opener.deck?'.deck-card':'a[href*="/player/"]')].find(link=>link.getAttribute('href')===opener.href):el('pageTitle');
      target?.focus({preventScroll:true});ui.profileOpener=null;
    }
    wasOpen=open;
  }).observe(modal,{attributes:true,attributeFilter:['class']});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||!modal.classList.contains('show'))return;
    const focusables=[...modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.disabled);
    if(!focusables.length)return;
    const first=focusables[0],last=focusables[focusables.length-1],current=document.activeElement;
    if(event.shiftKey&&(current===first||current===el('profileHeading'))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&current===last){event.preventDefault();first.focus();}
  });
})();
