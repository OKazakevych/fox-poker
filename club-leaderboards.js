/* Public leaderboard projections contain no account UID, email or private notes.
   Only the verified administrator can write them through Firebase rules. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id),esc=value=>escapeHtml(String(value??''));
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  const fmt=value=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(number(value));
  const themes={mafia:{name:'Мафія',eyebrow:'Ніч. Місто. Твоя гра.',lead:'Переконуй, помічай деталі та збирай перемоги. Кожна партія залишає слід у рейтингу.',motto:'Місто засинає. За столом залишаються інтуїція, аргументи й холодний розрахунок.',symbol:'☾ · МАФІЯ · ☽'},root:{name:'Root',eyebrow:'Лісова хроніка клубу',lead:'Різні фракції, власні стратегії, спільна історія за столом. Стеж за своїм шляхом до вершини.',motto:'Великі амбіції маленьких мешканців. Кожна партія — нова історія лісу.',symbol:'❧ · ROOT · ❧'}};
  const kindOf=game=>{const name=String(game||'').trim().toLocaleLowerCase();return ['мафія','мафия','mafia'].includes(name)?'mafia':name==='root'?'root':null;};
  const safeAvatar=value=>{const src=String(value||'');return /^(?:avatars2\/[a-z0-9_-]+\.png|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"<>]+)$/i.test(src)?src:'';};
  async function publicKey(tournamentId,uid){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tournamentId+':'+uid));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
  async function buildProjection(id,tournament,allResults,profiles,links,pokerPlayers,updatedAt=Date.now()){
    const kind=kindOf(tournament?.game);if(!kind)return null;
    const players={};
    await Promise.all(Object.entries(allResults||{}).map(async([uid,tournaments])=>{
      const records=Object.values(tournaments?.[id]||{});if(!records.length)return;
      const poker=pokerPlayers.find(p=>p.id===links?.byAccount?.[uid]);
      const key=await publicKey(id,uid),nickname=String(poker?.nickname||profiles?.[uid]?.nickname||'Гравець').slice(0,80);
      players[key]={nickname,avatar:safeAvatar(poker?.avatar),results:records.map(r=>({date:String(r.date||'').slice(0,10),round:String(r.round||'Гра').slice(0,60),points:r.absent?0:number(r.points),place:r.absent?0:Math.max(0,Math.floor(number(r.place))),won:!r.absent&&r.won===true,absent:r.absent===true}))};
    }));
    return {kind,title:String(tournament.title||themes[kind].name).slice(0,80),unit:String(tournament.unit||'Бали').slice(0,30),archived:!!tournament.archived,updatedAt,players};
  }
  function standings(board){
    const rows=Object.entries(board?.players||{}).map(([key,p])=>{
      const entries=Object.values(p.results||{}),played=entries.filter(r=>!r.absent);
      return {key,nickname:String(p.nickname||'Гравець'),avatar:safeAvatar(p.avatar),entries,games:played.length,points:played.reduce((sum,r)=>sum+number(r.points),0),wins:played.filter(r=>r.won===true).length};
    }).sort((a,b)=>(b.games>0)-(a.games>0)||b.points-a.points||b.wins-a.wins||a.nickname.localeCompare(b.nickname,'uk')||a.key.localeCompare(b.key));
    let rank=0;rows.forEach((row,i)=>{if(!row.games){row.rank=null;return;}const previous=rows[i-1];if(!previous||row.points!==previous.points||row.wins!==previous.wins)rank=i+1;row.rank=rank;});return rows;
  }
  const route=()=>{const match=location.hash.match(/^#(mafia|root)(?:\/tournament\/([^/]+))?(?:\/player\/([^/]+))?$/);if(!match)return null;try{return {kind:match[1],id:match[2]?decodeURIComponent(match[2]):null,player:match[3]||null};}catch{return null;}};
  const href=(kind,id,player)=>'#'+kind+(id?'/tournament/'+encodeURIComponent(id):'')+(player?'/player/'+player:'');
  const model={boards:{},loaded:false,error:false,selected:{},lastKind:null};
  const originalMotto=document.querySelector('.marquee .subtitle').textContent,originalSymbol=document.querySelector('.overline').textContent;
  const avatar=row=>`<span class="board-avatar">${row.avatar?`<img src="${esc(row.avatar)}" alt="" loading="lazy">`:esc(row.nickname.trim().slice(0,2).toUpperCase())}</span>`;
  const roundKey=r=>JSON.stringify([r.date,r.round]);
  function roundList(rows){const map=new Map();rows.forEach(row=>row.entries.forEach(r=>map.set(roundKey(r),{key:roundKey(r),date:r.date,round:r.round})));return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.round).localeCompare(String(b.round),'uk',{numeric:true}));}
  function summary(rows,rounds){const played=rows.filter(r=>r.games>0);return [['Гравців у турнірі',rows.length],['Ігор проведено',rounds.length],['Записів участі',rows.reduce((sum,r)=>sum+r.games,0)],['Лідер рейтингу',played.length?played[0].nickname:'—']].map(([label,value])=>`<article><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`).join('');}
  function podium(rows,kind,id,unit){return rows.filter(r=>r.games>0).slice(0,3).map(row=>`<article><span class="board-rank" aria-label="Місце ${row.rank}">${row.rank}</span>${avatar(row)}<div><h3><a href="${esc(href(kind,id,row.key))}">${esc(row.nickname)}</a></h3><strong>${fmt(row.points)}</strong><small>${esc(unit)} · ${row.wins} перемог</small></div></article>`).join('');}
  function table(rows,rounds,kind,id,unit){return `<caption class="sr-only">Рейтинг ${esc(themes[kind].name)}. ${esc(unit)}, ігри, перемоги та результати раундів.</caption><thead><tr><th scope="col">Місце</th><th scope="col">Гравець</th><th scope="col">${esc(unit)}</th><th scope="col">Ігри</th><th scope="col">Перемоги</th><th scope="col">Середнє</th>${rounds.map(r=>`<th class="board-round" scope="col">${esc(r.round)}<small>${esc(r.date)}</small></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td><span class="board-rank">${row.rank||'—'}</span></td><td class="board-player-cell"><a class="board-player-link" href="${esc(href(kind,id,row.key))}">${avatar(row)}<span>${esc(row.nickname)}</span></a></td><td class="board-score">${fmt(row.points)}</td><td>${row.games}</td><td>${row.wins}</td><td>${row.games?fmt(row.points/row.games):'—'}</td>${rounds.map(round=>{const records=row.entries.filter(r=>roundKey(r)===round.key),played=records.filter(r=>!r.absent);return `<td class="board-round${played.some(r=>r.won)?' board-result-win':''}" title="${records.length?played.length?'Балів за гру'+(played.some(r=>r.won)?' · перемога':''):'Гравця не було':'Результат не внесено'}">${!records.length?'—':!played.length?'×':fmt(played.reduce((sum,r)=>sum+number(r.points),0))}</td>`;}).join('')}</tr>`).join('')}</tbody>`;}
  function showPlayer(current,board,rows,id){
    const root=el('clubBoardPlayer');root.hidden=!current.player;if(!current.player){root.innerHTML='';return;}
    const row=rows.find(r=>r.key===current.player);
    root.innerHTML=row?`<a class="board-back" href="${esc(href(current.kind,id))}">← Усі гравці</a><h3 id="clubBoardPlayerTitle">${esc(row.nickname)}</h3><p>${fmt(row.points)} ${esc(board.unit)} · ${row.games} ігор · ${row.wins} перемог</p><ul>${[...row.entries].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.round).localeCompare(String(b.round),'uk',{numeric:true})).map(r=>`<li><span>${esc(r.date)} · ${esc(r.round)}</span><strong>${r.absent?'× Не був на грі':fmt(r.points)+' '+esc(board.unit)+(r.place?' · місце '+r.place:'')+(r.won?' · перемога':'')}</strong></li>`).join('')}</ul>`:`<h3 id="clubBoardPlayerTitle">Гравця не знайдено</h3><a href="${esc(href(current.kind,id))}">Повернутися до таблиці</a>`;
  }
  function resizeScroll(){const table=el('clubBoardTable'),top=el('clubBoardScrollTop'),bottom=el('clubBoardScrollBottom');el('clubBoardScrollSizer').style.width=table.scrollWidth+'px';top.hidden=table.scrollWidth<=bottom.clientWidth+1;top.scrollLeft=bottom.scrollLeft;}
  function render(){
    const current=route(),active=!!current;el('clubLeaderboardPage').hidden=!active;
    if(active)document.body.dataset.clubGame=current.kind;else delete document.body.dataset.clubGame;
    document.querySelector('.marquee .subtitle').textContent=active?themes[current.kind].motto:originalMotto;
    document.querySelector('.overline').textContent=active?themes[current.kind].symbol:originalSymbol;
    el('mafiaPortal').setAttribute('aria-current',current?.kind==='mafia'?'page':'false');el('rootPortal').setAttribute('aria-current',current?.kind==='root'?'page':'false');
    if(!active)return;
    ['leaderboardPage','finalGamePage','prizeFundSection','accountPage'].forEach(id=>el(id).hidden=true);
    ['leaderboardPageLink','finalPageLink','accountPageLink'].forEach(id=>el(id).setAttribute('aria-current','false'));
    const theme=themes[current.kind];el('pageTitle').textContent=theme.name+' · Leaderboard';el('pageTitle').classList.remove('final-page-heading');document.title=theme.name+' · Лідерборд · Fox Club';
    el('clubBoardEyebrow').textContent=theme.eyebrow;el('clubBoardLead').textContent=theme.lead;
    el('clubBoardAdmin').hidden=!window.clubAccounts?.canAdmin();
    if(model.lastKind!==current.kind){el('clubBoardSearch').value='';model.lastKind=current.kind;}
    const list=Object.entries(model.boards).filter(([,b])=>b.kind===current.kind).sort(([,a],[,b])=>Number(a.archived)-Number(b.archived)||number(b.updatedAt)-number(a.updatedAt));
    const id=current.id||(list.some(([key])=>key===model.selected[current.kind])?model.selected[current.kind]:list[0]?.[0]);
    const board=list.find(([key])=>key===id)?.[1];if(board)model.selected[current.kind]=id;
    const select=el('clubBoardTournament');select.innerHTML=list.length?list.map(([key,b])=>`<option value="${esc(key)}">${esc(b.title)}${b.archived?' · архів':''}</option>`).join(''):'<option value="">Турнір ще не додано</option>';if(board)select.value=id;select.disabled=!list.length;
    el('clubBoardTitle').textContent=board?.title||'Лідерборд '+theme.name;
    const rows=standings(board),rounds=roundList(rows),query=el('clubBoardSearch').value.trim().toLocaleLowerCase(),filtered=rows.filter(r=>r.nickname.toLocaleLowerCase().includes(query));
    el('clubBoardSummary').innerHTML=summary(rows,rounds);el('clubBoardPodium').innerHTML=podium(rows,current.kind,id,board?.unit||'Бали');
    el('clubBoardTable').innerHTML=table(filtered,rounds,current.kind,id,board?.unit||'Бали');el('clubBoardCount').textContent=query?filtered.length+' із '+rows.length+' гравців':rows.length+' гравців';
    const empty=el('clubBoardEmpty');empty.hidden=filtered.length>0;
    empty.textContent=model.error?'Не вдалося завантажити рейтинг. Перевір інтернет і онови сторінку.':!model.loaded?'Завантажуємо турніри…':current.id&&!board?'Цей турнір не знайдено. Обери інший у списку вище.':!board?'Перший турнір ще попереду. Після додавання турніру та результатів в адмінці тут з’являться гравці й рейтинг.':!rows.length?'Турнір готовий до першої гри. Щойно адміністратор внесе результати, таблиця та п’єдестал заповняться.':'Нікого не знайдено. Спробуй інший нікнейм.';
    el('clubBoardStatus').textContent=model.error?'Помилка завантаження':!model.loaded?'Підключення до рейтингу…':board?.updatedAt?'Оновлено '+new Date(board.updatedAt).toLocaleString('uk-UA')+(board.archived?' · Завершений турнір':' · Поточний турнір'):'Окремий рейтинг · Перегляд доступний без входу';el('clubBoardStatus').classList.toggle('error',model.error);
    showPlayer(current,board,rows,id);requestAnimationFrame(resizeScroll);
  }
  function init(){
    el('clubBoardTournament').addEventListener('change',()=>{const current=route();if(current)location.hash=href(current.kind,el('clubBoardTournament').value);});
    el('clubBoardSearch').addEventListener('input',render);
    el('clubBoardAdmin').addEventListener('click',()=>{location.hash='#season2';requestAnimationFrame(()=>{loginAdmin();el('clubAdminPanel').open=true;el('clubAdminPanel').scrollIntoView({behavior:'smooth'});});});
    const top=el('clubBoardScrollTop'),bottom=el('clubBoardScrollBottom');top.addEventListener('scroll',()=>{if(bottom.scrollLeft!==top.scrollLeft)bottom.scrollLeft=top.scrollLeft;});bottom.addEventListener('scroll',()=>{if(top.scrollLeft!==bottom.scrollLeft)top.scrollLeft=bottom.scrollLeft;});
    new ResizeObserver(resizeScroll).observe(bottom);
    el('clubLeaderboardPage').addEventListener('error',event=>{if(event.target.tagName==='IMG'){const parent=event.target.parentElement;event.target.remove();parent.textContent='•';}},true);
    window.addEventListener('hashchange',()=>{render();const current=route();if(current){requestAnimationFrame(()=>{if(current.player)el('clubBoardPlayer').scrollIntoView({behavior:'smooth'});else{window.scrollTo({top:0,behavior:'instant'});el('pageTitle').focus({preventScroll:true});}});}});
    render();
    if(!window.firebase?.database||!firebase.apps.length){model.loaded=true;model.error=true;render();return;}
    firebase.database().ref('club/publicBoards').on('value',snapshot=>{model.boards=snapshot.val()||{};model.loaded=true;model.error=false;render();},()=>{model.loaded=true;model.error=true;render();});
  }
  window.clubLeaderboards={render,kindOf,href,buildProjection,standings};init();
})();
