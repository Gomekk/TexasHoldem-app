// =====================================================================
//  1人練習モード（CPU対戦）
//  ・リング／トーナメント、アンティ なし／全員／BBアンティ
//  ・プリフロップ表に自分の手札、相手の役の確率、勝率・必要勝率・おすすめアクション
//  ※ index.html の card / evaluate / handInfo / CHART / TIERS / CAT_NAME / esc / askConfirm などを使います
// =====================================================================
(function(){
"use strict";

const LS_CFG = "poker.practice.cfg", LS_STATS = "poker.practice.stats";
const CPU_NAMES = ["ハル","ミナ","ソラ","レン","ユイ","カイ","ノア","リク"];
const STYLES = [
  { n:"タイト",       vp:0.85, ag:0.50, bl:0.05 },
  { n:"ルース",       vp:1.25, ag:0.40, bl:0.12 },
  { n:"アグレッシブ", vp:1.05, ag:0.75, bl:0.18 },
  { n:"バランス",     vp:1.00, ag:0.55, bl:0.09 },
];
const TOUR_LEVELS = [[25,50],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600],[400,800],[500,1000],
  [700,1400],[1000,2000],[1500,3000],[2000,4000],[3000,6000],[5000,10000],[7500,15000],[10000,20000]];
const HANDS_PER_LEVEL = 8;
const RING_BLINDS = [50, 100], RING_STACK = 10000, TOUR_STACK = 5000;
const DELAY = { slow: 1100, normal: 650, fast: 250 };
const RCH = { 14:"A",13:"K",12:"Q",11:"J",10:"T",9:"9",8:"8",7:"7",6:"6",5:"5",4:"4",3:"3",2:"2" };
const SCH = ["s","h","d","c"];
const cs = c => RCH[c >> 2] + SCH[c & 3];                 // 数値 → "As"
const catOf = v => Math.floor(v / 1048576);               // evaluate の値 → 役の番号(0〜8)
const fmt = n => Math.round(n).toLocaleString("ja-JP");
const pctS = (v, d = 1) => (v * 100).toFixed(d) + "%";
const rnd = Math.random;

let cfg = load(LS_CFG, { format:"ring", opp:5, ante:"none", speed:"normal", advice:true, prob:true, chart:true });
let stats = load(LS_STATS, { hands:0, decisions:0, agree:0, ringProfit:0, tours:[], scoreSum:0, scoreN:0 });
function load(k, d){ try{ return Object.assign({}, d, JSON.parse(localStorage.getItem(k)) || {}); }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

let G = null;           // ゲーム状態
let page = "setup";     // setup / table
let prevScreen = "gate";
let ui = { sizing:false, raiseTo:0, reveal:false, showLog:false };
const cache = {};

// ---------------------------------------------------------------------
//  ハンドの強さ（Chen式）と、レンジ（上位◯%）のしきい値
// ---------------------------------------------------------------------
function chen(a, b){
  let r1 = a >> 2, r2 = b >> 2;
  if(r1 < r2){ const t = r1; r1 = r2; r2 = t; }
  const base = r => r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2;
  let s = base(r1);
  if(r1 === r2) return Math.max(5, s * 2);
  if((a & 3) === (b & 3)) s += 2;
  const gap = r1 - r2 - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if(gap <= 1 && r1 < 12) s += 1;
  return Math.ceil(s);
}
const ALL = []; for(let r = 2; r <= 14; r++) for(let s = 0; s < 4; s++) ALL.push((r << 2) | s);
const CHEN_SORTED = (() => { const v = []; for(let i = 0; i < 52; i++) for(let j = i + 1; j < 52; j++) v.push(chen(ALL[i], ALL[j])); return v.sort((x, y) => y - x); })();
const thrFor = pct => pct >= 1 ? -99 : CHEN_SORTED[Math.max(0, Math.floor(pct * CHEN_SORTED.length) - 1)];

// ---------------------------------------------------------------------
//  ゲームの開始
// ---------------------------------------------------------------------
function newGame(){
  const tour = cfg.format === "tour";
  const stack = tour ? TOUR_STACK : RING_STACK;
  const styles = STYLES.slice();
  const players = [{ id:0, name:"あなた", cpu:false, stack, out:false }];
  for(let i = 0; i < cfg.opp; i++){
    players.push({ id:i + 1, name:CPU_NAMES[i], cpu:true, stack, out:false, style:styles[Math.floor(rnd() * styles.length)] });
  }
  G = { tour, players, button:Math.floor(rnd() * players.length), handNo:0, level:0, sb:0, bb:0, ante:0,
        startStack:stack, buyin:stack, rebuys:0, outOrder:[], over:null, log:[], phase:"idle", board:[] };
  page = "table"; ui = { sizing:false, raiseTo:0, reveal:false, showLog:false };
  startHand();
}

function startHand(){
  clearTimeout(G.timer);
  const P = G.players;
  G.handNo++;
  if(G.tour){
    G.level = Math.min(TOUR_LEVELS.length - 1, Math.floor((G.handNo - 1) / HANDS_PER_LEVEL));
    [G.sb, G.bb] = TOUR_LEVELS[G.level];
  }else [G.sb, G.bb] = RING_BLINDS;
  G.ante = cfg.ante === "none" ? 0 : cfg.ante === "bb" ? G.bb : Math.max(5, Math.round(G.bb / 8 / 5) * 5);
  // リング：CPUは自動でリバイ
  if(!G.tour) P.forEach(p => { if(p.cpu && p.stack < G.bb){ p.stack = G.startStack; addLog(`${p.name} がリバイ`); } });
  P.forEach(p => Object.assign(p, { hole:[], folded:false, allin:false, bet:0, total:0, acted:false, act:"", shown:false,
    pfRaises:0, pfCalls:0, limped:false, aggr:[false,false,false,false], won:0, score:0 }));
  const act = P.filter(p => !p.out);
  // ボタンを進める
  let b = G.button;
  for(let k = 1; k <= P.length; k++){ const i = (G.button + k) % P.length; if(!P[i].out){ b = i; break; } }
  G.button = b;
  G.seats = seatOrder();                        // ボタンから時計回り
  G.deck = shuffle(ALL.slice());
  G.board = []; G.street = 0; G.result = null; G.raiseCount = 0; G.actions = 0;
  G.log = []; G.decisions = []; G.review = null; ui.review = true;
  G.startStacks = G.players.map(p => p.stack + p.total); G.stack0 = G.players[0].stack;
  addLog(`ハンド #${G.handNo}　ブラインド ${fmt(G.sb)}/${fmt(G.bb)}${G.ante ? `　アンティ ${fmt(G.ante)}` : ""}`);
  // アンティ（デッドマネー）
  const hu = act.length === 2;
  const sbSeat = hu ? G.seats[0] : G.seats[1], bbSeat = hu ? G.seats[1] : G.seats[2];
  G.sbSeat = sbSeat; G.bbSeat = bbSeat;
  if(cfg.ante === "all") act.forEach(p => putDead(p, G.ante));
  if(cfg.ante === "bb") putDead(P[bbSeat], G.ante);
  // ブラインド
  put(P[sbSeat], Math.min(G.sb, P[sbSeat].stack)); P[sbSeat].act = "SB";
  put(P[bbSeat], Math.min(G.bb, P[bbSeat].stack)); P[bbSeat].act = "BB";
  G.currentBet = G.bb; G.minRaise = G.bb;
  // 配る
  for(let r = 0; r < 2; r++) G.seats.forEach(i => P[i].hole.push(G.deck.pop()));
  G.phase = "play";
  G.toAct = nextActor(bbSeat);
  if(G.toAct < 0) return endStreet();
  schedule();
}
function seatOrder(){
  const P = G.players, out = [];
  for(let k = 0; k < P.length; k++){ const i = (G.button + k) % P.length; if(!P[i].out) out.push(i); }
  return out;
}
function shuffle(a){ for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function put(p, amt){ amt = Math.min(amt, p.stack); p.stack -= amt; p.bet += amt; p.total += amt; if(p.stack === 0) p.allin = true; return amt; }
function putDead(p, amt){ amt = Math.min(amt, p.stack); p.stack -= amt; p.total += amt; if(p.stack === 0) p.allin = true; }
function addLog(t){ G.log.push(t); }
const live = () => G.players.filter(p => !p.out && !p.folded);
const potTotal = () => G.players.reduce((a, p) => a + p.total, 0);
function nextActor(from){
  const P = G.players;
  for(let k = 1; k <= P.length; k++){ const i = (from + k) % P.length; const p = P[i]; if(!p.out && !p.folded && !p.allin) return i; }
  return -1;
}

// ---------------------------------------------------------------------
//  ポジション
// ---------------------------------------------------------------------
function posInfo(seat){
  const S = G.seats, n = S.length, i = S.indexOf(seat);
  if(i < 0) return { name:"", tier:4 };
  if(n === 2) return i === 0 ? { name:"BTN", tier:4 } : { name:"BB", tier:4 };
  if(i === 0) return { name:"BTN", tier:4 };
  if(i === 1) return { name:"SB", tier:3 };
  if(i === 2) return { name:"BB", tier:4 };
  const rest = n - 3, fromEnd = n - 1 - i;      // 0=CO
  const names = ["CO","HJ","LJ","UTG+2","UTG+1","UTG"], tiers = [3,2,2,1,1,0];
  const name = fromEnd === rest - 1 && rest >= 3 ? "UTG" : names[Math.min(fromEnd, 5)];
  return { name, tier: tiers[Math.min(fromEnd, 5)] };
}

// ---------------------------------------------------------------------
//  アクション
// ---------------------------------------------------------------------
function doAction(seat, type, to){
  if(G.phase !== "play" || seat !== G.toAct) return;
  const p = G.players[seat], toCall = G.currentBet - p.bet;
  if(type === "check" && toCall > 0) type = "call";
  if(type === "fold"){ p.folded = true; p.act = "フォールド"; addLog(`${p.name}：フォールド`); }
  else if(type === "check"){ p.act = "チェック"; addLog(`${p.name}：チェック`); }
  else if(type === "call"){
    put(p, toCall); p.act = p.allin ? "オールイン" : "コール";
    if(G.street === 0){ p.pfCalls++; if(G.raiseCount === 0) p.limped = true; }
    addLog(`${p.name}：${p.act} ${fmt(p.bet)}`);
  }else{
    to = Math.min(Math.max(to, G.currentBet + G.minRaise), p.bet + p.stack);
    const raiseBy = to - G.currentBet;
    put(p, to - p.bet);
    const word = G.currentBet === 0 ? "ベット" : "レイズ";
    p.act = p.allin ? "オールイン" : word;
    if(raiseBy > 0){
      if(raiseBy >= G.minRaise){ G.minRaise = raiseBy; G.players.forEach(q => { if(q !== p) q.acted = false; }); }
      G.currentBet = Math.max(G.currentBet, to);
      if(G.street === 0){ G.raiseCount++; p.pfRaises++; }
      p.aggr[G.street] = true;
    }
    addLog(`${p.name}：${p.act} ${fmt(p.bet)}`);
  }
  p.acted = true; G.actions++;
  advance();
}
function advance(){
  if(live().length === 1) return winUncontested();
  const can = live().filter(p => !p.allin);
  const done = can.every(p => p.acted && p.bet === G.currentBet);
  if(done) return endStreet();
  G.toAct = nextActor(G.toAct);
  if(G.toAct < 0) return endStreet();
  schedule();
}
function endStreet(){
  G.players.forEach(p => { p.bet = 0; p.acted = false; if(!p.folded && !p.allin && !p.out) p.act = ""; });
  G.currentBet = 0; G.minRaise = G.bb;
  if(G.street === 3) return showdown();
  dealStreet();
  const can = live().filter(p => !p.allin);
  if(can.length <= 1){
    // 全員オールイン：残りを順にめくる
    G.phase = "runout"; render();
    G.timer = setTimeout(endStreet, DELAY[cfg.speed] + 300);
    return;
  }
  G.phase = "play";
  G.toAct = nextActor(G.button);
  schedule();
}
function dealStreet(){
  G.street++;
  const n = G.street === 1 ? 3 : 1;
  for(let i = 0; i < n; i++) G.board.push(G.deck.pop());
  addLog(`${["","フロップ","ターン","リバー"][G.street]}：${G.board.map(cs).join(" ")}`);
}
function winUncontested(){
  const w = live()[0], pot = potTotal();
  w.stack += pot; w.won = pot;
  addLog(`${w.name} が ${fmt(pot)} を獲得（全員フォールド）`);
  G.result = { winners:[w.id], pot, showdown:false };
  finishHand();
}
function showdown(){
  const L = live();
  L.forEach(p => { p.score = evaluate(p.hole.concat(G.board)); p.shown = true; });
  const pots = buildPots();
  const order = G.seats;
  pots.forEach(pt => {
    const el = L.filter(p => pt.elig.includes(p.id));
    const best = Math.max(...el.map(p => p.score));
    const ws = el.filter(p => p.score === best).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const share = Math.floor(pt.amount / ws.length);
    let rem = pt.amount - share * ws.length;
    ws.forEach(w => { const g = share + (rem-- > 0 ? 1 : 0); w.stack += g; w.won += g; });
    addLog(`${pots.length > 1 ? (pt === pots[0] ? "メインポット" : "サイドポット") : "ポット"} ${fmt(pt.amount)} → ${ws.map(w => w.name).join("・")}（${CAT_NAME[catOf(best)]}）`);
  });
  G.result = { winners: L.filter(p => p.won > 0).map(p => p.id), pot: potTotal(), showdown:true };
  finishHand();
}
function buildPots(){
  const P = G.players.filter(p => p.total > 0);
  const levels = [...new Set(P.map(p => p.total))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  levels.forEach(lv => {
    const amount = P.reduce((a, p) => a + Math.min(p.total, lv) - Math.min(p.total, prev), 0);
    const elig = P.filter(p => !p.folded && p.total >= lv).map(p => p.id);
    if(!elig.length && pots.length) pots[pots.length - 1].amount += amount;
    else if(pots.length && pots[pots.length - 1].elig.join() === elig.join()) pots[pots.length - 1].amount += amount;
    else if(elig.length) pots.push({ amount, elig });
    prev = lv;
  });
  return pots;
}
function finishHand(){
  G.phase = "done"; clearTimeout(G.timer); ui.sizing = false;
  stats.hands++;
  try{ G.review = buildReview(); if(G.review.score != null){ stats.scoreSum += G.review.score; stats.scoreN++; } }catch(e){ G.review = null; }
  const me = G.players[0];
  // 脱落
  if(G.tour){
    const busted = G.players.filter(p => !p.out && p.stack === 0);
    const remain = G.players.filter(p => !p.out).length;
    busted.forEach(p => { p.out = true; p.place = remain - busted.length + 1; G.outOrder.push(p.id); addLog(`${p.name} 敗退（${p.place}位）`); });
    if(me.out){ G.over = { place: me.place, win:false }; stats.tours.push(me.place); }
    else if(G.players.filter(p => !p.out).length === 1){ G.over = { place:1, win:true }; stats.tours.push(1); }
  }
  save(LS_STATS, stats);
  render();
}
function nextHand(){
  if(G.over) return;
  const me = G.players[0];
  if(!G.tour && me.stack === 0){
    askConfirm("リバイしますか？", `チップがなくなりました。${fmt(G.startStack)}（${G.startStack / G.bb}BB）を追加して続けます。`, "リバイする", false)
      .then(ok => { if(ok){ me.stack = G.startStack; G.buyin += G.startStack; G.rebuys++; startHand(); } else render(); });
    return;
  }
  startHand();
}

// ---------------------------------------------------------------------
//  進行（CPUは少し待ってから行動）
// ---------------------------------------------------------------------
function schedule(){
  clearTimeout(G.timer);
  const p = G.players[G.toAct];
  if(p && p.cpu){
    render();
    G.timer = setTimeout(() => { const d = cpuDecide(G.toAct); doAction(G.toAct, d.type, d.to); }, DELAY[cfg.speed]);
  }else{
    ui.sizing = false; ui.advice = null;
    render();
  }
}

// ---------------------------------------------------------------------
//  勝率の計算
// ---------------------------------------------------------------------
// 相手はランダムな手札（CPUの判断用・速い）
function equityRandom(hole, board, nOpp, iters){
  const known = new Set(hole.concat(board));
  const deck = ALL.filter(c => !known.has(c));
  let win = 0;
  for(let it = 0; it < iters; it++){
    const d = deck.slice(); let len = d.length;
    const draw = () => { const j = Math.floor(rnd() * len); const c = d[j]; d[j] = d[--len]; return c; };
    const bd = board.slice(); while(bd.length < 5) bd.push(draw());
    const mine = evaluate(hole.concat(bd));
    let best = 0, ties = 1, lose = false;
    for(let o = 0; o < nOpp; o++){
      const v = evaluate([draw(), draw()].concat(bd));
      if(v > mine){ lose = true; break; }
      if(v === mine) ties++;
    }
    if(!lose) win += 1 / ties;
  }
  return win / iters;
}
// 相手のアクションからレンジを推定（あなたへのアドバイス用）
function oppRanges(meSeat){
  return live().filter(p => p.id !== meSeat).map(p => {
    let pct;
    if(p.pfRaises >= 2) pct = 0.05;
    else if(p.pfRaises === 1) pct = G.raiseCount >= 2 ? 0.08 : 0.18;
    else if(p.pfCalls > 0 && !p.limped) pct = 0.30;
    else if(p.limped) pct = 0.55;
    else pct = 1;
    return { thr: thrFor(pct), pct, aggr: p.aggr.slice() };
  });
}
function improves(hole, boardPart){
  const withH = catOf(evaluate(hole.concat(boardPart))), only = catOf(evaluate(boardPart));
  if(withH > only) return true;
  const cnt = [0,0,0,0]; hole.concat(boardPart).forEach(c => cnt[c & 3]++);
  return hole.some(c => cnt[c & 3] >= 4);
}
function equityRange(hole, board, ranges, iters){
  const known = new Set(hole.concat(board));
  const deck = ALL.filter(c => !known.has(c));
  const mark = new Int32Array(64);
  let win = 0;
  for(let it = 1; it <= iters; it++){
    const pick = () => { for(;;){ const c = deck[Math.floor(rnd() * deck.length)]; if(mark[c] !== it){ mark[c] = it; return c; } } };
    const hands = ranges.map(r => {
      for(let t = 0; t < 40; t++){
        const a = pick(), b = pick();
        let ok = chen(a, b) >= r.thr;
        if(ok) for(let s = 1; s <= G.street && s <= 3; s++){
          if(r.aggr[s] && !improves([a, b], board.slice(0, s + 2))){ ok = false; break; }
        }
        if(ok || t === 39) return [a, b];
        mark[a] = 0; mark[b] = 0;
      }
    });
    const bd = board.slice(); while(bd.length < 5) bd.push(pick());
    const mine = evaluate(hole.concat(bd));
    let ties = 1, lose = false;
    for(const h of hands){ const v = evaluate(h.concat(bd)); if(v > mine){ lose = true; break; } if(v === mine) ties++; }
    if(!lose) win += 1 / ties;
  }
  return win / iters;
}

// ---------------------------------------------------------------------
//  CPUの判断
// ---------------------------------------------------------------------
function cpuDecide(seat){
  const p = G.players[seat], st = p.style, toCall = G.currentBet - p.bet, pot = potTotal();
  const bb = G.bb, stackBB = (p.stack + p.bet) / bb;
  const raiseTo = x => ({ type:"raise", to: Math.round(x) });
  const allIn = () => ({ type:"raise", to: p.bet + p.stack });
  const passive = () => toCall === 0 ? { type:"check" } : { type:"fold" };
  if(G.street === 0){
    const ch = chen(p.hole[0], p.hole[1]) + (rnd() - 0.5);
    const pos = posInfo(seat);
    const openTh = [9.5, 8.5, 7.5, 6.5, 5][pos.tier] - (st.vp - 1) * 4;
    if(stackBB <= 12){                                         // ショートスタック：プッシュ or フォールド
      const th = 6 + stackBB * 0.25 + (G.raiseCount ? 2 : 0);
      if(ch >= th) return allIn();
      return toCall === 0 ? { type:"check" } : (toCall <= bb * 0.5 && ch >= 5 ? { type:"call" } : { type:"fold" });
    }
    if(G.raiseCount === 0){
      const limpers = live().filter(q => q.limped).length;
      if(ch >= openTh || (rnd() < st.bl * 0.4 && pos.tier >= 3)) return raiseTo(bb * (2.5 + limpers));
      if(toCall === 0) return { type:"check" };
      if(ch >= openTh - 1.5 && rnd() < 0.15 * st.vp) return { type:"call" };
      return { type:"fold" };
    }
    if(G.raiseCount === 1){
      const tb = 11.5 - (st.ag - 0.5) * 3, cl = 8 - (st.vp - 1) * 4 + (toCall / bb > 5 ? 1 : 0);
      if(ch >= tb || (rnd() < st.bl * 0.5 && ch >= 6)) return raiseTo(G.currentBet * 3);
      if(ch >= cl || (toCall <= bb && ch >= 5)) return { type:"call" };
      return { type:"fold" };
    }
    if(ch >= 13.5) return stackBB < 40 ? allIn() : raiseTo(G.currentBet * 2.3);
    if(ch >= 11) return { type:"call" };
    return { type:"fold" };
  }
  const n = live().length - 1;
  let eq = equityRandom(p.hole, G.board, n, 350);
  eq -= 0.05 * live().filter(q => q !== p && q.aggr[G.street]).length;
  eq += (rnd() - 0.5) * 0.06;
  if(toCall > 0){
    const req = toCall / (pot + toCall);
    if(eq > 0.75 && rnd() < st.ag) return p.stack <= pot ? allIn() : raiseTo(G.currentBet * 2.5);
    if(eq >= req * 1.05 || (rnd() < st.bl * 0.3 && toCall <= pot * 0.3)) return { type:"call" };
    return { type:"fold" };
  }
  if(eq > 0.62 && rnd() < st.ag + 0.2) return raiseTo(pot * (0.55 + rnd() * 0.25));
  if(eq < 0.35 && rnd() < st.bl) return raiseTo(pot * 0.5);
  if(eq > 0.45 && rnd() < st.ag * 0.4) return raiseTo(pot * 0.4);
  return { type:"check" };
}

// ---------------------------------------------------------------------
//  あなたへのアドバイス（GTO的な目安）
// ---------------------------------------------------------------------
function outsInfo(hole, board){
  if(board.length < 3 || board.length > 4) return null;
  const known = new Set(hole.concat(board));
  const cur = evaluate(hole.concat(board)), curCat = catOf(cur);
  let outs = 0;
  ALL.forEach(c => { if(known.has(c)) return;
    const nb = board.concat(c);
    const v = evaluate(hole.concat(nb)), boardOnly = catOf(evaluate(nb));
    if(catOf(v) > curCat && catOf(v) > boardOnly && catOf(v) >= 2) outs++;
  });
  const left = 52 - known.size;
  const next = outs / left;
  const byRiver = board.length === 3 ? 1 - ((left - outs) / left) * ((left - 1 - outs) / (left - 1)) : next;
  return { outs, next, byRiver };
}
function advise(){
  const me = G.players[0];
  const key = `${G.handNo}|${G.street}|${G.actions}`;
  if(cache.adv && cache.adv.key === key) return cache.adv.val;
  const hole = me.hole, board = G.board, bb = G.bb;
  const toCall = Math.min(G.currentBet - me.bet, me.stack), pot = potTotal();
  const ranges = oppRanges(0);
  const eq = equityRange(hole, board, ranges, ranges.length > 3 ? 1500 : 2500);
  const req = toCall > 0 ? toCall / (pot + toCall) : 0;
  const ev = eq * (pot + toCall) - toCall;
  const maxTo = me.bet + me.stack, minTo = Math.min(G.currentBet + G.minRaise, maxTo);
  const clamp = x => Math.min(maxTo, Math.max(minTo, Math.round(x / 5) * 5));
  const R = (type, label, to, reason) => ({ type, label, to: to != null ? clamp(to) : null, reason });
  let rec;
  const stackBB = (me.stack + me.bet) / bb;
  const outs = outsInfo(hole, board);
  if(G.street === 0){
    const info = handInfo(cs(hole[0]), cs(hole[1])), pos = posInfo(0), ch = chen(hole[0], hole[1]);
    const limpers = live().filter(q => q.limped && q.id !== 0).length;
    if(stackBB <= 15 && G.tour){
      const th = 6 + stackBB * 0.25 + (G.raiseCount ? 2 : 0);
      rec = ch >= th ? R("raise", "オールイン", maxTo, `残り${stackBB.toFixed(1)}BBのショートスタック。プッシュ／フォールドで戦う局面で、この手札はオールインできる強さです`)
                     : toCall === 0 ? R("check", "チェック", null, "ショートスタックで手札が弱いので、無料で見られるならチェック")
                     : R("fold", "フォールド", null, `ショートスタックでは弱い手札でチップを使わず、強い手札でのオールインを待ちます`);
    }else if(G.raiseCount === 0){
      if(info.tier <= pos.tier) rec = R("raise", `レイズ ${fmt((2.5 + limpers) * bb)}`, (2.5 + limpers) * bb,
          `${info.name} は ${pos.name} からオープンできる範囲（チャートの${TIER_LABEL[info.tier]}）。${limpers ? `リンパーが${limpers}人いるので1人につき1BB足します` : "2.5BBでオープン"}`);
      else if(toCall === 0) rec = R("check", "チェック", null, "BBで誰もレイズしていないので、無料でフロップを見ます");
      else rec = R("fold", "フォールド", null, `${info.name} は ${pos.name} のオープン範囲外です`);
    }else if(G.raiseCount === 1){
      const strong = ch >= 12;
      if(strong || eq >= 0.58) rec = R("raise", `3ベット ${fmt(G.currentBet * 3)}`, G.currentBet * 3, `レイズした相手の推定レンジ（上位約18%）に対しても勝率${pctS(eq,0)}と十分高いので、3ベットで価値を取ります`);
      else if(eq >= req - (info.pair || info.suited ? 0.04 : 0)) rec = R("call", `コール ${fmt(toCall)}`, null, `必要勝率${pctS(req,0)}に対して勝率${pctS(eq,0)}。${info.pair || info.suited ? "ペア・スーテッドはフロップで強くなった時に大きく勝てる（インプライドオッズ）ので" : ""}コールが目安`);
      else rec = R("fold", "フォールド", null, `必要勝率${pctS(req,0)}に対して勝率${pctS(eq,0)}で足りません`);
    }else{
      const premium = ch >= 14 || (hole.some(c => c >> 2 === 14) && hole.some(c => c >> 2 === 13));
      if(premium) rec = R("raise", stackBB < 40 ? "オールイン" : `4ベット ${fmt(G.currentBet * 2.3)}`, stackBB < 40 ? maxTo : G.currentBet * 2.3, "QQ以上・AKは3ベットに対しても押し返せる強さです");
      else if(eq >= req) rec = R("call", `コール ${fmt(toCall)}`, null, `相手のレンジはかなり強い（上位約8%）ですが、勝率${pctS(eq,0)}が必要勝率${pctS(req,0)}を上回ります`);
      else rec = R("fold", "フォールド", null, `3ベット以上の強いレンジに対して勝率${pctS(eq,0)}では足りません`);
    }
  }else{
    const draw = outs && outs.outs >= 8 && board.length < 5;
    if(toCall > 0){
      if(eq >= 0.72 && me.stack > toCall) rec = R("raise", `レイズ ${fmt(G.currentBet * 2.5)}`, G.currentBet * 2.5, `勝率${pctS(eq,0)}とかなり有利。レイズして価値を最大化します`);
      else if(eq >= req) rec = R("call", `コール ${fmt(toCall)}`, null, `必要勝率${pctS(req,0)} ≦ 勝率${pctS(eq,0)}。コールの期待値はプラス（約${ev >= 0 ? "+" : ""}${fmt(ev)}）`);
      else if(draw && eq + 0.06 >= req && me.stack > pot) rec = R("call", `コール ${fmt(toCall)}`, null, `今の勝率${pctS(eq,0)}は必要勝率${pctS(req,0)}に少し届きませんが、アウツ${outs.outs}枚のドローで、完成すれば大きく勝てる（インプライドオッズ）のでコール可`);
      else rec = R("fold", "フォールド", null, `必要勝率${pctS(req,0)}に対して勝率${pctS(eq,0)}。コールの期待値はマイナス（約${fmt(ev)}）`);
    }else{
      if(eq >= 0.65) rec = R("raise", `ベット ${fmt(pot * 0.66)}（2/3ポット）`, pot * 0.66, `勝率${pctS(eq,0)}と有利。弱い手札からもコールをもらえるサイズでバリューベット`);
      else if(eq >= 0.52) rec = R("raise", `ベット ${fmt(pot * 0.33)}（1/3ポット）`, pot * 0.33, `勝率${pctS(eq,0)}でやや有利。小さめのベットで薄く価値を取ります（チェックも可）`);
      else if(draw) rec = R("raise", `ベット ${fmt(pot * 0.5)}（セミブラフ）`, pot * 0.5, `今は弱いですが、アウツ${outs.outs}枚のドロー。相手が降りれば勝ち、コールされても完成の可能性があります`);
      else rec = R("check", "チェック", null, `勝率${pctS(eq,0)}。無理に大きくせず、安く次のカードを見ます`);
    }
  }
  const val = { eq, req, ev, toCall, pot, rec, outs, ranges };
  cache.adv = { key, val };
  return val;
}

// ---------------------------------------------------------------------
//  相手の役の確率（相手1人・ランダムな手札の場合）と、自分がリバーまでに作れる役
// ---------------------------------------------------------------------
function probTable(){
  const me = G.players[0];
  const key = `${G.handNo}|${G.board.length}`;
  if(cache.prob && cache.prob.key === key) return cache.prob.val;
  const hole = me.hole, board = G.board;
  const known = new Set(hole.concat(board));
  const deck = ALL.filter(c => !known.has(c));
  const oppNow = new Array(9).fill(0), oppRiver = new Array(9).fill(0), meRiver = new Array(9).fill(0);
  const myNow = evaluate(hole.concat(board));
  let combos = 0, beat = 0;
  for(let i = 0; i < deck.length; i++) for(let j = i + 1; j < deck.length; j++){
    const v = evaluate([deck[i], deck[j]].concat(board));
    oppNow[catOf(v)]++; combos++;
    if(board.length >= 3 && v > myNow) beat++;
  }
  // リバーまで（相手）
  const it = 5000;
  for(let k = 0; k < it; k++){
    const d = deck.slice(); let len = d.length;
    const draw = () => { const j = Math.floor(rnd() * len); const c = d[j]; d[j] = d[--len]; return c; };
    const o = [draw(), draw()], bd = board.slice(); while(bd.length < 5) bd.push(draw());
    oppRiver[catOf(evaluate(o.concat(bd)))]++;
  }
  // リバーまで（自分）
  let meN = 0;
  if(board.length === 5){ meRiver[catOf(myNow)] = 1; meN = 1; }
  else if(board.length === 4){ deck.forEach(c => { meRiver[catOf(evaluate(hole.concat(board, c)))]++; meN++; }); }
  else if(board.length === 3){ for(let i = 0; i < deck.length; i++) for(let j = i + 1; j < deck.length; j++){ meRiver[catOf(evaluate(hole.concat(board, deck[i], deck[j])))]++; meN++; } }
  else{
    for(let k = 0; k < it; k++){
      const d = deck.slice(); let len = d.length;
      const draw = () => { const j = Math.floor(rnd() * len); const c = d[j]; d[j] = d[--len]; return c; };
      const bd = []; while(bd.length < 5) bd.push(draw());
      meRiver[catOf(evaluate(hole.concat(bd)))]++; meN++;
    }
  }
  const val = { oppNow: oppNow.map(v => v / combos), oppRiver: oppRiver.map(v => v / it), meRiver: meRiver.map(v => v / meN),
                myCat: catOf(myNow), beat: board.length >= 3 ? beat / combos : null };
  cache.prob = { key, val };
  return val;
}

// ---------------------------------------------------------------------
//  ハンドの振り返り（GTO的な評価）
// ---------------------------------------------------------------------
// 実際の相手の手札に対する勝率（結果論の勝率）
function actualEquity(hole, board, opps){
  if(!opps.length) return 1;
  const known = new Set(hole.concat(board, ...opps));
  const deck = ALL.filter(c => !known.has(c));
  const need = 5 - board.length;
  let win = 0, n = 0;
  const score = bd => {
    const mine = evaluate(hole.concat(bd));
    let ties = 1;
    for(const o of opps){ const v = evaluate(o.concat(bd)); if(v > mine) return 0; if(v === mine) ties++; }
    return 1 / ties;
  };
  if(need === 0){ return score(board); }
  if(need === 1){ deck.forEach(c => { win += score(board.concat(c)); n++; }); return win / n; }
  if(need === 2){ for(let i = 0; i < deck.length; i++) for(let j = i + 1; j < deck.length; j++){ win += score(board.concat(deck[i], deck[j])); n++; } return win / n; }
  for(let k = 0; k < 3000; k++){
    const d = deck.slice(); let len = d.length;
    const bd = board.slice(); while(bd.length < 5){ const j = Math.floor(rnd() * len); bd.push(d[j]); d[j] = d[--len]; }
    win += score(bd); n++;
  }
  return win / n;
}
const ACT_NAME = { fold:"フォールド", check:"チェック", call:"コール", raise:"ベット／レイズ" };
const STREET = ["プリフロップ","フロップ","ターン","リバー"];
function judge(d){
  const bbv = v => (v / d.bb).toFixed(1) + "BB";
  const rt = d.rec.type === "check" ? (d.toCall > 0 ? "call" : "check") : d.rec.type;
  const my = d.type, cls = t => t === "check" || t === "call" ? "pass" : t;
  const margin = d.toCall > 0 ? d.eq - d.req : d.eq - 0.5;      // 判断のしきい値からの距離
  const close = Math.abs(margin) < 0.05;
  let grade, title, why;
  if(cls(my) === cls(rt)){
    grade = 3; title = "良い判断";
    why = d.rec.reason;
    if(my === "raise" && d.rec.to && d.amount){
      const ratio = d.amount / d.rec.to;
      if(ratio > 1.8 || ratio < 0.5){ grade = 2; title = "方向は正解・サイズに改善点"; why = `アクションはおすすめどおり。ただし金額 ${fmt(d.amount)} は目安 ${fmt(d.rec.to)} から離れています。${ratio > 1 ? "大きすぎると、弱い手札が降りて強い手札だけが残ります" : "小さすぎると、相手に安くドローを引かせてしまいます"}`; }
    }
  }else if(d.street === 0 && (d.ev >= 0) === (rt === "fold")){
    // プリフロップでチャート（ポジション）を根拠にした判断：数字より範囲が優先
    grade = rt === "fold" ? 1 : 1; title = my === "fold" ? "降りすぎ" : my === "raise" ? "攻めすぎ" : "参加しすぎ";
    if(my === "call" && rt === "fold" && d.toCall <= d.bb) title = "リンプ（コールで参加）";
    why = `おすすめは「${d.rec.label}」。${d.rec.reason}。${my === "call" && rt === "fold" ? "勝率の数字は足りていても、後ろのポジションで不利に戦うことになるので、オープン範囲外の手札はレイズで参加しないなら降りるのが基本です" : ""}`;
    if(my === "fold" && rt === "raise") why = `おすすめは「${d.rec.label}」。${d.rec.reason}`;
  }else if(my === "fold"){
    // 降りすぎ
    const lost = Math.max(0, d.ev);
    grade = close ? 2 : 0; title = close ? "ギリギリの判断（降りすぎ気味）" : "降りすぎ";
    why = `勝率${pctS(d.eq,0)}は必要勝率${pctS(d.req,0)}を上回っていました。コールの期待値は約+${fmt(lost)}（${bbv(lost)}）で、フォールドでその分を手放しています`;
    if(rt === "raise") why = `勝率${pctS(d.eq,0)}と有利な場面でした。${d.rec.label}が目安です`;
  }else if(my === "call" && rt === "fold"){
    const lost = Math.max(0, -d.ev);
    grade = close ? 2 : 0; title = close ? "ギリギリの判断（コールしすぎ気味）" : "コールしすぎ";
    why = `必要勝率${pctS(d.req,0)}に対して勝率${pctS(d.eq,0)}。このコールの期待値は約−${fmt(lost)}（${bbv(lost)}）です`;
    if(d.outs && d.outs.outs >= 8) why += `。アウツ${d.outs.outs}枚のドローなので、相手から後で大きく取れるならギリギリ許容範囲`;
  }else if(my === "raise" && (rt === "fold" || rt === "check" || rt === "call")){
    grade = d.eq >= 0.45 || close ? 2 : 1; title = d.eq >= 0.45 ? "攻めすぎ（悪くはない）" : "攻めすぎ";
    why = `勝率${pctS(d.eq,0)}で、目安は「${d.rec.label}」。${d.eq < 0.35 ? "ブラフとして使うなら、相手が降りやすいボードかどうか・アウツがあるかを意識しましょう" : "強さが中くらいの手札で大きくすると、強い手札にだけコールされがちです"}`;
  }else if((my === "call" || my === "check") && rt === "raise"){
    grade = 2; title = "消極的";
    why = `勝率${pctS(d.eq,0)}と有利でした。「${d.rec.label}」でもっと価値を取れた場面です`;
  }else{
    grade = 2; title = "まずまず"; why = d.rec.reason;
  }
  return { grade, title, why };
}
function buildReview(){
  const me = G.players[0];
  const items = G.decisions.map(d => {
    const opps = d.liveIds.map(id => G.players[id].hole);
    const actual = actualEquity(me.hole, d.board, opps);
    return Object.assign({}, d, judge(d), { actual });
  });
  const net = me.stack - G.stack0;
  const score = items.length ? Math.round(items.reduce((a, x) => a + x.grade, 0) / (items.length * 3) * 100) : null;
  // 判断と結果のズレ（運の要素）
  let luck = "";
  const allin = items.filter(x => x.type !== "fold").slice(-1)[0];
  if(score != null && allin){
    if(net < 0 && score >= 80 && allin.actual >= 0.55) luck = `判断は良好でしたが、実際の手札に対して勝率${pctS(allin.actual,0)}あった勝負で負けました。結果は運の範囲（バッドビート）です。同じ判断を続ければ長期的にはプラスになります`;
    else if(net > 0 && score < 60 && allin.actual < 0.45) luck = `結果は勝ちですが、実際の勝率は${pctS(allin.actual,0)}でした。今回はラッキー寄りなので、判断の改善点を確認しておきましょう`;
    else if(net > 0 && score >= 80) luck = "判断も結果も良好なハンドでした";
  }
  // 相手の手札
  const opp = G.players.filter(p => p.id !== 0 && !p.out && p.hole.length).map(p => ({
    name:p.name, hole:p.hole, folded:p.folded, cat: G.board.length >= 3 ? CAT_NAME[catOf(evaluate(p.hole.concat(G.board)))] : "", won:p.won }));
  const best = items.filter(x => x.grade === 0)[0] || items.filter(x => x.grade === 1)[0];
  const lesson = best ? `${STREET[best.street]}の${ACT_NAME[best.type]}：${best.title}` : items.length ? "大きなミスはありませんでした" : "";
  return { items, net, score, luck, opp, lesson };
}
function reviewHTML(){
  const R = G.review;
  if(!R) return "";
  const me = G.players[0];
  const gradeName = s => s >= 85 ? "S" : s >= 70 ? "A" : s >= 50 ? "B" : s >= 30 ? "C" : "D";
  const gcls = g => g === 3 ? "g3" : g === 2 ? "g2" : g === 1 ? "g1" : "g0";
  const head = `<div class="rv-top">
      <div class="rv-score ${R.score == null ? "" : R.score >= 70 ? "hi" : R.score >= 50 ? "mid" : "lo"}">${R.score == null ? "—" : gradeName(R.score)}<small>${R.score == null ? "判断なし" : `判断スコア ${R.score}`}</small></div>
      <div class="rv-sum"><div>このハンドの収支</div><b class="${R.net > 0 ? "plus" : R.net < 0 ? "minus" : ""}">${signed(R.net)}</b><span>${(R.net / G.bb >= 0 ? "+" : "") + (R.net / G.bb).toFixed(1)}BB</span></div>
    </div>`;
  const items = R.items.map(x => `<div class="rv-it">
      <div class="rv-h"><span class="rv-st">${STREET[x.street]}</span>${x.board.length ? `<div class="cards">${x.board.map(c => card(cs(c), "sm")).join("")}</div>` : `<span class="sub">${x.pos}</span>`}<span class="sp"></span><span class="rv-g ${gcls(x.grade)}">${x.title}</span></div>
      <div class="rv-row"><span>あなた</span><b>${ACT_NAME[x.type]}${x.amount && x.type === "raise" ? ` ${fmt(x.amount)}` : x.type === "call" ? ` ${fmt(x.amount)}` : ""}</b>
        <span>おすすめ</span><b>${esc(x.rec.label)}</b></div>
      <div class="rv-nums">
        <div><span>ポット</span><b>${fmt(x.pot)}</b></div>
        <div><span>推定勝率</span><b>${pctS(x.eq,0)}</b></div>
        <div><span>必要勝率</span><b>${x.toCall ? pctS(x.req,0) : "—"}</b></div>
        <div><span>実際の勝率</span><b>${pctS(x.actual,0)}</b></div>
      </div>
      <p class="rv-why">${x.why}</p>
    </div>`).join("");
  const opps = R.opp.map(o => `<div class="lg-p ${o.folded ? "f" : ""}"><span class="n">${esc(o.name)}${o.won > 0 ? ` <b class="plus">+${fmt(o.won)}</b>` : ""}</span><div class="cards">${o.hole.map(c => card(cs(c), "sm")).join("")}</div></div>`).join("");
  return `<div class="panel rv">
    <div class="ptitle">振り返り<span class="sp"></span><button class="btn sm" onclick="Practice.toggleReview()">${ui.review ? "閉じる" : "開く"}</button></div>
    ${head}
    ${ui.review ? `
      ${R.luck ? `<p class="rv-luck">${R.luck}</p>` : ""}
      ${R.lesson ? `<p class="sub" style="margin:8px 0 4px">このハンドのポイント：<b style="color:var(--text)">${esc(R.lesson)}</b></p>` : ""}
      ${items || `<p class="muted" style="margin-top:8px">このハンドではあなたの判断はありませんでした</p>`}
      <div class="ptitle" style="margin-top:12px">相手の手札<span class="sp"></span><small>薄い＝降りた人</small></div>
      <div class="lg-rows">${opps}</div>
      <p class="sub" style="margin-top:10px">推定勝率＝その時点で分かっていた情報（相手のアクションから推定したレンジ）での勝率。実際の勝率＝相手の本当の手札に対する勝率（結果論）。判断の評価は推定勝率で行います</p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------
//  あなたの操作
// ---------------------------------------------------------------------
function human(type, to){
  const me = G.players[0];
  if(G.phase !== "play" || G.toAct !== 0) return;
  const a = advise();
  const norm = t => t === "check" || t === "call" ? "pass" : t;
  const realType = type === "check" && me.bet < G.currentBet ? "call" : type;
  const ok = norm(a.rec.type) === norm(realType);
  stats.decisions++; if(ok) stats.agree++;
  if(cfg.advice) addLog(`（アドバイス：${a.rec.label}　→ あなた：${ok ? "一致" : "不一致"}）`);
  save(LS_STATS, stats);
  // 振り返り用に、その時点の状況を記録
  const toCall = Math.min(G.currentBet - me.bet, me.stack);
  const amt = realType === "raise" ? Math.min(to, me.bet + me.stack) : realType === "call" ? toCall : 0;
  G.decisions.push({ street:G.street, board:G.board.slice(), pot:a.pot, toCall:a.toCall, eq:a.eq, req:a.req, ev:a.ev,
    rec:a.rec, type:realType, amount:amt, pos:posInfo(0).name, liveIds: live().filter(p => p.id !== 0).map(p => p.id),
    outs:a.outs, stack:me.stack + me.bet, bet:me.bet, currentBet:G.currentBet, bb:G.bb });
  ui.sizing = false;
  doAction(0, type, to);
}
function openSizing(){
  const me = G.players[0], pot = potTotal();
  const minTo = Math.min(G.currentBet + G.minRaise, me.bet + me.stack);
  const a = cfg.advice ? advise() : null;
  ui.raiseTo = a && a.rec.type === "raise" && a.rec.to ? a.rec.to : (G.currentBet === 0 ? Math.max(minTo, Math.round(pot * 0.5 / 5) * 5) : minTo);
  ui.sizing = true; render();
}
function setRaise(v){
  const me = G.players[0];
  const minTo = Math.min(G.currentBet + G.minRaise, me.bet + me.stack), maxTo = me.bet + me.stack;
  ui.raiseTo = Math.min(maxTo, Math.max(minTo, Math.round(v)));
  const el = document.getElementById("prAmt"); if(el) el.textContent = fmt(ui.raiseTo);
  const sl = document.getElementById("prSl"); if(sl && +sl.value !== ui.raiseTo) sl.value = ui.raiseTo;
}

// ---------------------------------------------------------------------
//  画面
// ---------------------------------------------------------------------
function css(){
  if(document.getElementById("prCss")) return;
  const st = document.createElement("style"); st.id = "prCss";
  st.textContent = `
  .pr-hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .pr-hd .t{flex:1;min-width:0}
  .pr-hd .t b{display:block;font-size:16px}
  .pr-hd .t span{font-size:12px;color:var(--sub)}
  .pr-seg{display:flex;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:3px;gap:3px}
  .pr-seg button{flex:1;padding:10px 6px;border-radius:9px;font-weight:800;font-size:14px;color:var(--sub)}
  .pr-seg button.on{background:var(--text);color:#0b1015}
  .pr-lbl{font-size:13px;font-weight:800;margin:14px 0 6px}
  .pr-opps{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
  .pr-seat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 9px;min-width:0;position:relative}
  .pr-seat.turn{border-color:#22e4ff;box-shadow:0 0 0 1px #22e4ff,0 0 14px rgba(34,228,255,.35)}
  .pr-seat.fold{opacity:.42}
  .pr-seat.win{border-color:var(--warn);box-shadow:0 0 0 1px var(--warn)}
  .pr-seat .r1{display:flex;align-items:center;gap:6px}
  .pr-seat .nm{font-weight:800;font-size:14px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pr-pos{font-size:10px;font-weight:900;border-radius:4px;padding:1px 5px;background:#26313d;color:var(--sub)}
  .pr-pos.btn{background:#f2f2f2;color:#111}
  .pr-seat .r2{display:flex;align-items:center;gap:6px;margin-top:5px}
  .pr-seat .stk{font-size:13px;font-weight:800;flex:1;font-variant-numeric:tabular-nums}
  .pr-seat .act{font-size:11px;color:var(--sub);margin-top:3px;min-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pr-seat .act b{color:#7ff0ff}
  .pr-mid{background:radial-gradient(120% 120% at 50% 0%,#15402c,#0d2a1d);border:1px solid #1f5a3d;border-radius:16px;padding:12px;margin-bottom:10px;text-align:center}
  .pr-mid .pot{font-size:13px;color:#bfe8d1;margin-bottom:8px}
  .pr-mid .pot b{font-size:20px;color:#fff;margin-left:4px}
  .pr-mid .bd{display:flex;justify-content:center;gap:6px;min-height:62px}
  .pr-me{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:10px}
  .pr-me.turn{border-color:#22e4ff;box-shadow:0 0 0 1px #22e4ff}
  .pr-me .row1{display:flex;align-items:center;gap:12px}
  .pr-me .info{flex:1;min-width:0}
  .pr-me .info b{font-size:22px;font-variant-numeric:tabular-nums}
  .pr-me .info div{font-size:12px;color:var(--sub);margin-top:2px}
  .pr-adv .big{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
  .pr-adv .big div{background:var(--panel2);border-radius:10px;padding:8px 4px;text-align:center}
  .pr-adv .big span{display:block;font-size:11px;color:var(--sub)}
  .pr-adv .big b{font-size:19px;font-variant-numeric:tabular-nums}
  .pr-rec{border-radius:12px;padding:10px 12px;background:linear-gradient(#141c24,#141c24) padding-box,linear-gradient(90deg,#ff2d95,#a64dff,#22e4ff) border-box;border:2px solid transparent}
  .pr-rec .h{font-size:11px;color:#cdb8ff;font-weight:800}
  .pr-rec .a{font-size:18px;font-weight:900;margin:2px 0 4px}
  .pr-rec .w{font-size:12px;color:var(--sub);line-height:1.6}
  .pr-pt{width:100%;border-collapse:collapse;font-size:12px}
  .pr-pt th{font-size:10px;color:var(--sub);font-weight:700;text-align:right;padding:4px 3px;line-height:1.3}
  .pr-pt th:first-child{text-align:left}
  .pr-pt td{padding:6px 3px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid var(--line);white-space:nowrap}
  .pr-pt td:first-child{text-align:left;font-weight:700;font-size:11.5px;letter-spacing:-.02em}
  .pr-pt tr.mine td{background:rgba(34,195,122,.12)}
  .pr-pt td.z{color:#4a5866}
  .pr-bar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(11,16,21,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);
    padding:10px 12px calc(env(safe-area-inset-bottom) + 10px)}
  .pr-bar .in{max-width:560px;margin:0 auto}
  .pr-bar .row{gap:8px}
  .pr-bar .btn{padding:14px 6px;font-size:16px}
  .pr-wait{text-align:center;color:var(--sub);font-size:14px;padding:6px 0}
  .pr-size .pre{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
  .pr-size .pre button{flex:1;min-width:0;padding:9px 2px;border-radius:9px;background:var(--panel2);border:1px solid var(--line);font-weight:800;font-size:12px;white-space:nowrap}
  .pr-size .pre{flex-wrap:nowrap}
  .pr-size input[type=range]{width:100%;margin:6px 0 10px;accent-color:#22c37a;height:28px}
  .pr-size .amt{text-align:center;font-size:24px;font-weight:900;font-variant-numeric:tabular-nums}
  .pr-log{font-size:12px;color:var(--sub);line-height:1.8;max-height:260px;overflow:auto}
  .pr-res{text-align:center;font-weight:800;margin-bottom:8px}
  .pr-over{text-align:center;padding:18px 8px}
  .pr-over b{font-size:34px;display:block;margin:6px 0}
  .pr-sw{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-weight:700;font-size:14px}
  .pr-sw:first-child{border-top:none}
  .pr-sw span{flex:1}
  .pr-sw input{width:22px;height:22px;accent-color:#22c37a}
  .rv-top{display:flex;gap:10px;align-items:stretch}
  .rv-score{width:96px;border-radius:12px;background:var(--panel2);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:34px;font-weight:900;line-height:1;padding:10px 0}
  .rv-score small{font-size:10px;font-weight:700;color:var(--sub);margin-top:6px}
  .rv-score.hi{color:#7ff0ff;box-shadow:inset 0 0 0 1px #22e4ff}
  .rv-score.mid{color:var(--warn)}
  .rv-score.lo{color:var(--bad)}
  .rv-sum{flex:1;border-radius:12px;background:var(--panel2);padding:10px 12px;display:flex;flex-direction:column;justify-content:center}
  .rv-sum div{font-size:11px;color:var(--sub)}
  .rv-sum b{font-size:24px;font-variant-numeric:tabular-nums}
  .rv-sum span{font-size:12px;color:var(--sub)}
  .rv-luck{margin-top:10px;font-size:12px;line-height:1.7;background:#1d1533;border:1px solid #4a3480;color:#d9c8ff;border-radius:10px;padding:8px 10px}
  .rv-it{border-top:1px solid var(--line);padding:10px 0}
  .rv-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .rv-h .sp{flex:1}
  .rv-st{font-weight:900;font-size:14px}
  .rv-g{font-size:11px;font-weight:900;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .rv-g.g3{background:#0f3a28;color:#3ddc97}
  .rv-g.g2{background:#3a2c0f;color:var(--warn)}
  .rv-g.g1{background:#3a2412;color:#ff9b54}
  .rv-g.g0{background:#3a1820;color:#ff8a99}
  .rv-row{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px 8px;align-items:baseline;font-size:13px;margin-bottom:8px}
  .rv-row span{font-size:11px;color:var(--sub)}
  .rv-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:8px}
  .rv-nums div{background:var(--panel2);border-radius:8px;padding:6px 2px;text-align:center}
  .rv-nums span{display:block;font-size:10px;color:var(--sub)}
  .rv-nums b{font-size:14px;font-variant-numeric:tabular-nums}
  .rv-why{font-size:12px;color:var(--sub);line-height:1.7}
  .rg{position:relative;width:100%;aspect-ratio:1/1.02;max-height:470px;margin:6px 0 10px}
  .rg-felt{position:absolute;left:13%;right:13%;top:15%;bottom:15%;border-radius:50%;
    background:radial-gradient(110% 90% at 50% 30%,#1b5a3d,#0e3323 70%,#0a2619);border:6px solid #3a2416;
    box-shadow:0 0 0 2px #5b3b24,inset 0 0 30px rgba(0,0,0,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
  .rg-pot{font-size:11px;color:#bfe8d1}
  .rg-pot b{font-size:16px;color:#fff;margin-left:2px;font-variant-numeric:tabular-nums}
  .rg-bd{display:flex;gap:3px}
  .rg-st{font-size:10px;color:#8fc9a9;font-weight:700;letter-spacing:.08em}
  .card.bd{width:31px;height:44px;font-size:15px;border-radius:5px}
  .card.bd i{font-size:15px;margin-top:1px}
  .card.bd.empty{border:1.5px dashed rgba(255,255,255,.22)}
  .card.xs{width:20px;height:28px;font-size:11px;border-radius:4px}
  .card.xs i{font-size:11px;margin-top:0}
  .rg-seat{position:absolute;transform:translate(-50%,-50%);width:84px;background:rgba(20,28,36,.94);border:1px solid var(--line);border-radius:12px;
    padding:5px 5px 4px;text-align:center;z-index:2}
  .rg-seat .cards{gap:2px;margin-bottom:3px}
  .rg-seat .nm{font-size:11.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;justify-content:center;gap:3px}
  .rg-seat .nm .pr-pos{font-size:9px;padding:0 3px}
  .rg-seat .stk{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
  .rg-seat .act{font-size:10px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:12px}
  .rg-seat .act b{color:#7ff0ff}
  .rg-seat.turn{border-color:#22e4ff;box-shadow:0 0 0 1px #22e4ff,0 0 14px rgba(34,228,255,.45)}
  .rg-seat.fold{opacity:.42}
  .rg-seat.win{border-color:var(--warn);box-shadow:0 0 0 1px var(--warn),0 0 14px rgba(255,176,32,.35)}
  .rg-seat.out{opacity:.25}
  .rg-seat.me{background:#10261c;border-color:#22c37a}
  .rg-bet{position:absolute;transform:translate(-50%,-50%);z-index:1;font-size:10.5px;font-weight:800;color:#fff;background:rgba(0,0,0,.55);
    border-radius:999px;padding:2px 7px 2px 4px;display:flex;align-items:center;gap:4px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .rg-bet i{width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#fff 28%,#e0283c 30% 62%,#fff 64%);display:inline-block}
  .rg-dealer{position:absolute;transform:translate(-50%,-50%);z-index:1;width:18px;height:18px;border-radius:50%;background:#f2f2f2;color:#111;
    font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.6)}
  .pr-tag{display:inline-block;font-size:10px;font-weight:800;border-radius:4px;padding:1px 5px;background:#26313d;color:var(--sub);margin-left:4px;vertical-align:1px}
  `;
  document.head.appendChild(st);
}

function render(){
  css();
  const app = document.getElementById("app");
  document.body.classList.remove("spectating");
  app.innerHTML = page === "setup" ? setupHTML() : tableHTML();
}

// ----- 設定画面 -----
function setupHTML(){
  const seg = (key, opts) => `<div class="pr-seg">${opts.map(([v, l]) =>
    `<button class="${cfg[key] === v ? "on" : ""}" onclick="Practice.set('${key}',${typeof v === "number" ? v : `'${v}'`})">${l}</button>`).join("")}</div>`;
  const agree = stats.decisions ? pctS(stats.agree / stats.decisions, 0) : "—";
  const best = stats.tours.length ? Math.min(...stats.tours) + "位" : "—";
  return `<div class="pr-hd"><div class="t"><b>1人で練習</b><span>CPUと対戦しながら、確率とアクションの目安を学べます</span></div>
      <button class="btn sm" onclick="Practice.exit()">戻る</button></div>
    <div class="panel">
      <div class="pr-lbl" style="margin-top:0">形式</div>
      ${seg("format", [["ring","リング"],["tour","トーナメント"]])}
      <p class="sub" style="margin-top:6px">${cfg.format === "ring"
        ? `ブラインド ${RING_BLINDS[0]}/${RING_BLINDS[1]} 固定・持ち点 ${fmt(RING_STACK)}（100BB）。なくなったらリバイできます`
        : `持ち点 ${fmt(TOUR_STACK)}・${HANDS_PER_LEVEL}ハンドごとにブラインドが上がります。最後の1人になるまで`}</p>
      <div class="pr-lbl">相手（CPU）の人数</div>
      ${seg("opp", [1,2,3,4,5,6,7,8].map(n => [n, String(n)]))}
      <p class="sub" style="margin-top:6px">${cfg.opp === 1 ? "ヘッズアップ（1対1）" : `${cfg.opp + 1}人テーブル`}</p>
      <div class="pr-lbl">アンティ</div>
      ${seg("ante", [["none","なし"],["all","全員"],["bb","BBアンティ"]])}
      <p class="sub" style="margin-top:6px">${cfg.ante === "none" ? "ブラインドだけ" : cfg.ante === "all" ? "全員が毎ハンド、BBの約1/8を出します" : "BBの人が全員分として1BBを出します（最近のトーナメントで主流）"}</p>
      <div class="pr-lbl">CPUの速さ</div>
      ${seg("speed", [["slow","ゆっくり"],["normal","ふつう"],["fast","速い"]])}
    </div>
    <div class="panel">
      <label class="pr-sw"><span>おすすめアクション・勝率を表示</span><input type="checkbox" ${cfg.advice ? "checked" : ""} onchange="Practice.set('advice',this.checked)"></label>
      <label class="pr-sw"><span>役の確率表を表示</span><input type="checkbox" ${cfg.prob ? "checked" : ""} onchange="Practice.set('prob',this.checked)"></label>
      <label class="pr-sw"><span>プリフロップ表を表示</span><input type="checkbox" ${cfg.chart ? "checked" : ""} onchange="Practice.set('chart',this.checked)"></label>
    </div>
    <button class="btn primary big" style="margin-bottom:12px" onclick="Practice.start()">スタート</button>
    <div class="panel">
      <div class="ptitle">これまでの練習</div>
      <div class="kv">
        <div><span>プレイしたハンド</span><b>${fmt(stats.hands)}</b></div>
        <div><span>アドバイスとの一致率</span><b>${agree}</b></div>
        <div><span>トーナメント参加</span><b>${stats.tours.length}回</b></div>
        <div><span>トーナメント最高</span><b>${best}</b></div>
        <div><span>判断スコア平均</span><b>${stats.scoreN ? Math.round(stats.scoreSum / stats.scoreN) : "—"}</b></div>
        <div><span>振り返ったハンド</span><b>${fmt(stats.scoreN || 0)}</b></div>
      </div>
      <p class="sub" style="margin-top:10px">アドバイスは、GTOソルバーではなく「勝率・必要勝率・相手のアクションから推定したレンジ」をもとにした目安です</p>
    </div>`;
}

// ----- テーブル画面 -----
function tableHTML(){
  const P = G.players, me = P[0];
  const myTurn = G.phase === "play" && G.toAct === 0;
  const head = G.tour
    ? `トーナメント Lv${G.level + 1}・残り${P.filter(p => !p.out).length}人`
    : `リング・収支 ${signed(me.stack + (G.phase !== "done" ? me.total : 0) - G.buyin)}`;
  const sub = `${fmt(G.sb)}/${fmt(G.bb)}${G.ante ? `・アンティ${fmt(G.ante)}` : ""}・ハンド#${G.handNo}${G.tour ? `・次のレベルまで${HANDS_PER_LEVEL - ((G.handNo - 1) % HANDS_PER_LEVEL)}` : ""}`;
  let h = `<div class="pr-hd"><div class="t"><b>${head}</b><span>${sub}</span></div>
      <button class="btn sm" onclick="Practice.quit()">終了</button></div>`;
  if(G.over) return h + overHTML() + reviewHTML();
  // 相手
  h += ringHTML();
  // 自分
  const pos = posInfo(0);
  const myCat = me.hole.length ? CAT_NAME[catOf(evaluate(me.hole.concat(G.board)))] : "";
  const won = G.phase === "done" && me.won > 0;
  h += `<div class="pr-me ${myTurn ? "turn" : ""} ${won ? "win" : ""}">
    <div class="row1"><div class="cards lg">${me.hole.map(c => card(cs(c), "lg")).join("")}</div>
      <div class="info"><span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span>
        <div style="margin-top:4px"><b>${fmt(me.stack)}</b></div>
        <div>${(me.stack / G.bb).toFixed(1)}BB${me.bet ? `・ベット中 ${fmt(me.bet)}` : ""}</div>
        <div>${me.folded ? "フォールド" : G.board.length ? myCat : tierBadgeText(me)}</div></div></div>
  </div>`;
  if(G.phase === "done") h += resultHTML() + reviewHTML();
  if(cfg.advice && myTurn) h += adviceHTML();
  if(cfg.prob && me.hole.length && !me.folded) h += probHTML();
  if(cfg.chart && me.hole.length) h += chartHTML();
  h += `<div class="panel"><div class="ptitle">ログ<span class="sp"></span>
      <button class="btn sm" onclick="Practice.toggleLog()">${ui.showLog ? "閉じる" : "開く"}</button></div>
    ${ui.showLog ? `<div class="pr-log">${G.log.map(esc).join("<br>")}</div>` : `<div class="pr-log">${esc(G.log[G.log.length - 1] || "")}</div>`}</div>`;
  h += `<div style="height:${myTurn ? (ui.sizing ? 230 : 90) : 80}px"></div>`;
  h += barHTML(myTurn);
  return h;
}
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n));
function tierBadgeText(me){
  const info = handInfo(cs(me.hole[0]), cs(me.hole[1]));
  return `${info.name}（${TIER_LABEL[info.tier]}）`;
}
// 楕円テーブル：あなたが一番下、時計回り（左回り＝あなたの左隣が次）に座る
function ringHTML(){
  const P = G.players, n = P.length;
  const W = 100, Hh = 100;               // %
  const seat = (i, rx, ry) => { const a = (90 + i * 360 / n) * Math.PI / 180; return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) }; };
  const bd = [0,1,2,3,4].map(i => G.board[i] != null ? card(cs(G.board[i]), "bd") : `<span class="card bd empty"></span>`).join("");
  let seats = "", bets = "";
  P.forEach((p, i) => {
    const pt = seat(i, 41, 41), bp = seat(i, 25, 23);
    const pos = p.out ? { name:"" } : posInfo(p.id);
    if(p.bet > 0 && !p.out) bets += `<div class="rg-bet" style="left:${bp.x}%;top:${bp.y}%"><i></i>${fmt(p.bet)}</div>`;
    if(pos.name === "BTN"){ const dp = seat(i + 0.32, 30, 29); bets += `<div class="rg-dealer" style="left:${dp.x}%;top:${dp.y}%">D</div>`; }
    seats += i === 0 ? mySeatHTML(p, pt, pos) : ringSeatHTML(p, pt, pos);
  });
  return `<div class="rg">
    <div class="rg-felt"><div class="rg-pot">ポット <b>${fmt(potTotal())}</b></div><div class="rg-bd">${bd}</div>
      <div class="rg-st">${G.phase === "done" ? "ハンド終了" : ["プリフロップ","フロップ","ターン","リバー"][G.street]}</div></div>
    ${bets}${seats}
  </div>`;
}
function ringSeatHTML(p, pt, pos){
  if(p.out) return `<div class="rg-seat out" style="left:${pt.x}%;top:${pt.y}%"><div class="nm">${esc(p.name)}</div><div class="sub">敗退</div></div>`;
  const turn = G.phase === "play" && G.toAct === p.id;
  const show = p.shown || (ui.reveal && G.phase === "done");
  const win = G.phase === "done" && p.won > 0;
  const cards = p.folded && !show ? "" : `<div class="cards">${p.hole.map(c => show ? card(cs(c), "xs") : `<span class="card xs back"></span>`).join("")}</div>`;
  return `<div class="rg-seat ${turn ? "turn" : ""} ${p.folded ? "fold" : ""} ${win ? "win" : ""}" style="left:${pt.x}%;top:${pt.y}%">
    ${cards}
    <div class="nm">${esc(p.name)}${pos.name ? `<span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span>` : ""}</div>
    <div class="stk">${fmt(p.stack)}</div>
    <div class="act">${turn ? "考え中…" : win ? `<b>+${fmt(p.won)}</b>` : p.act || p.style.n}${p.shown && p.score ? `・${CAT_NAME[catOf(p.score)]}` : ""}</div>
  </div>`;
}
function mySeatHTML(p, pt, pos){
  const turn = G.phase === "play" && G.toAct === 0, win = G.phase === "done" && p.won > 0;
  return `<div class="rg-seat me ${turn ? "turn" : ""} ${p.folded ? "fold" : ""} ${win ? "win" : ""}" style="left:${pt.x}%;top:${pt.y}%">
    <div class="nm">あなた<span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span></div>
    <div class="stk">${fmt(p.stack)}</div>
    <div class="act">${turn ? "あなたの番" : win ? `<b>+${fmt(p.won)}</b>` : p.act || "&nbsp;"}</div>
  </div>`;
}
function seatHTML(p){
  const pos = posInfo(p.id);
  const turn = G.phase === "play" && G.toAct === p.id;
  const show = p.shown || (ui.reveal && G.phase === "done");
  const cards = p.folded && !show ? "" : `<div class="cards">${p.hole.map(c => show ? card(cs(c), "sm") : `<span class="card sm back"></span>`).join("")}</div>`;
  const win = G.phase === "done" && p.won > 0;
  return `<div class="pr-seat ${turn ? "turn" : ""} ${p.folded ? "fold" : ""} ${win ? "win" : ""}">
    <div class="r1"><span class="nm">${esc(p.name)}<span class="pr-tag">${p.style.n}</span></span>${pos.name ? `<span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span>` : ""}</div>
    <div class="r2"><span class="stk">${fmt(p.stack)}</span>${cards}</div>
    <div class="act">${turn ? "考え中…" : win ? `<b>+${fmt(p.won)}</b>` : p.act ? `${p.act}${p.bet ? ` <b>${fmt(p.bet)}</b>` : ""}` : "&nbsp;"}${p.shown && p.score ? `・${CAT_NAME[catOf(p.score)]}` : ""}</div>
  </div>`;
}
function adviceHTML(){
  const a = advise();
  return `<div class="panel pr-adv">
    <div class="ptitle">GTO的な目安<span class="sp"></span><small>相手${a.ranges.length}人のレンジを推定</small></div>
    <div class="big">
      <div><span>あなたの勝率</span><b style="color:${a.eq >= Math.max(a.req, 0.5) ? "#7ff0ff" : "inherit"}">${pctS(a.eq, 1)}</b></div>
      <div><span>必要勝率</span><b>${a.toCall ? pctS(a.req, 1) : "—"}</b></div>
      <div><span>コールの期待値</span><b class="${a.toCall ? (a.ev >= 0 ? "plus" : "minus") : ""}">${a.toCall ? (a.ev >= 0 ? "+" : "−") + fmt(Math.abs(a.ev)) : "—"}</b></div>
    </div>
    ${a.toCall ? `<p class="sub" style="margin-bottom:8px">必要勝率 = コール額 ${fmt(a.toCall)} ÷（ポット ${fmt(a.pot)} ＋ コール額）</p>` : ""}
    ${a.outs && a.outs.outs ? `<p class="sub" style="margin-bottom:8px">アウツ ${a.outs.outs}枚：次のカードで ${pctS(a.outs.next, 0)}${G.board.length === 3 ? `・リバーまでに ${pctS(a.outs.byRiver, 0)}` : ""}</p>` : ""}
    <div class="pr-rec"><div class="h">おすすめアクション</div><div class="a">${a.rec.label}</div><div class="w">${a.rec.reason}</div></div>
  </div>`;
}
function probHTML(){
  const t = probTable(), b = G.board.length;
  const cell = v => v <= 0 ? `<td class="z">—</td>` : `<td>${v < 0.001 ? "<0.1%" : pctS(v, 1)}</td>`;
  const rows = [8,7,6,5,4,3,2,1,0].map(c => `<tr class="${t.myCat === c ? "mine" : ""}"><td>${CAT_NAME[c]}</td>${cell(t.oppNow[c])}${b < 5 ? cell(t.oppRiver[c]) : ""}${b < 5 ? cell(t.meRiver[c]) : ""}</tr>`).join("");
  return `<div class="panel">
    <div class="ptitle">役の確率<span class="sp"></span><small>${["プリフロップ","","","フロップ","ターン","リバー"][b]}</small></div>
    <table class="pr-pt"><tr><th>役</th><th>相手<br>今</th>${b < 5 ? "<th>相手<br>リバーまで</th><th>自分<br>リバーまで</th>" : ""}</tr>${rows}</table>
    <p class="sub" style="margin-top:8px">相手＝ランダムな手札の相手1人の場合。緑の行が今のあなたの役${t.beat != null ? `。相手1人が今あなたより強い確率：<b style="color:var(--text)">${pctS(t.beat, 1)}</b>` : ""}</p>
  </div>`;
}
function chartHTML(){
  const me = G.players[0], mine = handInfo(cs(me.hole[0]), cs(me.hole[1])), pos = posInfo(0);
  let cells = "";
  for(let r = 0; r < 13; r++) for(let c = 0; c < 13; c++){
    const code = CHART[r][c], t = TIERS[code];
    const name = r === c ? RANKS[r]+RANKS[c] : r < c ? RANKS[r]+RANKS[c]+"s" : RANKS[c]+RANKS[r]+"o";
    const isMine = mine.row === r && mine.col === c;
    cells += `<div class="hc ${code} ${t > pos.tier && !isMine ? "dim" : ""} ${isMine ? "mine" : ""}">${name}</div>`;
  }
  return `<div class="panel">
    <div class="ptitle">プリフロップ表<span class="sp"></span><span class="tier ${mine.code}">${mine.name}・${TIER_LABEL[mine.tier]}</span></div>
    <p class="sub" style="margin-bottom:8px">あなたは ${pos.name}。明るいマスが ${pos.name} からオープンできる範囲、ピンクの枠があなたの手札</p>
    <div class="hgrid mini">${cells}</div>
  </div>`;
}
function resultHTML(){
  const me = G.players[0];
  const msg = me.won > 0 ? `あなたが ${fmt(me.won)} を獲得` : G.result && G.result.winners.length ? `${G.result.winners.map(i => G.players[i].name).join("・")} の勝ち` : "";
  return `<div class="panel"><div class="pr-res">${msg}</div>
    <label class="pr-sw" style="border:none;padding:4px 0"><span>降りた人も含めて全員の手札を見る</span><input type="checkbox" ${ui.reveal ? "checked" : ""} onchange="Practice.reveal(this.checked)"></label></div>`;
}
function overHTML(){
  const o = G.over;
  return `<div class="panel pr-over">${o.win ? "優勝" : "敗退"}<b>${o.place}位</b>
    <p class="sub">${G.handNo}ハンドプレイ・Lv${G.level + 1}まで到達</p></div>
    <button class="btn primary big" style="margin-bottom:10px" onclick="Practice.start()">もう一度</button>
    <button class="btn big" onclick="Practice.toSetup()">設定に戻る</button>`;
}
function barHTML(myTurn){
  const me = G.players[0];
  let inner;
  if(G.phase === "done"){
    inner = `<button class="btn primary big" onclick="Practice.next()">次のハンドへ</button>`;
  }else if(!myTurn){
    const p = G.players[G.toAct];
    inner = `<div class="pr-wait">${G.phase === "runout" ? "カードをめくっています…" : me.folded ? `フォールド中・${p ? esc(p.name) + " の番" : ""}` : p ? `${esc(p.name)} が考え中…` : ""}</div>`;
  }else if(ui.sizing){
    const pot = potTotal(), minTo = Math.min(G.currentBet + G.minRaise, me.bet + me.stack), maxTo = me.bet + me.stack;
    const toCallNow = G.currentBet - me.bet;
    const potRaise = G.currentBet + (pot + toCallNow);   // ポットサイズレイズ
    const pre = G.street === 0 && G.currentBet <= G.bb
      ? [["2.5BB", G.bb * 2.5], ["3BB", G.bb * 3], ["4BB", G.bb * 4]]
      : G.currentBet > 0 ? [["2.5倍", G.currentBet * 2.5], ["3倍", G.currentBet * 3], ["ポット", potRaise]]
      : [["1/3", pot / 3], ["1/2", pot / 2], ["2/3", pot * 2 / 3], ["ポット", pot]];
    inner = `<div class="pr-size">
      <div class="pre">${pre.map(([l, v]) => `<button onclick="Practice.setRaise(${Math.round(v)})">${l}</button>`).join("")}<button onclick="Practice.setRaise(${maxTo})">オールイン</button></div>
      <div class="amt" id="prAmt">${fmt(ui.raiseTo)}</div>
      <input type="range" id="prSl" min="${minTo}" max="${maxTo}" step="${Math.max(1, Math.round(G.bb / 10))}" value="${ui.raiseTo}" oninput="Practice.setRaise(+this.value)">
      <div class="row"><button class="btn" onclick="Practice.cancelSize()">戻る</button>
        <button class="btn primary" onclick="Practice.act('raise')">${G.currentBet === 0 ? "ベット" : "レイズ"}する</button></div></div>`;
  }else{
    const toCall = Math.min(G.currentBet - me.bet, me.stack);
    const canRaise = me.stack > toCall && live().filter(p => !p.allin && p.id !== 0).length > 0;
    inner = `<div class="row">
      ${toCall > 0 ? `<button class="btn danger" onclick="Practice.act('fold')">フォールド</button>` : ""}
      <button class="btn" onclick="Practice.act('${toCall > 0 ? "call" : "check"}')">${toCall > 0 ? (toCall >= me.stack ? `オールイン ${fmt(toCall)}` : `コール ${fmt(toCall)}`) : "チェック"}</button>
      ${canRaise ? `<button class="btn primary" onclick="Practice.sizing()">${G.currentBet === 0 ? "ベット" : "レイズ"}</button>` : ""}
    </div>`;
  }
  return `<div class="pr-bar"><div class="in">${inner}</div></div>`;
}

// ---------------------------------------------------------------------
//  外から呼ぶ関数
// ---------------------------------------------------------------------
window.Practice = {
  open(from){ prevScreen = from || "gate"; page = G && !G.over ? "table" : "setup"; screen = "practice"; window.scrollTo(0, 0); render(); },
  render,
  exit(){ if(G) clearTimeout(G.timer); screen = prevScreen; window.scrollTo(0, 0); window.render(); if(screen === "main" && typeof refresh === "function") refresh(); },
  set(k, v){ cfg[k] = v; save(LS_CFG, cfg); render(); },
  start(){ newGame(); window.scrollTo(0, 0); },
  toSetup(){ G = null; page = "setup"; render(); },
  async quit(){
    if(G && !G.over && !(await askConfirm("練習を終わりますか？", "今のゲームは終了します。", "終了する", true))) return render();
    if(G) clearTimeout(G.timer);
    G = null; page = "setup"; render();
  },
  act(type){ human(type, type === "raise" ? ui.raiseTo : null); },
  sizing: openSizing,
  setRaise,
  cancelSize(){ ui.sizing = false; render(); },
  next(){ ui.reveal = false; nextHand(); window.scrollTo(0, 0); },
  reveal(v){ ui.reveal = v; render(); },
  toggleLog(){ ui.showLog = !ui.showLog; render(); },
  toggleReview(){ ui.review = !ui.review; render(); },
  // テスト用
  _sim(n){ return simulate(n); }
};

// 自動対戦テスト（あなたもCPUとして動かし、チップが増減しないか確認）
function simulate(hands){
  const saveCfg = Object.assign({}, cfg);
  let total0 = null, errors = [];
  newGame(); clearTimeout(G.timer);
  G.players[0].cpu = true; G.players[0].style = STYLES[3];
  total0 = G.players.reduce((a, p) => a + p.stack + p.total, 0);
  const origSchedule = schedule;
  for(let h = 0; h < hands && !G.over; h++){
    let guard = 0;
    while(G.phase === "play" || G.phase === "runout"){
      if(++guard > 500){ errors.push("loop " + G.handNo); break; }
      if(G.phase === "runout"){ clearTimeout(G.timer); endStreet(); continue; }
      clearTimeout(G.timer);
      const d = cpuDecide(G.toAct); doAction(G.toAct, d.type, d.to);
    }
    clearTimeout(G.timer);
    const t = G.players.reduce((a, p) => a + p.stack, 0);
    if(G.tour && t !== total0) errors.push(`hand ${G.handNo}: ${t} != ${total0}`);
    if(G.players.some(p => p.stack < 0)) errors.push("negative " + G.handNo);
    if(G.over) break;
    if(!G.tour && G.players[0].stack === 0){ G.players[0].stack = G.startStack; }
    startHand(); clearTimeout(G.timer);
  }
  Object.assign(cfg, saveCfg);
  const res = { hands: G.handNo, over: G.over, errors: errors.slice(0, 5), stacks: G.players.map(p => p.stack) };
  G = null; page = "setup";
  return res;
}
})();
