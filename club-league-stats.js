(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.FoxLeagueStats=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';

  // Read-only projections. The site's getStats remains the authority for points,
  // places and ranking tie-breaks. Legacy calculated places are explicitly marked
  // as derived; neither a missing placement nor an absence is called a loss.
  const copy=value=>JSON.parse(JSON.stringify(value));
  const positiveInteger=value=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):null;
  const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
  const validDate=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date=new Date(value+'T12:00:00Z');
    return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value?value:'';
  };

  function derive(seasonState,options={}){
    const {getStats,gameOrder,gameDetails,seasonId=''}=options;
    if(typeof getStats!=='function'||typeof gameOrder!=='function'||typeof gameDetails!=='function'){
      throw new TypeError('FoxLeagueStats.derive requires the site getStats, gameOrder and gameDetails functions.');
    }
    const season=copy(seasonState||{settings:{},players:[],results:[]});
    season.settings=season.settings||{};
    season.players=Array.isArray(season.players)?season.players:[];
    season.results=Array.isArray(season.results)?season.results:[];
    const stats=getStats(season);
    const allRows=Array.isArray(stats?.rows)?stats.rows:[];
    const rows=allRows.filter(row=>row.player&&!row.player.hidden);
    const playerById=new Map(season.players.map(player=>[player.id,player]));
    const rawResults=season.results.filter(result=>!result.absent&&result.gameName&&playerById.has(result.playerId));
    const actualNames=new Set(rawResults.map(result=>result.gameName));
    const orderedNames=[...new Set(gameOrder(season)||[])].filter(name=>actualNames.has(name));
    // gameOrder currently includes all stored result keys; retaining this fallback
    // avoids dropping real results if that implementation later becomes stricter.
    actualNames.forEach(name=>{if(!orderedNames.includes(name)) orderedNames.push(name);});
    const orderByName=new Map(orderedNames.map((name,index)=>[name,index]));
    const detailsByName=new Map(orderedNames.map(name=>{
      const detail=gameDetails(name,season)||{};
      return [name,{name,day:positiveInteger(detail.day),number:positiveInteger(detail.number),date:validDate(detail.date)}];
    }));
    const resultByGame=new Map(orderedNames.map(name=>[name,[]]));

    function projectedResult(result){
      const detail=detailsByName.get(result.gameName)||{name:result.gameName,day:null,number:null,date:''};
      const place=positiveInteger(result.calculatedPlace);
      const recordedPlace=positiveInteger(result.place);
      return {
        id:result.id||'',playerId:result.playerId,gameName:result.gameName,
        day:detail.day,number:detail.number,date:validDate(result.date)||detail.date,
        points:numeric(result.points),place,
        placeSource:place===null?'unavailable':recordedPlace===place?'recorded':'derived',
        outcome:place===null?'unknown':place===1?'win':place<=3?'podium':'other'
      };
    }
    const chronological=(a,b)=>(orderByName.get(a.gameName)??-1)-(orderByName.get(b.gameName)??-1);
    const players=rows.map((row,index)=>{
      const played=(row.results||[]).filter(result=>!result.absent).map(projectedResult).sort(chronological);
      let currentRun=[],bestRun=[];
      played.forEach(result=>{
        if(result.place!==null&&result.place<=3){
          currentRun.push(result);
          if(currentRun.length>bestRun.length) bestRun=[...currentRun];
        }else{
          // Unknown is not a proven non-podium result, but also cannot establish
          // uninterrupted podium participation across the gap in evidence.
          currentRun=[];
        }
      });
      return {
        id:row.player.id,player:row.player,rank:index+1,
        points:numeric(row.points),games:numeric(row.games),wins:numeric(row.wins),top3:numeric(row.top3),movement:null,
        last5:played.slice(-5).reverse(),
        podiumRun:{length:bestRun.length,results:bestRun,containsDerived:bestRun.some(result=>result.placeSource==='derived')},
        unknownPlacements:played.filter(result=>result.place===null).length,
        derivedPlacements:played.filter(result=>result.placeSource==='derived').length
      };
    });
    // Include hidden historical participants in an evening, while visible ranking
    // and season record leaders follow the same visibility rule as the table.
    allRows.forEach(row=>{
      (row.results||[]).filter(result=>!result.absent).forEach(result=>{
        const group=resultByGame.get(result.gameName);
        if(group) group.push({...projectedResult(result),player:row.player});
      });
    });
    const games=orderedNames.map(name=>{
      const results=resultByGame.get(name)||[];
      const participants=[...new Map(results.map(result=>[result.playerId,{id:result.playerId,player:result.player}])).values()];
      const winners=results.filter(result=>result.place===1).map(result=>({id:result.playerId,player:result.player,placeSource:result.placeSource}));
      return {
        ...detailsByName.get(name),participants,participantCount:participants.length,winners,
        winnerStatus:winners.length?winners.some(winner=>winner.placeSource==='derived')?'derived':'recorded':'unavailable',
        unknownPlacements:results.filter(result=>result.place===null).length,
        results
      };
    });

    // A row's movement is the change after the last actual game, not after the
    // entire evening. A scheduled game or an absence-only column is excluded.
    // Seed positions before a player's first participation are not prior ranks.
    const lastGame=games.length?games[games.length-1]:null;
    if(lastGame){
      const beforeLastGame={...season,results:season.results.filter(result=>result.gameName!==lastGame.name)};
      const previousRows=(getStats(beforeLastGame)?.rows||[]).filter(row=>row.player&&!row.player.hidden);
      const previousById=new Map(previousRows.map((row,index)=>[row.player.id,{rank:index+1,games:numeric(row.games)}]));
      players.forEach(player=>{
        const previous=previousById.get(player.id);
        if(previous?.games>0&&previous.rank!==player.rank){
          player.movement={from:previous.rank,to:player.rank,places:previous.rank-player.rank,gameName:lastGame.name};
        }
      });
    }

    let latestEvening=null;
    if(games.length){
      const finalGame=games[games.length-1];
      const eveningKey=game=>game.day!==null?'day:'+game.day:game.date?'date:'+game.date:'game:'+game.name;
      const latestGames=games.filter(game=>eveningKey(game)===eveningKey(finalGame));
      const latestNames=new Set(latestGames.map(game=>game.name));
      const participants=[...new Map(latestGames.flatMap(game=>game.participants).map(player=>[player.id,player])).values()];
      const dates=[...new Set(latestGames.flatMap(game=>[game.date,...game.results.map(result=>result.date)]).filter(Boolean))].sort();
      let biggestGain=null;
      const previousSeason={...season,results:season.results.filter(result=>!latestNames.has(result.gameName))};
      const previousRows=(getStats(previousSeason)?.rows||[]).filter(row=>row.player&&!row.player.hidden);
      if(previousRows.some(row=>numeric(row.games)>0)){
        const previousById=new Map(previousRows.map((row,index)=>[row.player.id,{rank:index+1,games:numeric(row.games)}]));
        const gains=players.flatMap(player=>{
          const previous=previousById.get(player.id);
          return previous?.games>0&&previous.rank>player.rank?[{id:player.id,player:player.player,from:previous.rank,to:player.rank,places:previous.rank-player.rank}]:[];
        });
        if(gains.length){
          const places=Math.max(...gains.map(gain=>gain.places));
          biggestGain={places,leaders:gains.filter(gain=>gain.places===places)};
        }
      }
      latestEvening={
        key:eveningKey(finalGame),day:finalGame.day,date:dates.length===1?dates[0]:'',dates,
        ambiguousDate:dates.length>1,games:latestGames,participants,participantCount:participants.length,biggestGain
      };
    }

    function record(metric){
      const eligible=players.filter(player=>player.games>0);
      const value=eligible.length?Math.max(...eligible.map(metric)):0;
      const leaders=value>0?eligible.filter(player=>metric(player)===value).map(player=>({id:player.id,player:player.player,value,containsDerived:player.derivedPlacements>0})):[];
      return {value,leaders,available:leaders.length>0};
    }
    const records={
      mostWins:record(player=>player.wins),
      podiumRun:record(player=>player.podiumRun.length),
      mostGames:record(player=>player.games)
    };
    // For the streak record, only placements in that streak need an inference note.
    records.podiumRun.leaders.forEach(leader=>{
      leader.containsDerived=players.find(player=>player.id===leader.id).podiumRun.containsDerived;
    });
    records.mostGames.leaders.forEach(leader=>{leader.containsDerived=false;});
    const participatedIds=new Set(rawResults.map(result=>result.playerId));
    return {
      seasonId,players,games,lastGame,latestEvening,records,
      totals:{games:games.length,participants:participatedIds.size,visiblePlayers:players.length,playedResults:rawResults.length},
      conventions:{formOrder:'newest-first',podiumRun:'consecutive-played-games',recordScope:'visible-season-players',places:'site-calculated-place'}
    };
  }
  return {derive};
});
