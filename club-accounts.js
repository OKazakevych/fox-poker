/* Account data lives outside the legacy poker state. Firebase rules, not the PIN,
   authorize every privileged write. Passwords go only to Firebase Authentication. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => escapeHtml(String(value ?? ''));
  const model = {user:null, admin:false, profile:null, playerId:null, request:null, results:{}, tournaments:{}, profiles:{}, requests:{}, links:{}, ready:false, busy:false};
  let auth, db, generation=0;
  const subscriptions=[];
  const message=(text,error=false)=>{el('accountMessage').textContent=text;el('accountMessage').classList.toggle('error',error);};
  function explain(error){
    const messages={
      'auth/invalid-credential':'Невірний email або пароль.', 'auth/wrong-password':'Невірний email або пароль.',
      'auth/user-not-found':'Невірний email або пароль.', 'auth/email-already-in-use':'Цей email уже має акаунт. Увійди або віднови пароль.',
      'auth/weak-password':'Пароль не відповідає вимогам безпеки. Використай щонайменше 8 символів.',
      'auth/invalid-email':'Перевір адресу email.', 'auth/popup-closed-by-user':'Вхід через Google скасовано.',
      'auth/popup-blocked':'Браузер заблокував вікно Google. Дозволь спливні вікна для цього сайту.',
      'auth/unauthorized-domain':'Цей домен ще не дозволений у Firebase Authentication.',
      'auth/operation-not-allowed':'Цей спосіб входу ще не ввімкнений адміністратором.',
      'auth/account-exists-with-different-credential':'Цей email уже пов’язаний з іншим способом входу. Скористайся ним.',
      'auth/too-many-requests':'Забагато спроб. Спробуй пізніше.',
      'auth/network-request-failed':'Не вдалося підключитися. Перевір інтернет і повтори.',
      'PERMISSION_DENIED':'Немає прав доступу. Перевір підтвердження email або звернися до адміністратора.',
      'permission-denied':'Немає прав доступу. Перевір підтвердження email або звернися до адміністратора.'
    };
    return messages[error?.code]||error?.publicMessage||'Дію не виконано. Спробуй ще раз; якщо помилка повторюється — звернися до адміністратора.';
  }
  async function action(work){
    if(model.busy) return;
    model.busy=true;el('accountPage').setAttribute('aria-busy','true');
    document.querySelectorAll('[data-account-submit]').forEach(button=>button.disabled=true);
    message('');
    try{await work();}catch(error){message(explain(error),true);if(location.hash!=='#account')toast(explain(error));}
    finally{model.busy=false;el('accountPage').setAttribute('aria-busy','false');document.querySelectorAll('[data-account-submit]').forEach(button=>button.disabled=!model.ready);}
  }
  const publicError=text=>Object.assign(new Error(text),{publicMessage:text});
  function playerChoices(){
    const players=new Map();
    Object.values(appState.seasons).forEach(season=>season.players.forEach(player=>players.set(player.id,player)));
    return [...players.values()].sort((a,b)=>a.nickname.localeCompare(b.nickname,'uk'));
  }
  function playerName(id){return playerChoices().find(p=>p.id===id)?.nickname||'Гравця видалено';}
  function nickname(value){const clean=String(value||'').trim();if(clean.length<2||clean.length>40) throw publicError('Нікнейм має містити від 2 до 40 символів.');return clean;}
  function listen(path,apply){
    const ref=db.ref(path),current=generation;
    const handler=snapshot=>{if(current!==generation)return;apply(snapshot.val());render();};
    ref.on('value',handler,error=>{if(current===generation)message(explain(error),true);});
    subscriptions.push(()=>ref.off('value',handler));
  }
  function requireUser(verified=false){if(!auth?.currentUser) throw publicError('Спочатку увійди до свого акаунта.');if(verified&&!auth.currentUser.emailVerified) throw publicError('Спочатку підтвердь свій email.');return auth.currentUser;}
  function requireOwner(){requireUser(true);if(!model.admin)throw publicError('Ця дія доступна лише адміністратору.');}
  async function ensureProfile(user,preferredName){
    const ref=db.ref('club/profiles/'+user.uid),now=Date.now();
    const candidate=String(preferredName||user.displayName||'Гравець').trim().slice(0,40);
    await ref.transaction(current=>current||{nickname:candidate.length>=2?candidate:'Гравець',createdAt:now,updatedAt:now});
  }
  function resetAdmin(){
    model.admin=false;
    if(typeof isAdmin!=='undefined')isAdmin=false;
    el('adminBox').classList.remove('open');el('adminLock').style.display='';el('adminStatus').textContent='закрито';
    if(typeof hideCellEditor==='function')hideCellEditor();
  }
  async function sessionChanged(user){
    const current=++generation;subscriptions.splice(0).forEach(stop=>stop());resetAdmin();
    Object.assign(model,{user,profile:null,playerId:null,request:null,results:{},profiles:{},requests:{},links:{}});
    render();renderLeaderboard(visibleRows(getStats().rows),gameOrder());
    if(!user)return;
    listen('club/profiles/'+user.uid,value=>model.profile=value);
    listen('club/identityLinks/byAccount/'+user.uid,value=>model.playerId=value||null);
    listen('club/linkRequests/'+user.uid,value=>model.request=value);
    listen('club/results/'+user.uid,value=>model.results=value||{});
    listen('club/tournaments',value=>model.tournaments=value||{});
    try{await ensureProfile(user);}catch(error){if(current===generation)message(explain(error),true);}
    // A successful read of this server-protected path is the admin capability check.
    try{
      await db.ref('club/adminAccess').once('value');
      if(current!==generation)return;
      model.admin=true;
      listen('club/profiles',value=>model.profiles=value||{});
      listen('club/linkRequests',value=>model.requests=value||{});
      listen('club/identityLinks',value=>model.links=value||{});
      render();
    }catch{/* Expected for regular players; no admin capability is granted. */}
  }
  function statsCard(title,subtitle,metrics,footer=''){
    return `<article class="club-tournament-card"><div class="club-card-kicker">${esc(subtitle)}</div><h3>${esc(title)}</h3><dl class="club-metrics">${metrics.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${footer}</article>`;
  }
  function tournamentCards(){
    const cards=[];
    if(model.playerId){
      Object.entries(appState.seasons).forEach(([seasonId,season])=>{
        const rows=getStats(season).rows,row=rows.find(r=>r.player.id===model.playerId);
        if(!row)return;
        cards.push(statsCard('Poker · '+(SEASONS[seasonId]?.label||seasonId),'♠ Poker',[
          ['Бали',formatPoints(row.points)],['Ігри',row.games],['Перемоги',row.wins],['Місце',row.games&&!row.player.hidden?'#'+(rows.filter(r=>!r.player.hidden).findIndex(r=>r.player.id===row.player.id)+1):'—']
        ],`<p>${row.player.hidden?'Гравець прихований у публічній таблиці.':'Статистика оновлюється разом із лідербордом.'}</p>`));
      });
    }
    Object.entries(model.tournaments).forEach(([id,tournament])=>{
      const entries=Object.values(model.results[id]||{}),played=entries.filter(r=>!r.absent);
      if(tournament.archived&&!entries.length)return;
      const total=played.reduce((sum,r)=>sum+(Number(r.points)||0),0),wins=played.filter(r=>r.won===true).length;
      const history=entries.length?`<details><summary>Історія результатів · ${entries.length}</summary><ul class="club-history">${entries.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<li><strong>${esc(r.date)} · ${esc(r.round||'Гра')}</strong><span>${r.absent?'× Не був на грі':`${esc(formatPoints(r.points))} ${esc(tournament.unit||'балів')}${r.place?' · #'+esc(r.place):''}${r.won?' · перемога':''}`}</span>${r.note?`<small>${esc(r.note)}</small>`:''}</li>`).join('')}</ul></details>`:'<p>Результатів поки немає. Вони з’являться після внесення адміністратором.</p>';
      const kind=window.clubLeaderboards?.kindOf(tournament.game),boardLink=kind?`<p><a class="btn small secondary" href="${esc(window.clubLeaderboards.href(kind,id))}">Лідерборд ${esc(tournament.game)} ↗</a></p>`:'';
      cards.push(statsCard(tournament.title,tournament.game+(tournament.archived?' · архів':''),[[tournament.unit||'Бали',formatPoints(total)],['Ігри',played.length],['Перемоги',wins],['Середнє',played.length?formatPoints(total/played.length):'—']],boardLink+history));
    });
    if(!Object.values(model.tournaments).some(t=>t.game==='Мафія'))cards.push('<article class="club-tournament-card club-placeholder"><div class="club-card-kicker">Мафія</div><h3>Турніри Мафії</h3><p>Адміністратор ще не додав турнір. Тут буде твоя статистика, коли він з’явиться.</p></article>');
    if(!Object.values(model.tournaments).some(t=>t.game==='Root'))cards.push('<article class="club-tournament-card club-placeholder"><div class="club-card-kicker">Root</div><h3>Турніри Root</h3><p>Адміністратор ще не додав турнір. Бали різних ігор рахуються окремо.</p></article>');
    return cards.join('');
  }
  function options(select,items,placeholder){
    if(!select)return;const previous=select.value;
    select.innerHTML=`<option value="">${esc(placeholder)}</option>`+items.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');
    if(items.some(([value])=>value===previous))select.value=previous;
  }
  function renderAdmin(){
    el('clubAdminPanel').hidden=!model.admin;
    if(!model.admin){['clubRequestsList','clubAccountList','clubOtherResults','clubResultUser','clubResultTournament','clubEditTournament'].forEach(id=>el(id).innerHTML='');el('clubTournamentForm').reset();clearOtherResult();return;}
    options(el('clubResultUser'),Object.entries(model.profiles).map(([uid,p])=>[uid,p.nickname+' · '+uid.slice(0,6)]),'Оберіть акаунт гравця');
    options(el('clubResultTournament'),Object.entries(model.tournaments).filter(([,t])=>!t.archived).map(([id,t])=>[id,t.title]),'Оберіть турнір');
    options(el('clubEditTournament'),Object.entries(model.tournaments).map(([id,t])=>[id,t.title]),'Новий турнір');
    const links=model.links.byAccount||{};
    el('clubRequestsList').innerHTML=Object.entries(model.requests).map(([uid,r])=>`<article class="club-request"><div><strong>${esc(model.profiles[uid]?.nickname||'Акаунт')} → ${esc(playerName(r.playerId))}</strong><p>Перевір особу гравця перед підтвердженням.${links[uid]?' Зараз прив’язано: '+esc(playerName(links[uid])):''}</p></div><div class="actions"><button type="button" class="btn small green" data-approve="${esc(uid)}" data-player="${esc(r.playerId)}">Підтвердити</button><button type="button" class="btn small secondary" data-reject="${esc(uid)}">Відхилити</button></div></article>`).join('')||'<p class="muted">Немає запитів на прив’язку.</p>';
    el('clubAccountList').innerHTML=Object.entries(model.profiles).map(([uid,p])=>`<div class="club-member"><strong>${esc(p.nickname)}</strong><span>${links[uid]?'Poker: '+esc(playerName(links[uid])):'Poker не прив’язано'} · ID ${esc(uid.slice(0,6))}</span></div>`).join('')||'<p class="muted">Акаунтів ще немає.</p>';
  }
  function render(){
    if(!el('accountPage'))return;
    const active=location.hash==='#account';
    el('accountPage').hidden=!active;
    if(active){el('leaderboardPage').hidden=true;el('finalGamePage').hidden=true;el('prizeFundSection').hidden=true;el('pageTitle').textContent='Мій профіль';document.title='Мій профіль · Fox Poker Club';}
    el('accountPageLink').setAttribute('aria-current',active?'page':'false');
    if(active){el('leaderboardPageLink').setAttribute('aria-current','false');el('finalPageLink').setAttribute('aria-current','false');}
    el('accountGuest').hidden=!!model.user;el('accountMember').hidden=!model.user;
    el('accountPageLink').textContent=model.user?'Мій профіль':'Увійти / Зареєструватися';
    const user=model.user;
    if(!user){['accountName','accountEmail','accountPokerLink','accountLinkStatus'].forEach(id=>el(id).textContent='');el('accountTournaments').innerHTML='';el('accountNickname').value='';}
    if(user){
      el('accountName').textContent=model.profile?.nickname||user.displayName||'Гравець';
      el('accountEmail').textContent=user.email||'';
      el('accountVerify').hidden=user.emailVerified;
      el('accountRole').textContent=model.admin?'Адміністратор клубу':'Гравець клубу';
      if(document.activeElement!==el('accountNickname'))el('accountNickname').value=model.profile?.nickname||'';
      el('accountPokerLink').textContent=model.playerId?'Прив’язано до Poker: '+playerName(model.playerId):'Ще не прив’язано до гравця Poker.';
      el('accountLinkStatus').textContent=model.request?'Запит на '+playerName(model.request.playerId)+' очікує підтвердження адміністратора.':'';
      options(el('accountPokerPlayer'),playerChoices().map(p=>[p.id,p.nickname]),'Оберіть свого гравця');
      el('accountTournaments').innerHTML=tournamentCards();
      el('accountAdminButton').hidden=!model.admin;
    }
    renderAdmin();
    window.renderPokerRecovery?.();
    window.clubLeaderboards?.render();
  }
  async function signInGoogle(){
    if(!model.ready)return message('Вхід поки недоступний. Онови сторінку.',true);
    return action(async()=>{const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});const result=await auth.signInWithPopup(provider);await ensureProfile(result.user);message('Вхід виконано.');});
  }
  async function submitCredentials(event){
    event.preventDefault();const mode=el('accountMode').value,email=el('accountLoginEmail').value.trim(),password=el('accountPassword').value;
    return action(async()=>{
      try{
        if(mode==='register'){
          const name=nickname(el('accountRegisterNickname').value);
          if(password.length<8)throw publicError('Пароль має містити щонайменше 8 символів.');
          if(password!==el('accountPasswordConfirm').value)throw publicError('Паролі не збігаються.');
          const result=await auth.createUserWithEmailAndPassword(email,password);
          await ensureProfile(result.user,name);
          await db.ref('club/profiles/'+result.user.uid).update({nickname:name,updatedAt:Date.now()});
          await result.user.sendEmailVerification();message('Акаунт створено. Підтвердь email за посиланням у листі.');
        }else{await auth.signInWithEmailAndPassword(email,password);message('Вхід виконано.');}
      }finally{el('accountPassword').value='';el('accountPasswordConfirm').value='';}
    });
  }
  function setMode(){const register=el('accountMode').value==='register';el('accountRegistrationFields').hidden=!register;el('accountConfirmField').hidden=!register;el('accountRegisterNickname').required=register;el('accountPasswordConfirm').required=register;el('accountPassword').autocomplete=register?'new-password':'current-password';el('accountSubmit').textContent=register?'Створити акаунт':'Увійти';}
  async function approve(uid,playerId){
    return action(async()=>{
      requireOwner();
      if(!playerChoices().some(p=>p.id===playerId))throw publicError('Гравця більше немає в базі Poker.');
      const outcome=await db.ref('club/identityLinks').transaction(value=>{
        const links=value||{},byAccount={...(links.byAccount||{})},byPlayer={...(links.byPlayer||{})};
        if(byPlayer[playerId]&&byPlayer[playerId]!==uid)return;
        const old=byAccount[uid];if(old)delete byPlayer[old];byAccount[uid]=playerId;byPlayer[playerId]=uid;
        return {byAccount,byPlayer};
      });
      if(!outcome.committed)throw publicError('Цей гравець уже належить іншому акаунту. Прив’язку не змінено.');
      await db.ref('club/linkRequests/'+uid).remove();toast('Профіль прив’язано');
    });
  }
  async function saveTournament(event){
    event.preventDefault();return action(async()=>{
      requireOwner();const id=el('clubEditTournament').value||db.ref('club/tournaments').push().key;
      const title=el('clubTournamentTitle').value.trim(),game=el('clubTournamentGame').value.trim(),unit=el('clubTournamentUnit').value.trim();
      if(!title||title.length>80||!game||game.length>40||!unit||unit.length>30)throw publicError('Перевір назву турніру, гру та одиницю балів.');
      await db.ref('club/tournaments/'+id).set({title,game,unit,archived:el('clubTournamentArchived').checked,updatedAt:Date.now()});
      el('clubEditTournament').value=id;
      await publishTournament(id);
      toast('Турнір збережено');
    });
  }
  async function publishTournament(id){
    requireOwner();if(!window.clubLeaderboards)return;
    // Read complete, fresh private snapshots only as admin. Project a strict public allowlist.
    const started=Date.now();
    try{
      const [tournament,results,profiles,links]=await Promise.all(['club/tournaments/'+id,'club/results','club/profiles','club/identityLinks'].map(path=>db.ref(path).once('value')));
      const projected=await window.clubLeaderboards.buildProjection(id,tournament.val(),results.val(),profiles.val(),links.val(),playerChoices(),started);
      requireOwner();
      await db.ref('club/publicBoards/'+id).transaction(previous=>previous&&previous.updatedAt>started?undefined:projected);
      el('clubPublishStatus').textContent='Публічний лідерборд оновлено.';
    }catch(error){el('clubPublishStatus').textContent='Основні дані збережені, але публічний рейтинг не оновився. Натисни «Оновити публічні лідерборди», щоб повторити.';throw publicError(el('clubPublishStatus').textContent);}
  }
  async function publishAllBoards(){
    return action(async()=>{requireOwner();el('clubPublishStatus').textContent='Оновлюємо публічні рейтинги…';const snapshot=await db.ref('club/tournaments').once('value');const ids=Object.entries(snapshot.val()||{}).filter(([,t])=>window.clubLeaderboards?.kindOf(t.game)).map(([id])=>id);for(const id of ids)await publishTournament(id);el('clubPublishStatus').textContent=ids.length?'Оновлено лідербордів: '+ids.length+'.':'Спочатку додай турнір Мафії або Root у формі нижче.';});
  }
  async function loadOtherResults(){
    const uid=el('clubResultUser').value,id=el('clubResultTournament').value,current=generation;
    el('clubOtherResults').innerHTML='';if(!model.admin||!uid||!id)return;
    try{
      const snapshot=await db.ref('club/results/'+uid+'/'+id).once('value');
      if(current!==generation||uid!==el('clubResultUser').value||id!==el('clubResultTournament').value)return;
      const values=snapshot.val()||{};el('clubOtherResults').innerHTML=Object.entries(values).sort(([,a],[,b])=>b.date.localeCompare(a.date)).map(([key,r])=>`<button type="button" class="club-result-edit" data-edit-result="${esc(key)}">${esc(r.date)} · ${esc(r.round)} — ${r.absent?'× не був':esc(formatPoints(r.points))+' '+esc(model.tournaments[id]?.unit||'балів')}</button>`).join('')||'<p class="muted">Поки немає результатів.</p>';
    }catch(error){message(explain(error),true);}
  }
  async function editOtherResult(key){
    return action(async()=>{requireOwner();const uid=el('clubResultUser').value,id=el('clubResultTournament').value;const snapshot=await db.ref('club/results/'+uid+'/'+id+'/'+key).once('value');const r=snapshot.val();if(!r)throw publicError('Результат більше не існує.');el('clubResultId').value=key;el('clubResultDate').value=r.date;el('clubResultRound').value=r.round;el('clubResultPoints').value=r.points;el('clubResultPlace').value=r.place||'';el('clubResultWon').checked=!!r.won;el('clubResultAbsent').checked=!!r.absent;el('clubResultNote').value=r.note||'';toggleOtherAbsent();});
  }
  function clearOtherResult(){el('clubResultId').value='';el('clubResultDate').value=todayISO();el('clubResultRound').value='';el('clubResultPoints').value='';el('clubResultPlace').value='';el('clubResultWon').checked=false;el('clubResultAbsent').checked=false;el('clubResultNote').value='';toggleOtherAbsent();}
  function toggleOtherAbsent(){const absent=el('clubResultAbsent').checked;['clubResultPoints','clubResultPlace','clubResultWon'].forEach(id=>el(id).disabled=absent);el('clubResultPoints').required=!absent;}
  async function saveOtherResult(event){
    event.preventDefault();return action(async()=>{
      requireOwner();const uid=el('clubResultUser').value,tournament=el('clubResultTournament').value,date=el('clubResultDate').value,round=el('clubResultRound').value.trim(),absent=el('clubResultAbsent').checked;
      if(!model.profiles[uid]||!model.tournaments[tournament]||!date||!round||round.length>60)throw publicError('Оберіть акаунт, турнір, дату й назву гри.');
      const points=absent?0:Number(el('clubResultPoints').value),place=absent?null:(el('clubResultPlace').value?Number(el('clubResultPlace').value):null),note=el('clubResultNote').value.trim();
      if(!Number.isFinite(points)||(place!==null&&(!Number.isInteger(place)||place<1))||note.length>500)throw publicError('Перевір бали, місце та коментар (до 500 символів).');
      const ref=db.ref('club/results/'+uid+'/'+tournament),key=el('clubResultId').value||ref.push().key;
      await ref.child(key).set({date,round,points,place,won:!absent&&el('clubResultWon').checked,absent,note,updatedAt:Date.now()});
      clearOtherResult();await loadOtherResults();await publishTournament(tournament);toast('Результат турніру збережено');
    });
  }
  function bind(){
    el('clubPublishBoards').addEventListener('click',publishAllBoards);
    el('accountCredentials').addEventListener('submit',submitCredentials);el('accountMode').addEventListener('change',setMode);el('accountGoogle').addEventListener('click',signInGoogle);
    el('accountReset').addEventListener('click',()=>action(async()=>{const email=el('accountLoginEmail').value.trim();if(!email)throw publicError('Введи email у поле вище.');await auth.sendPasswordResetEmail(email);message('Якщо акаунт існує, на його email надійде лист відновлення.');}));
    el('accountSignOut').addEventListener('click',()=>action(async()=>{await auth.signOut();el('accountPassword').value='';message('Ти вийшов з акаунта.');}));
    el('accountResendVerification').addEventListener('click',()=>action(async()=>{await requireUser().sendEmailVerification();message('Лист підтвердження надіслано.');}));
    el('accountRefreshVerification').addEventListener('click',()=>action(async()=>{const user=requireUser();await user.reload();await user.getIdToken(true);await sessionChanged(auth.currentUser);message(user.emailVerified?'Email підтверджено.':'Email ще не підтверджено. Перевір пошту, зокрема папку «Спам».');}));
    el('accountNicknameForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const user=requireUser(),name=nickname(el('accountNickname').value);await db.ref('club/profiles/'+user.uid).update({nickname:name,updatedAt:Date.now()});message('Нікнейм збережено.');});});
    el('accountLinkForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const user=requireUser(true),playerId=el('accountPokerPlayer').value;if(!playerChoices().some(p=>p.id===playerId))throw publicError('Оберіть свого гравця.');await db.ref('club/linkRequests/'+user.uid).set({playerId,createdAt:Date.now()});message('Запит на прив’язку надіслано адміністратору.');});});
    el('accountAdminButton').addEventListener('click',()=>{location.hash='#'+activeSeasonId;requestAnimationFrame(()=>{loginAdmin();scrollToAdmin();});});
    el('clubRequestsList').addEventListener('click',event=>{const accept=event.target.closest('[data-approve]'),reject=event.target.closest('[data-reject]');if(accept)approve(accept.dataset.approve,accept.dataset.player);if(reject)action(async()=>{requireOwner();await db.ref('club/linkRequests/'+reject.dataset.reject).remove();toast('Запит відхилено');});});
    el('clubTournamentForm').addEventListener('submit',saveTournament);
    el('clubEditTournament').addEventListener('change',()=>{const t=model.tournaments[el('clubEditTournament').value];el('clubTournamentTitle').value=t?.title||'';el('clubTournamentGame').value=t?.game||'Мафія';el('clubTournamentUnit').value=t?.unit||'Бали';el('clubTournamentArchived').checked=!!t?.archived;});
    ['clubResultUser','clubResultTournament'].forEach(id=>el(id).addEventListener('change',()=>{clearOtherResult();loadOtherResults();}));
    el('clubResultForm').addEventListener('submit',saveOtherResult);el('clubResultNew').addEventListener('click',clearOtherResult);el('clubResultAbsent').addEventListener('change',toggleOtherAbsent);el('clubOtherResults').addEventListener('click',event=>{const button=event.target.closest('[data-edit-result]');if(button)editOtherResult(button.dataset.editResult);});
    setMode();clearOtherResult();
  }
  async function init(){
    bind();render();
    if(!window.firebase?.auth||!firebase.apps.length){message('Сервіс входу не завантажився. Перевір інтернет і онови сторінку.',true);document.querySelectorAll('[data-account-submit]').forEach(button=>button.disabled=true);return;}
    auth=firebase.auth();db=firebase.database();auth.languageCode='uk';
    try{await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);model.ready=true;auth.onAuthStateChanged(sessionChanged,error=>message(explain(error),true));}
    catch(error){message(explain(error),true);}
  }
  window.clubAccounts={canAdmin:()=>model.admin&&!!auth?.currentUser?.emailVerified,render,signInGoogle};
  init();
})();
