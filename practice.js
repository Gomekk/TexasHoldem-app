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
  G.board = []; G.street = 0; G.result = null; G.raiseCount = 0; G.actions = 0; G.opener = -1; G.pfSpot = null;
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
      if(G.street === 0){ if(G.raiseCount === 0) G.opener = seat; G.raiseCount++; p.pfRaises++; }
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
// ---------------------------------------------------------------------
//  レンジ（13×13の表）とコンボ
// ---------------------------------------------------------------------
const ridx = c => 14 - (c >> 2);                          // A=0 … 2=12（表の行・列）
function rcOf(a, b){
  const i = ridx(a), j = ridx(b);
  if(i === j) return [i, i];
  const hi = Math.min(i, j), lo = Math.max(i, j);
  return (a & 3) === (b & 3) ? [hi, lo] : [lo, hi];       // スーテッド＝右上、オフスート＝左下
}
const clsName = (r, c) => r === c ? RANKS[r] + RANKS[c] : r < c ? RANKS[r] + RANKS[c] + "s" : RANKS[c] + RANKS[r] + "o";
const clsWeight = (r, c) => r === c ? 6 : r < c ? 4 : 12;
function repCombo(r, c){
  const ra = 14 - r, rb = 14 - c;
  if(r === c) return [(ra << 2) | 0, (ra << 2) | 1];
  if(r < c) return [(ra << 2) | 0, (rb << 2) | 0];
  return [(rb << 2) | 0, (ra << 2) | 1];
}
const COMBOS = []; for(let i = 0; i < 52; i++) for(let j = i + 1; j < 52; j++) COMBOS.push([ALL[i], ALL[j]]);
const COMBOS_BY_CHEN = COMBOS.slice().sort((x, y) => chen(y[0], y[1]) - chen(x[0], x[1]));
const rangeMemo = {};
function rangeChart(tier){          // 写真のチャートで、そのポジションからオープンする範囲
  const k = "c" + tier;
  return rangeMemo[k] || (rangeMemo[k] = COMBOS.filter(([a, b]) => { const [r, c] = rcOf(a, b); return TIERS[CHART[r][c]] <= tier; }));
}
function rangePct(pct){             // 強さ上位◯%
  const k = "p" + pct;
  return rangeMemo[k] || (rangeMemo[k] = pct >= 1 ? COMBOS : COMBOS_BY_CHEN.slice(0, Math.max(6, Math.round(COMBOS.length * pct))));
}
const POS_TIER = { "UTG":0, "UTG+1":1, "UTG+2":1, "LJ":2, "HJ":2, "CO":3, "BTN":4, "SB":3, "BB":4 };
const PF_ORDER = ["UTG","UTG+1","UTG+2","LJ","HJ","CO","BTN","SB","BB"];
const POST_ORDER = ["SB","BB","UTG","UTG+1","UTG+2","LJ","HJ","CO","BTN"];
const ipVs = (hero, opp) => POST_ORDER.indexOf(hero) > POST_ORDER.indexOf(opp);
// ゲーム中：あなたが残っている相手全員より後に行動できるか（インポジション）
function heroIP(){
  const order = G.seats.slice(1).concat(G.seats[0]);
  const ids = live().map(p => p.id);
  return order.filter(i => ids.includes(i)).slice(-1)[0] === 0;
}
// 実現率（エクイティ・リアライゼーション）：勝率のうち、実際に回収できる割合の目安
function realize(ip, street, a, b, eq){
  if(street >= 3) return 1;
  let R = ip ? [1.03, 1.04, 1.02][street] : [0.79, 0.85, 0.92][street];
  if(street === 0 && eq != null) R += (eq - 0.45) * 0.35;      // 強い手札ほど勝率を回収しやすい
  if(street === 0 && a != null){
    const r1 = a >> 2, r2 = b >> 2, suited = (a & 3) === (b & 3), pair = r1 === r2, gap = Math.abs(r1 - r2) - 1, hi = Math.max(r1, r2);
    if(suited) R += 0.06;
    if(pair) R += 0.03;
    if(!pair && gap <= 1) R += 0.03;
    if(!suited && !pair) R -= 0.03;
    if(!suited && !pair && gap >= 3) R -= 0.10;
    if(!suited && !pair && hi < 10) R -= 0.06;
  }
  return Math.max(0.5, Math.min(1.15, R));
}
const rText = (R, ip) => `${ip ? "インポジション" : "アウトオブポジション"}の実現率${R.toFixed(2)}`;

// 相手のアクションからレンジを推定（あなたへのアドバイス用）
function oppRanges(meSeat){
  return live().filter(p => p.id !== meSeat).map(p => {
    const pos = posInfo(p.id).name;
    let combos, label;
    if(p.id === G.opener && p.pfRaises === 1 && G.raiseCount === 1){ combos = rangeChart(POS_TIER[pos] ?? 4); label = `${pos}のオープンレンジ`; }
    else if(p.pfRaises >= 1 && (p.id !== G.opener || p.pfRaises >= 2)){ combos = rangePct(G.raiseCount >= 3 ? 0.03 : 0.06); label = "3ベット以上のレンジ"; }
    else if(p.id === G.opener){ combos = rangePct(0.12); label = "3ベットにコールしたレンジ"; }
    else if(p.pfCalls > 0 && !p.limped){ combos = rangePct(0.22); label = "レイズにコールしたレンジ"; }
    else if(p.limped){ combos = rangePct(0.5); label = "リンプしたレンジ"; }
    else { combos = COMBOS; label = "すべての手札"; }
    return { combos, label, aggr: p.aggr.slice(), name: p.name };
  });
}
function improves(hole, boardPart){
  const withH = catOf(evaluate(hole.concat(boardPart))), only = catOf(evaluate(boardPart));
  if(withH > only) return true;
  const cnt = [0,0,0,0]; hole.concat(boardPart).forEach(c => cnt[c & 3]++);
  return hole.some(c => cnt[c & 3] >= 4);
}
function equityRange(hole, board, ranges, iters, street){
  if(street == null) street = G ? G.street : 0;
  const blocked = new Uint8Array(64); hole.concat(board).forEach(c => blocked[c] = 1);
  const deck = ALL.filter(c => !blocked[c]);
  const mark = new Int32Array(64);
  let win = 0;
  for(let it = 1; it <= iters; it++){
    const free = c => !blocked[c] && mark[c] !== it;
    const pick = () => { for(;;){ const c = deck[Math.floor(rnd() * deck.length)]; if(mark[c] !== it){ mark[c] = it; return c; } } };
    const hands = ranges.map(r => {
      for(let t = 0; t < 30; t++){
        const h = r.combos[Math.floor(rnd() * r.combos.length)];
        if(!free(h[0]) || !free(h[1])) continue;
        let ok = true;
        for(let s = 1; s <= street && s <= 3 && board.length >= s + 2; s++){
          if(r.aggr[s] && !improves(h, board.slice(0, s + 2))){ ok = false; break; }
        }
        if(!ok && t < 29) continue;
        mark[h[0]] = it; mark[h[1]] = it; return h;
      }
      return [pick(), pick()];
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
//  ディフェンス表（レイズを受けた時のコール／3ベット／フォールド）
//   相手のオープンレンジ・レイズ額・デッドマネー・実現率から計算
// ---------------------------------------------------------------------
function decideDef(eq, eqR, need, name, openTier){
  if(eq >= (openTier >= 3 ? 0.56 : 0.60)) return "3bet";                               // バリュー3ベット
  if(openTier >= 3 && /^(A[2-5]s|K[5-9]s|[QJ]9s|T8s|97s|65s|54s)$/.test(name) && eqR < need + 0.10 && eqR >= need - 0.06) return "3bet";   // ブロッカー・プレイアビリティのあるブラフ3ベット
  if(eqR >= need) return "call";
  return "fold";
}
const defMemo = {};
function defenseChart(o){
  // o: { hero, opener, openBB, postedBB, potBB, behind, callers }
  const key = JSON.stringify(o);
  if(defMemo[key]) return defMemo[key];
  const tier = POS_TIER[o.opener] ?? 4, range = rangeChart(tier);
  const ip = ipVs(o.hero, o.opener);
  const toCall = o.openBB - o.postedBB;
  const req = toCall / (o.potBB + toCall);
  const margin = 0.015 * o.behind + 0.02 * o.callers;
  const need = req + margin;
  const grid = []; const w = { "3bet":0, call:0, fold:0 }; let tot = 0;
  for(let r = 0; r < 13; r++){ grid.push([]); for(let c = 0; c < 13; c++){
    const [a, b] = repCombo(r, c), name = clsName(r, c);
    const eq = equityRange([a, b], [], [{ combos: range, aggr: [] }], 420, 0);
    const R = realize(ip, 0, a, b, eq), eqR = eq * R;
    const act = decideDef(eq, eqR, need, name, tier);
    grid[r].push({ eq, R, eqR, act, name });
    w[act] += clsWeight(r, c); tot += clsWeight(r, c);
  }}
  const res = { grid, req, need, margin, ip, tier, toCall, o, freq: { r3: w["3bet"] / tot, call: w.call / tot, fold: w.fold / tot } };
  defMemo[key] = res;
  return res;
}
// 今の場面（あなたがレイズを1回受けた時）のパラメータ
function currentDefSpot(){
  const me = G.players[0], bb = G.bb;
  const opener = G.players[G.opener];
  const order = G.seats;                                  // ボタンから
  const pfOrder = order.slice(3).concat(order.slice(0, 3)); // UTG…BTN,SB,BB（3人以上）
  const pfo = order.length === 2 ? [order[0], order[1]] : pfOrder;
  const myIdx = pfo.indexOf(0);
  const behind = pfo.slice(myIdx + 1).filter(i => !G.players[i].folded && i !== G.opener).length;
  const callers = live().filter(p => p.id !== 0 && p.id !== G.opener && p.pfCalls > 0).length;
  return { hero: posInfo(0).name, opener: posInfo(opener.id).name, openerName: opener.name,
    openBB: +(G.currentBet / bb).toFixed(2), postedBB: +(me.bet / bb).toFixed(2), potBB: +(potTotal() / bb).toFixed(2), behind, callers };
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
  let eq = equityRange(hole, board, ranges, ranges.length > 3 ? 1500 : 2500);
  const req = toCall > 0 ? toCall / (pot + toCall) : 0;
  const maxTo = me.bet + me.stack, minTo = Math.min(G.currentBet + G.minRaise, maxTo);
  const clamp = x => Math.min(maxTo, Math.max(minTo, Math.round(x / 5) * 5));
  const Rc = (type, label, to, reason) => ({ type, label, to: to != null ? clamp(to) : null, reason });
  let rec, kind = "post", need = req, spot = null, ip, R;
  const stackBB = (me.stack + me.bet) / bb;
  const outs = outsInfo(hole, board);
  if(G.street === 0){
    const info = handInfo(cs(hole[0]), cs(hole[1])), pos = posInfo(0), ch = chen(hole[0], hole[1]);
    const limpers = live().filter(q => q.limped && q.id !== 0).length;
    const opener = G.opener >= 0 ? G.players[G.opener] : null;
    ip = opener ? ipVs(pos.name, posInfo(opener.id).name) : heroIP();
    R = realize(ip, 0, hole[0], hole[1]);
    if(stackBB <= 15 && G.tour){
      kind = "push";
      const th = 6 + stackBB * 0.25 + (G.raiseCount ? 2 : 0);
      rec = ch >= th ? Rc("raise", "オールイン", maxTo, `残り${stackBB.toFixed(1)}BBのショートスタック。プッシュ／フォールドで戦う局面で、この手札はオールインできる強さです（ショートスタックでは実現率の問題がなくなるため、勝率そのもので判断します）`)
                     : toCall === 0 ? Rc("check", "チェック", null, "ショートスタックで手札が弱いので、無料で見られるならチェック")
                     : Rc("fold", "フォールド", null, `ショートスタックでは弱い手札でチップを使わず、強い手札でのオールインを待ちます`);
      R = 1;
    }else if(G.raiseCount === 0){
      kind = "open";
      if(pos.name === "BB" && toCall === 0 && info.tier > 1) rec = Rc("check", "チェック", null, `BBでリンプが入っただけの場面。${info.name} はアイソレーション（リンパーを狙ったレイズ）するほど強くないので、無料でフロップを見ます`);
      else if(info.tier <= pos.tier) rec = Rc("raise", `レイズ ${fmt((2.5 + limpers) * bb)}`, (2.5 + limpers) * bb,
          `${info.name} は ${pos.name} からオープンできる範囲（オープンレンジ表の${TIER_LABEL[info.tier]}）。${limpers ? `リンパーが${limpers}人いるので1人につき1BB足します` : "2.5BBでオープン"}`);
      else if(toCall === 0) rec = Rc("check", "チェック", null, "BBで誰もレイズしていないので、無料でフロップを見ます");
      else rec = Rc("fold", "フォールド", null, `${info.name} は ${pos.name} のオープンレンジ外。誰もレイズしていない場面では、オープンできない手札はコール（リンプ）せずに降りるのが基本です`);
    }else if(G.raiseCount === 1){
      kind = "defend";
      spot = currentDefSpot();
      const dc = defenseChart(spot);
      const openRange = [{ combos: rangeChart(dc.tier), aggr: [] }];
      const eqOpen = equityRange(hole, [], openRange, 3000, 0);   // 表と同じく「オープンした人のレンジ」に対する勝率
      eq = eqOpen; R = realize(ip, 0, hole[0], hole[1], eq);
      const eqR = eq * R;
      need = dc.need;
      const act = decideDef(eqOpen, eqR, need, info.name, dc.tier);
      // 表の自分のマスを、より正確な値で上書き（表とおすすめを一致させる）
      dc.grid[info.row][info.col] = { eq, R, eqR, act, name: info.name };
      const base = `${opener.name}（${spot.opener}）の${spot.openBB}BBオープンに対して、あなたは${spot.hero}（${ip ? "インポジション" : "アウトオブポジション"}）。${spot.opener}のオープンレンジに対する推定勝率${pctS(eq,0)} × 実現率${R.toFixed(2)} = ${pctS(eqR,0)}。必要勝率は${pctS(req,0)}（ブラインド・アンティ込みのポット${fmt(pot)}にコール${fmt(toCall)}）${dc.margin > 0 ? `に、後ろの人・他のコーラーの分の余裕${pctS(dc.margin,0)}を足して${pctS(need,0)}` : ""}`;
      if(act === "3bet") rec = Rc("raise", `3ベット ${fmt(G.currentBet * (ip ? 3 : 3.5))}`, G.currentBet * (ip ? 3 : 3.5),
        eqOpen >= 0.6 ? `${base}。オープンレンジに対して勝率${pctS(eqOpen,0)}と大きく有利なので、3ベットで価値を取ります${ip ? "" : "（アウトオブポジションなので3.5倍と大きめ）"}`
                      : `${base}。この手札はコールとフォールドの境目にあり、Aや K を持っていて相手の強い手札を減らせる（ブロッカー）か、フロップで強くなりやすい形なので、ブラフの3ベットに回すのがセオリーです`);
      else if(act === "call") rec = Rc("call", `コール ${fmt(toCall)}`, null, `${base}。実現後の勝率が必要勝率を上回るので、コールでディフェンスします`);
      else rec = Rc("fold", "フォールド", null, `${base}。実現後の勝率が足りないのでフォールド`);
      G.pfSpot = G.pfSpot || { kind, spot, hole: hole.slice() };
    }else{
      kind = "vs3bet";
      R = realize(ip, 0, hole[0], hole[1], eq);
      const premium = ch >= 14 || (hole.some(c => c >> 2 === 14) && hole.some(c => c >> 2 === 13));
      const eqR = eq * R;
      if(premium) rec = Rc("raise", stackBB < 40 ? "オールイン" : `4ベット ${fmt(G.currentBet * 2.3)}`, stackBB < 40 ? maxTo : G.currentBet * 2.3, "QQ以上・AKは3ベットに対しても押し返せる強さです");
      else if(eqR >= req) rec = Rc("call", `コール ${fmt(toCall)}`, null, `3ベット以上の強いレンジ（上位約6%）に対して、推定勝率${pctS(eq,0)} × ${rText(R, ip)} = ${pctS(eqR,0)} ≧ 必要勝率${pctS(req,0)}`);
      else rec = Rc("fold", "フォールド", null, `3ベット以上の強いレンジ（上位約6%）に対して、推定勝率${pctS(eq,0)} × ${rText(R, ip)} = ${pctS(eqR,0)} は必要勝率${pctS(req,0)}に届きません`);
    }
    if(kind === "open" && !G.pfSpot) G.pfSpot = { kind, pos: pos.name, hole: hole.slice() };
  }else{
    ip = heroIP(); R = realize(ip, G.street);
    const eqR = eq * R;
    const draw = outs && outs.outs >= 8 && board.length < 5;
    const rq = `推定勝率${pctS(eq,0)} × ${rText(R, ip)} = ${pctS(eqR,0)}`;
    if(toCall > 0){
      if(eq >= 0.72 && me.stack > toCall) rec = Rc("raise", `レイズ ${fmt(G.currentBet * 2.5)}`, G.currentBet * 2.5, `推定勝率${pctS(eq,0)}とかなり有利。レイズして価値を最大化します`);
      else if(eqR >= req) rec = Rc("call", `コール ${fmt(toCall)}`, null, `${rq} ≧ 必要勝率${pctS(req,0)}。コールの期待値はプラスです`);
      else if(draw && eqR + 0.06 >= req && me.stack > pot) rec = Rc("call", `コール ${fmt(toCall)}`, null, `${rq}で必要勝率${pctS(req,0)}に少し届きませんが、アウツ${outs.outs}枚のドローで、完成すれば大きく勝てる（インプライドオッズ）のでコール可`);
      else rec = Rc("fold", "フォールド", null, `${rq} ＜ 必要勝率${pctS(req,0)}。コールの期待値はマイナスです`);
    }else{
      if(eq >= 0.65) rec = Rc("raise", `ベット ${fmt(pot * 0.66)}（2/3ポット）`, pot * 0.66, `推定勝率${pctS(eq,0)}と有利。弱い手札からもコールをもらえるサイズでバリューベット`);
      else if(eq >= 0.52) rec = Rc("raise", `ベット ${fmt(pot * 0.33)}（1/3ポット）`, pot * 0.33, `推定勝率${pctS(eq,0)}でやや有利。小さめのベットで薄く価値を取ります（チェックも可）`);
      else if(draw) rec = Rc("raise", `ベット ${fmt(pot * 0.5)}（セミブラフ）`, pot * 0.5, `今は弱いですが、アウツ${outs.outs}枚のドロー。相手が降りれば勝ち、コールされても完成の可能性があります`);
      else rec = Rc("check", "チェック", null, `推定勝率${pctS(eq,0)}。${ip ? "インポジションなので無理せずチェックで次のカードを見られます" : "アウトオブポジションで中途半端な手札は、チェックで様子を見ます"}`);
    }
  }
  const eqR = eq * R;
  const ev = eqR * (pot + toCall) - toCall;
  const val = { eq, R, eqR, ip, req, need, ev, toCall, pot, rec, outs, ranges, kind, spot };
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
  const need = d.need != null ? d.need : d.req;
  const eqR = d.eqR != null ? d.eqR : d.eq;
  const margin = d.toCall > 0 ? eqR - need : d.eq - 0.5;
  const close = Math.abs(margin) < 0.04;
  const calc = `推定勝率${pctS(d.eq,0)} × ${rText(d.R || 1, d.ip)} = ${pctS(eqR,0)}`;
  let grade, title, why;
  if(cls(my) === cls(rt)){
    grade = 3; title = "良い判断";
    why = d.rec.reason;
    if(my === "raise" && d.rec.to && d.amount){
      const ratio = d.amount / d.rec.to;
      if(ratio > 1.8 || ratio < 0.5){ grade = 2; title = "方向は正解・サイズに改善点"; why = `アクションはおすすめどおり。ただし金額 ${fmt(d.amount)} は目安 ${fmt(d.rec.to)} から離れています。${ratio > 1 ? "大きすぎると、弱い手札が降りて強い手札だけが残ります" : "小さすぎると、相手に安くドローを引かせてしまいます"}`; }
    }
  }else if(d.kind === "open"){
    // 誰もレイズしていない場面：オープンレンジ表が基準
    grade = 1;
    title = my === "fold" ? "降りすぎ" : my === "raise" ? "オープンしすぎ" : "リンプ（コールで参加）";
    if(my === "raise" && rt === "check"){ grade = 2; title = "攻めすぎ（悪くはない）"; }
    why = `誰もレイズしていない場面なので、基準はオープンレンジ表です。おすすめは「${d.rec.label}」。${d.rec.reason}`;
  }else if(my === "fold"){
    const lost = Math.max(0, d.ev);
    grade = close ? 2 : 0; title = close ? "ギリギリの判断（降りすぎ気味）" : "降りすぎ";
    why = d.toCall > 0 ? `${calc} は必要勝率${pctS(need,0)}を上回っていました。コールの期待値は約+${fmt(lost)}（${bbv(lost)}）で、フォールドでその分を手放しています` : d.rec.reason;
    if(rt === "raise") why = `おすすめは「${d.rec.label}」。${d.rec.reason}`;
  }else if(my === "call" && rt === "fold"){
    const lost = Math.max(0, -d.ev);
    grade = close ? 2 : 0; title = close ? "ギリギリの判断（コールしすぎ気味）" : "コールしすぎ";
    why = `${calc} に対して必要勝率${pctS(need,0)}。このコールの期待値は約−${fmt(lost)}（${bbv(lost)}）です`;
    if(d.outs && d.outs.outs >= 8) why += `。アウツ${d.outs.outs}枚のドローなので、後で大きく取れるならギリギリ許容範囲`;
  }else if(my === "raise" && (rt === "fold" || rt === "check" || rt === "call")){
    grade = d.eq >= 0.45 || close ? 2 : 1; title = d.eq >= 0.45 ? "攻めすぎ（悪くはない）" : "攻めすぎ";
    why = `推定勝率${pctS(d.eq,0)}で、目安は「${d.rec.label}」。${d.eq < 0.35 ? "ブラフとして使うなら、相手が降りやすいボードかどうか・アウツやブロッカーがあるかを意識しましょう" : "中くらいの強さの手札で大きくすると、強い手札にだけコールされがちです"}`;
  }else if((my === "call" || my === "check") && rt === "raise"){
    grade = 2; title = "消極的";
    why = `おすすめは「${d.rec.label}」。${d.rec.reason}`;
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
        <div><span>推定勝率</span><b>${pctS(x.eq,0)}</b></div>
        <div><span>実現率×</span><b>${x.R != null ? x.R.toFixed(2) : "—"}</b><span>${x.ip == null ? "" : x.ip ? "IP" : "OOP"}</span></div>
        <div><span>実現後</span><b>${pctS(x.eqR != null ? x.eqR : x.eq,0)}</b></div>
        <div><span>必要勝率</span><b>${x.toCall ? pctS(x.need != null ? x.need : x.req,0) : "—"}</b></div>
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
      <p class="sub" style="margin-top:10px">推定勝率＝その時点で分かっていた情報（相手のアクションから推定したレンジ）での勝率。実現率＝ポジションや手札の形で、勝率のうち実際に回収できる割合の目安（IP＝インポジション、OOP＝アウトオブポジション）。判断は「実現後の勝率」と「必要勝率」で評価します。実際の勝率は相手の本当の手札に対する結果論の勝率です</p>` : ""}
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
    R:a.R, eqR:a.eqR, ip:a.ip, need:a.need, kind:a.kind, spot:a.spot,
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
  .pr-adv .big.four{grid-template-columns:repeat(4,1fr);gap:5px}
  .pr-adv .big.four b{font-size:17px}
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
  .pr-bar.turn{border-top-color:#22e4ff;box-shadow:0 -6px 18px rgba(34,228,255,.18)}
  .ms{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .ms .cards{gap:6px}
  .ms.fold .cards{opacity:.45}
  .ms-i{flex:1;min-width:0}
  .ms-h{font-size:15px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ms-s{display:flex;align-items:center;gap:6px;margin-top:3px;font-size:12px;color:var(--sub);white-space:nowrap;overflow:hidden}
  .ms-s b{color:var(--text);font-size:14px;font-variant-numeric:tabular-nums}
  .ms.win .ms-h{color:var(--warn)}
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
  .rv-nums{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px}
  .rv-nums div{background:var(--panel2);border-radius:8px;padding:6px 2px;text-align:center}
  .rv-nums span{display:block;font-size:10px;color:var(--sub)}
  .rv-nums b{font-size:14px;font-variant-numeric:tabular-nums}
  .rv-why{font-size:12px;color:var(--sub);line-height:1.7}
  .rg{position:relative;width:100%;aspect-ratio:1/1.02;max-height:470px;margin:6px 0 10px}
  .rg-felt{position:absolute;left:12%;right:12%;top:14%;bottom:14%;border-radius:50%;
    background:radial-gradient(110% 90% at 50% 30%,#1b5a3d,#0e3323 70%,#0a2619);border:6px solid #3a2416;
    box-shadow:0 0 0 2px #5b3b24,inset 0 0 30px rgba(0,0,0,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px}
  .rg-pot{font-size:11px;color:#bfe8d1;display:flex;align-items:baseline;gap:4px}
  .rg-pot .rg-st{margin-left:6px}
  .fm{width:52%;margin-top:2px;display:flex;flex-direction:column;align-items:center;gap:3px}
  .fm-lbl{font-size:9.5px;color:#bfe8d1;font-weight:700;letter-spacing:.04em}
  .fm-big{font-size:28px;line-height:1;font-weight:900;color:#fff;font-variant-numeric:tabular-nums}
  .fm.ok .fm-big{color:#7ff0ff;text-shadow:0 0 14px rgba(34,228,255,.6)}
  .fm.ng .fm-big{color:#ffb4a8}
  .fm-calc{color:#8fc9a9;font-size:9.5px;white-space:nowrap}
  .fm-calc b{color:#fff}
  .fm-bar{position:relative;width:100%;height:10px;border-radius:5px;background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);margin-top:2px}
  .fm-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,#1f8f63,#22e4ff)}
  .fm.ng .fm-bar i{background:linear-gradient(90deg,#8a2a3a,#ff5468)}
  .fm-bar em{position:absolute;top:-4px;bottom:-4px;width:3px;margin-left:-1.5px;background:#fff;border-radius:2px;box-shadow:0 0 6px rgba(255,255,255,.8)}
  .wb{display:flex;width:100%;border-radius:4px;overflow:hidden;background:rgba(0,0,0,.4)}
  .wb i,.wl i{display:block;height:100%}
  .b4{background:#22e4ff}.b3{background:#2fbf7a}.b2{background:#c9c27a}.b1{background:#ff9b54}.b0{background:#ff5468}
  .fw{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:2px}
  .fw-t{font-size:9.5px;color:#bfe8d1;white-space:nowrap}
  .fw-t b{color:#fff;margin:0 2px 0 3px}
  .fw-t b.g{color:#7ff0ff}.fw-t b.o{color:#ffb08a}
  .why .wls{display:grid;gap:5px;margin-top:10px}
  .wl{display:grid;grid-template-columns:12px 72px 40px 1fr;align-items:center;gap:6px;font-size:12px}
  .wl i{width:12px;height:12px;border-radius:3px}
  .wl .n{font-weight:800}
  .wl b{text-align:right;font-variant-numeric:tabular-nums}
  .wl .e{color:var(--sub);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .wab{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);display:grid;gap:6px}
  .wab-row{display:grid;grid-template-columns:52px 1fr 34px auto 34px;align-items:center;gap:6px;font-size:12px}
  .wab-row .t{font-weight:800}
  .wab-row b{text-align:right;font-variant-numeric:tabular-nums}
  .wab-row b.g{color:#7ff0ff}.wab-row b.o{color:#ffb08a}
  .wab-row .arw{color:var(--sub);font-size:11px;white-space:nowrap}
  .wab-bar{height:10px;border-radius:5px;background:var(--panel2);overflow:hidden}
  .wab-bar i{display:block;height:100%}
  .wab-bar i.up{background:#2fbf7a}.wab-bar i.dn{background:#ff7a5c}
  .wab-f{font-size:12px;color:var(--sub);margin-top:2px}
  .wab-f b{color:var(--text);font-size:14px}
  .rvr-g{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .rvr-h{font-size:13px;font-weight:900;margin-bottom:4px;display:flex;flex-direction:column}
  .rvr-h span{font-size:10px;color:var(--sub);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rgx{display:grid;grid-template-columns:repeat(13,1fr);gap:1px;background:#0e141a;padding:1px;border-radius:5px;margin-bottom:6px}
  .rgx i{display:block;aspect-ratio:1;background:#1a222b;border-radius:1px}
  .rgx i.me{outline:2px solid #ff3d7f;outline-offset:-1px;position:relative;z-index:1}
  .rc-pp{background:#ff6b9a!important}.rc-ax{background:#22e4ff!important}.rc-bw{background:#2fbf7a!important}.rc-sc{background:#ffb020!important}.rc-ot{background:#7d8a98!important}
  .rc-st{background:#a64dff!important}.rc-tp{background:#22c37a!important}.rc-wp{background:#9fd36b!important}.rc-dr{background:#ffb020!important}.rc-ai{background:#56616d!important}
  .wb i[class^="rc-"]{display:block;height:100%}
  .rvr-t{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
  .rvr-t th{font-size:11px;color:var(--sub);text-align:right;padding:3px 4px}
  .rvr-t td{padding:4px;border-top:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
  .rvr-t td:first-child{text-align:left;font-weight:700;display:flex;align-items:center;gap:6px}
  .rvr-t td i{display:inline-block;width:10px;height:10px;border-radius:2px}
  .rvr-eq{margin-top:12px}
  .rvr-eqbar{height:12px;border-radius:6px;background:#ff7a5c;overflow:hidden}
  .rvr-eqbar i{display:block;height:100%;background:linear-gradient(90deg,#1f8f63,#22e4ff)}
  .rvr-eqt{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-top:4px;color:var(--sub)}
  .rvr-eqt b{color:var(--text);font-size:15px}
  .rvr-eqt .c{font-weight:800;color:var(--text)}
  .wm{margin-top:10px;font-size:12px;line-height:1.7;background:#1d1533;border:1px solid #4a3480;color:#d9c8ff;border-radius:10px;padding:8px 10px}
  .wm b{color:#fff}
  .fm-rec{font-size:12px;font-weight:900;border-radius:999px;padding:3px 11px;margin-top:2px;white-space:nowrap}
  .fm-rec.f{background:#3a1820;color:#ff8a99;border:1px solid #6b2633}
  .fm-rec.c{background:#0f3a28;color:#3ddc97;border:1px solid #1f6b4a}
  .fm-rec.r{background:#2a1a4d;color:#c7a8ff;border:1px solid #5a3a9a}
  .rg-pot b{font-size:16px;color:#fff;margin-left:2px;font-variant-numeric:tabular-nums}
  .rg-bd{display:flex;gap:3px}
  .rg-st{font-size:10px;color:#8fc9a9;font-weight:700;letter-spacing:.08em}
  .card.bd{width:27px;height:38px;font-size:13px;border-radius:5px}
  .card.bd i{font-size:13px;margin-top:1px}
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
  .rg-bet{position:absolute;left:50%;top:50%;z-index:5;font-size:11px;font-weight:800;color:#fff;background:#0b1a12;border:1px solid #2f6b4c;
    border-radius:999px;padding:2px 7px 2px 4px;display:flex;align-items:center;gap:4px;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none;
    box-shadow:0 1px 4px rgba(0,0,0,.6)}
  .rg-seat.fold .rg-bet{opacity:1}
  .rg-bet i{width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#fff 28%,#e0283c 30% 62%,#fff 64%);display:inline-block}
  .rg-dealer{position:absolute;left:-7px;top:-7px;z-index:5;width:18px;height:18px;border-radius:50%;background:#f2f2f2;color:#111;
    font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.6)}
  .hc.d3{background:#6d3fd6;color:#fff}.hc.dc{background:#2f8f46;color:#fff}.hc.df{background:#232c36;color:#5f6b78}
  .d3t{color:#b99bff}.dct{color:#3ddc97}.dft{color:#8796a6}
  .dlg{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:12px;font-weight:700;align-items:center}
  .dlg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:4px;vertical-align:-1px}
  .dlg i.d3{background:#6d3fd6}.dlg i.dc{background:#2f8f46}.dlg i.df{background:#232c36;border:1px solid #3a4652}
  .dme{margin-top:8px;font-size:13px;background:var(--panel2);border-radius:10px;padding:8px 10px;line-height:1.6}
  .pr-seg.wrap{flex-wrap:wrap}
  .pr-seg.wrap button{flex:1 0 auto;min-width:52px;padding:8px 6px;font-size:12px}
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
    <button class="btn primary big" style="margin-bottom:10px" onclick="Practice.start()">スタート</button>
    <button class="btn big" style="margin-bottom:12px" onclick="Practice.browser()">レンジ表を見る（オープン・ディフェンス）</button>
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
  h += whyPanelHTML();
  h += rangePanelHTML();
  if(G.phase === "done") h += resultHTML() + reviewHTML();
  if(cfg.advice && myTurn) h += adviceHTML();
  if(cfg.prob && me.hole.length && !me.folded) h += probHTML();
  if(cfg.chart && me.hole.length) h += chartHTML();
  h += `<div class="panel"><div class="ptitle">ログ<span class="sp"></span>
      <button class="btn sm" onclick="Practice.toggleLog()">${ui.showLog ? "閉じる" : "開く"}</button></div>
    ${ui.showLog ? `<div class="pr-log">${G.log.map(esc).join("<br>")}</div>` : `<div class="pr-log">${esc(G.log[G.log.length - 1] || "")}</div>`}</div>`;
  h += `<div style="height:${myTurn ? (ui.sizing ? 300 : 160) : 150}px"></div>`;
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
  const seat = (i, rx, ry) => { const a = (90 + i * 360 / n) * Math.PI / 180; return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a), ux: -Math.cos(a), uy: -Math.sin(a) }; };
  const bd = [0,1,2,3,4].map(i => G.board[i] != null ? card(cs(G.board[i]), "bd") : `<span class="card bd empty"></span>`).join("");
  let seats = "", bets = "";
  P.forEach((p, i) => {
    const pt = seat(i, 41, 41);
    const pos = p.out ? { name:"" } : posInfo(p.id);
    // ベット額：席の枠から、テーブルの中心側にはみ出す位置に表示（名前と重ならない）
    pt.extra = (p.bet > 0 && !p.out ? `<div class="rg-bet" style="transform:translate(calc(-50% + ${(pt.ux * 54).toFixed(1)}px),calc(-50% + ${(pt.uy * 50).toFixed(1)}px))"><i></i>${fmt(p.bet)}</div>` : "")
             + (pos.name === "BTN" ? `<div class="rg-dealer">D</div>` : "");
    seats += i === 0 ? mySeatHTML(p, pt, pos) : ringSeatHTML(p, pt, pos);
  });
  return `<div class="rg">
    <div class="rg-felt"><div class="rg-pot">ポット <b>${fmt(potTotal())}</b><span class="rg-st">${G.phase === "done" ? "ハンド終了" : ["プリフロップ","フロップ","ターン","リバー"][G.street]}</span></div><div class="rg-bd">${bd}</div>
      ${feltMeterHTML()}</div>
    ${bets}${seats}
  </div>`;
}
// テーブル中央の勝率メーター
//  ・あなたの番：実現後の勝率 vs 必要勝率（縦線）＋おすすめ
//  ・それ以外：今の推定勝率だけ
let liveEqCache = null;
function liveEquity(){
  const me = G.players[0];
  const key = `${G.handNo}|${G.street}|${G.actions}`;
  if(liveEqCache && liveEqCache.key === key) return liveEqCache.val;
  const eq = equityRange(me.hole, G.board, oppRanges(0), 1500);
  const ip = heroIP(), R = realize(ip, G.street, me.hole[0], me.hole[1], G.street === 0 ? eq : null);
  liveEqCache = { key, val: { eq, R, eqR: eq * R, ip } };
  return liveEqCache.val;
}
function feltMeterHTML(){
  const me = G.players[0];
  if(!cfg.advice || !me.hole.length || me.folded || G.phase === "done" || live().length < 2) return "";
  const myTurn = G.phase === "play" && G.toAct === 0;
  const a = myTurn ? advise() : liveEquity();
  const hasCall = myTurn && a.toCall > 0 && a.kind !== "open" && a.kind !== "push";
  const val = hasCall ? a.eqR : a.eq;
  const need = hasCall ? a.need : null;
  const good = hasCall ? a.eqR >= a.need : a.eq >= 1 / live().length;
  const recCls = myTurn ? (a.rec.type === "fold" ? "f" : a.rec.type === "raise" ? "r" : "c") : "";
  const w = Math.max(2, Math.min(100, val * 100));
  return `<div class="fm ${good ? "ok" : "ng"}">
    <div class="fm-lbl">${hasCall ? "実現後の勝率" : "推定勝率"}</div>
    <b class="fm-big">${pctS(val, 0)}</b>
    <div class="fm-bar"><i style="width:${w}%"></i>${need != null ? `<em style="left:${Math.min(100, need * 100)}%"></em>` : ""}</div>
    <div class="fm-calc">${hasCall ? `${pctS(a.eq,0)}×${a.R.toFixed(2)}・<b>必要 ${pctS(need,0)}</b>` : `相手${live().length - 1}人の推定レンジに対して`}</div>
    ${feltWhyHTML()}
    ${myTurn ? `<div class="fm-rec ${recCls}">${esc(a.rec.label)}</div>` : ""}
  </div>`;
}
// ---------------------------------------------------------------------
//  なぜこの勝率？（相手レンジの内訳と、リード／逆転の分解）
// ---------------------------------------------------------------------
const BUCKETS = [
  { k:"b4", name:"大きく有利", min:0.70 }, { k:"b3", name:"有利", min:0.55 }, { k:"b2", name:"互角", min:0.45 },
  { k:"b1", name:"不利", min:0.30 }, { k:"b0", name:"大きく不利", min:-1 } ];
let whyCache = null;
function primaryOpp(){
  const L = live().filter(p => p.id !== 0);
  const ag = L.filter(p => p.aggr[G.street]).slice(-1)[0];
  if(ag) return ag;
  if(G.opener > 0 && L.some(p => p.id === G.opener)) return G.players[G.opener];
  const r = L.filter(p => p.pfRaises > 0).slice(-1)[0];
  return r || L[0];
}
function whyBreakdown(){
  const me = G.players[0];
  const key = `${G.handNo}|${G.street}|${G.actions}`;
  if(whyCache && whyCache.key === key) return whyCache.val;
  const opp = primaryOpp(); if(!opp) return null;
  const rg = oppRanges(0).find(r => r.name === opp.name);
  const hole = me.hole, board = G.board;
  const blocked = new Uint8Array(64); hole.concat(board).forEach(c => blocked[c] = 1);
  // 相手レンジを手札の種類ごとにまとめる
  const groups = {};
  rg.combos.forEach(h => {
    if(blocked[h[0]] || blocked[h[1]]) return;
    if(board.length >= 3){ let ok = true; for(let s = 1; s <= G.street; s++) if(rg.aggr[s] && !improves(h, board.slice(0, s + 2))){ ok = false; break; } if(!ok) return; }
    const [r, c] = rcOf(h[0], h[1]), k = r * 13 + c;
    (groups[k] = groups[k] || { r, c, combos: [] }).combos.push(h);
  });
  const deckBase = ALL.filter(c => !blocked[c]);
  const myNow = board.length >= 3 ? evaluate(hole.concat(board)) : 0;
  const per = Object.values(groups);
  let totW = 0, eqSum = 0, ahead = 0, aheadWin = 0, behind = 0, behindWin = 0, tie = 0;
  const bw = { b4:0, b3:0, b2:0, b1:0, b0:0 }, ex = { b4:[], b3:[], b2:[], b1:[], b0:[] };
  const iters = per.length > 120 ? 36 : per.length > 50 ? 60 : 120;
  per.forEach(g => {
    let w = 0;
    for(let i = 0; i < iters; i++){
      const h = g.combos[Math.floor(rnd() * g.combos.length)];
      const used = new Set(h);
      const d = deckBase.filter(c => !used.has(c)); let len = d.length;
      const bd = board.slice(); while(bd.length < 5){ const j = Math.floor(rnd() * len); bd.push(d[j]); d[j] = d[--len]; }
      const a = evaluate(hole.concat(bd)), b = evaluate(h.concat(bd));
      const res = a > b ? 1 : a === b ? 0.5 : 0;
      w += res;
      if(board.length >= 3){
        const on = evaluate(h.concat(board));
        const wt = g.combos.length / iters;
        if(myNow > on){ ahead += wt; aheadWin += wt * res; } else if(myNow < on){ behind += wt; behindWin += wt * res; } else tie += wt;
      }
    }
    g.eq = w / iters; const wt = g.combos.length;
    totW += wt; eqSum += g.eq * wt;
    const bk = BUCKETS.find(b => g.eq >= b.min).k;
    bw[bk] += wt; ex[bk].push({ name: clsName(g.r, g.c), wt });
  });
  if(!totW) return null;
  BUCKETS.forEach(b => { bw[b.k] /= totW; ex[b.k] = ex[b.k].sort((x, y) => y.wt - x.wt).slice(0, 4).map(x => x.name); });
  const val = { opp, label: rg.label, eqHU: eqSum / totW, bw, ex, combos: totW,
    ahead: board.length >= 3 ? ahead / totW : null, behind: board.length >= 3 ? behind / totW : null, tie: board.length >= 3 ? tie / totW : null,
    keep: ahead ? aheadWin / ahead : 0, comeback: behind ? behindWin / behind : 0, multi: live().length - 1 };
  whyCache = { key, val };
  return val;
}
// ---------------------------------------------------------------------
//  レンジ比較（あなた vs 相手）
// ---------------------------------------------------------------------
const PRE_CATS = [ { k:"pp", name:"ペア" }, { k:"ax", name:"A絡み" }, { k:"bw", name:"ブロードウェイ" }, { k:"sc", name:"スーテッド" }, { k:"ot", name:"その他" } ];
const POST_CATS = [ { k:"st", name:"強い役（2ペア以上）" }, { k:"tp", name:"トップペア以上" }, { k:"wp", name:"弱いペア" }, { k:"dr", name:"ドロー" }, { k:"ai", name:"何もない" } ];
function preCat(a, b){
  const r1 = a >> 2, r2 = b >> 2;
  if(r1 === r2) return "pp";
  if(r1 === 14 || r2 === 14) return "ax";
  if(r1 >= 10 && r2 >= 10) return "bw";
  if((a & 3) === (b & 3)) return "sc";
  return "ot";
}
function hasDraw(h, board){
  const all = h.concat(board);
  const cnt = [0,0,0,0]; all.forEach(c => cnt[c & 3]++);
  if(h.some(c => cnt[c & 3] === 4)) return true;
  const ranks = new Set(all.map(c => c >> 2)); if(ranks.has(14)) ranks.add(1);
  const hr = h.map(c => c >> 2).concat(h.some(c => c >> 2 === 14) ? [1] : []);
  for(let lo = 1; lo <= 10; lo++){
    let n = 0, mine = false;
    for(let r = lo; r < lo + 5; r++) if(ranks.has(r)){ n++; if(hr.includes(r)) mine = true; }
    if(n === 4 && mine) return true;
  }
  return false;
}
function postCat(h, board){
  const v = evaluate(h.concat(board)), cat = catOf(v), bcat = catOf(evaluate(board));
  if(cat >= 2 && cat > bcat) return "st";
  const top = Math.max(...board.map(c => c >> 2));
  const r1 = h[0] >> 2, r2 = h[1] >> 2;
  const br = board.map(c => c >> 2);
  if(r1 === r2 && r1 > top) return "tp";
  if(r1 === top || r2 === top) return "tp";
  if(r1 === r2 || br.includes(r1) || br.includes(r2)) return "wp";
  if(board.length < 5 && hasDraw(h, board)) return "dr";
  return "ai";
}
// あなたのレンジ（ここまでのアクションから推定）
function myRange(){
  const me = G.players[0], pos = posInfo(0).name;
  const tier = POS_TIER[pos] ?? 4;
  let combos, label;
  const spot = G.pfSpot && G.pfSpot.kind === "defend" ? G.pfSpot.spot : null;
  const fromDef = acts => { const dc = defenseChart(spot); return COMBOS.filter(([a, b]) => { const [r, c] = rcOf(a, b); return acts.includes(dc.grid[r][c].act); }); };
  const fromDefSpot = acts => { const dc = defenseChart(currentDefSpot()); return COMBOS.filter(([a, b]) => { const [r, c] = rcOf(a, b); return acts.includes(dc.grid[r][c].act); }); };
  if(G.opener === 0 && me.pfRaises === 1 && !me.pfCalls){ combos = rangeChart(tier); label = `${pos}のオープンレンジ`; }
  else if(G.opener === 0 && me.pfRaises === 1){ combos = rangePct(0.12); label = "3ベットにコールしたレンジ"; }
  else if(G.opener === 0 && me.pfRaises >= 2){ combos = rangePct(0.04); label = "4ベットのレンジ"; }
  else if(me.pfRaises >= 1){ combos = spot ? fromDef(["3bet"]) : rangePct(0.06); label = "3ベットのレンジ"; }
  else if(me.pfCalls > 0 && !me.limped){ combos = spot ? fromDef(["call"]) : rangePct(0.22); label = "コールしたレンジ"; }
  else if(me.limped){ combos = rangePct(0.5); label = "リンプしたレンジ"; }
  else if(G.street > 0 || (pos === "BB" && G.raiseCount === 0)){ combos = COMBOS; label = "BBのレンジ（すべての手札）"; }
  else if(G.raiseCount === 0){ combos = rangeChart(tier); label = `${pos}でオープンできるレンジ`; }
  else if(G.raiseCount === 1 && G.opener > 0){ combos = fromDefSpot(["call","3bet"]); label = "ディフェンスするレンジ"; }
  else { combos = rangePct(0.08); label = "3ベットに続けるレンジ"; }
  return { combos, label, aggr: me.aggr.slice() };
}
function filterRange(rg, board){
  const blocked = new Uint8Array(64); board.forEach(c => blocked[c] = 1);
  return rg.combos.filter(h => {
    if(blocked[h[0]] || blocked[h[1]]) return false;
    if(board.length >= 3) for(let s = 1; s <= G.street; s++) if(rg.aggr[s] && !improves(h, board.slice(0, s + 2))) return false;
    return true;
  });
}
let rvrCache = null;
function rangeCompare(){
  const key = `${G.handNo}|${G.street}|${G.actions}`;
  if(rvrCache && rvrCache.key === key) return rvrCache.val;
  const opp = primaryOpp(); if(!opp) return null;
  const board = G.board, post = board.length >= 3;
  const oRg = oppRanges(0).find(r => r.name === opp.name), mRg = myRange();
  const side = (rg) => {
    const list = filterRange(rg, board);
    const cats = {}, cells = {};
    list.forEach(h => {
      const k = post ? postCat(h, board) : preCat(h[0], h[1]);
      cats[k] = (cats[k] || 0) + 1;
      const [r, c] = rcOf(h[0], h[1]), ck = r * 13 + c;
      (cells[ck] = cells[ck] || {})[k] = (cells[ck][k] || 0) + 1;
    });
    const n = list.length || 1;
    Object.keys(cats).forEach(k => cats[k] /= n);
    const cellCat = {};
    Object.entries(cells).forEach(([ck, m]) => { cellCat[ck] = Object.entries(m).sort((x, y) => y[1] - x[1])[0][0]; });
    return { list, cats, cellCat, n: list.length, label: rg.label };
  };
  const me = side(mRg), op = side(oRg);
  // レンジ同士の勝率
  let win = 0, it = 0;
  const known = new Uint8Array(64); board.forEach(c => known[c] = 1);
  const deck = ALL.filter(c => !known[c]);
  if(me.n && op.n) for(let k = 0; k < 2000; k++){
    const a = me.list[Math.floor(rnd() * me.n)], b = op.list[Math.floor(rnd() * op.n)];
    if(a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
    const used = new Set(a.concat(b)); const d = deck.filter(c => !used.has(c)); let len = d.length;
    const bd = board.slice(); while(bd.length < 5){ const j = Math.floor(rnd() * len); bd.push(d[j]); d[j] = d[--len]; }
    const x = evaluate(a.concat(bd)), y = evaluate(b.concat(bd));
    win += x > y ? 1 : x === y ? 0.5 : 0; it++;
  }
  const val = { me, op, opp, post, rvr: it ? win / it : 0.5 };
  rvrCache = { key, val };
  return val;
}
function rangeGrid(side, cats, mine){
  let h = "";
  for(let r = 0; r < 13; r++) for(let c = 0; c < 13; c++){
    const k = side.cellCat[r * 13 + c];
    const isMine = mine && mine[0] === r && mine[1] === c;
    h += `<i class="${k ? "rc-" + k : ""} ${isMine ? "me" : ""}"></i>`;
  }
  return `<div class="rgx">${h}</div>`;
}
function catBar(side, cats){
  return `<div class="wb" style="height:10px">${cats.map(c => side.cats[c.k] ? `<i class="rc-${c.k}" style="width:${(side.cats[c.k] * 100).toFixed(1)}%"></i>` : "").join("")}</div>`;
}
function rangePanelHTML(){
  const me = G.players[0];
  if(!cfg.advice || !me.hole.length || me.folded || G.phase === "done" || live().length < 2) return "";
  const X = rangeCompare(); if(!X) return "";
  const cats = X.post ? POST_CATS : PRE_CATS;
  const info = handInfo(cs(me.hole[0]), cs(me.hole[1]));
  const rows = cats.map(c => `<tr><td><i class="rc-${c.k}"></i>${c.name}</td><td>${pctS(X.me.cats[c.k] || 0, 0)}</td><td>${pctS(X.op.cats[c.k] || 0, 0)}</td></tr>`).join("");
  const strong = X.post ? [(X.me.cats.st || 0), (X.op.cats.st || 0)] : null;
  const adv = X.rvr >= 0.53 ? "あなたのレンジが有利" : X.rvr <= 0.47 ? `${esc(X.opp.name)}のレンジが有利` : "ほぼ互角";
  return `<div class="panel rvr">
    <div class="ptitle">レンジ比較<span class="sp"></span><small>${X.post ? "今のボードでの強さ" : "手札の種類"}で色分け</small></div>
    <div class="rvr-g">
      <div><div class="rvr-h">あなた<span>${esc(X.me.label)}・${X.me.n}通り</span></div>${rangeGrid(X.me, cats, [info.row, info.col])}${catBar(X.me, cats)}</div>
      <div><div class="rvr-h">${esc(X.opp.name)}<span>${esc(X.op.label)}・${X.op.n}通り</span></div>${rangeGrid(X.op, cats, null)}${catBar(X.op, cats)}</div>
    </div>
    <table class="rvr-t"><tr><th></th><th>あなた</th><th>${esc(X.opp.name)}</th></tr>${rows}</table>
    <div class="rvr-eq">
      <div class="rvr-eqbar"><i style="width:${(X.rvr * 100).toFixed(1)}%"></i></div>
      <div class="rvr-eqt"><span>あなた <b>${pctS(X.rvr, 0)}</b></span><span class="c">${adv}</span><span><b>${pctS(1 - X.rvr, 0)}</b> ${esc(X.opp.name)}</span></div>
    </div>
    <p class="sub" style="margin-top:8px">レンジ同士で戦った時の勝率です（あなたの今の手札1つではなく、このアクションをする時にあり得る手札全体）。${strong ? `強い役の割合は あなた${pctS(strong[0],0)}・${esc(X.opp.name)}${pctS(strong[1],0)}${strong[0] > strong[1] + 0.03 ? "で、ナッツに近い手札はあなたの方が多い（大きく打ちやすい）" : strong[1] > strong[0] + 0.03 ? "で、強い手札は相手の方が多い（大きく打たれたら慎重に）" : ""}。` : "ピンクの枠があなたの今の手札です。"}</p>
  </div>`;
}
function stackBar(bw, h){
  return `<div class="wb" style="height:${h}px">${BUCKETS.map(b => bw[b.k] > 0.004 ? `<i class="${b.k}" style="width:${(bw[b.k] * 100).toFixed(1)}%"></i>` : "").join("")}</div>`;
}
function whyPanelHTML(){
  const me = G.players[0];
  if(!cfg.advice || !me.hole.length || me.folded || G.phase === "done" || live().length < 2) return "";
  const W = whyBreakdown(); if(!W) return "";
  const myTurn = G.phase === "play" && G.toAct === 0;
  const a = myTurn ? advise() : liveEquity();
  const legend = BUCKETS.map(b => W.bw[b.k] > 0.004 ? `<div class="wl"><i class="${b.k}"></i><span class="n">${b.name}</span><b>${pctS(W.bw[b.k], 0)}</b><span class="e">${W.ex[b.k].join(" ")}</span></div>` : "").join("");
  const ab = W.ahead != null ? `
    <div class="wab">
      <div class="wab-row"><span class="t">今リード</span><div class="wab-bar"><i class="up" style="width:${(W.ahead*100).toFixed(1)}%"></i></div><b>${pctS(W.ahead,0)}</b>
        <span class="arw">→ そのまま勝つ</span><b class="g">${pctS(W.keep,0)}</b></div>
      <div class="wab-row"><span class="t">今負け</span><div class="wab-bar"><i class="dn" style="width:${(W.behind*100).toFixed(1)}%"></i></div><b>${pctS(W.behind,0)}</b>
        <span class="arw">→ 逆転</span><b class="o">${pctS(W.comeback,0)}</b></div>
      <div class="wab-f">勝率 ≒ ${pctS(W.ahead,0)}×${pctS(W.keep,0)} ＋ ${pctS(W.behind,0)}×${pctS(W.comeback,0)}${W.tie > 0.01 ? ` ＋ 引分の半分` : ""} ＝ <b>${pctS(W.eqHU,0)}</b></div>
    </div>` : "";
  const all = liveEquity().eq;
  const multi = W.multi > 1 ? `<p class="wm">相手が${W.multi}人いるので、全員に勝たないとポットを取れません。${esc(W.opp.name)}1人に対しては${pctS(W.eqHU,0)}でも、残っている全員が相手だと <b>${pctS(all,0)}</b> まで下がります${a.kind === "defend" ? "（ディフェンスの判断は、オープンした人との勝率に、後ろの人の分の余裕を足した必要勝率で比べています）" : ""}</p>` : "";
  return `<div class="panel why">
    <div class="ptitle">なぜこの勝率？<span class="sp"></span><small>${esc(W.opp.name)}の${esc(W.label)}</small></div>
    <p class="sub" style="margin-bottom:6px">相手のレンジ（考えられる手札${W.combos}通り）を、あなたの手札との相性で色分け</p>
    ${stackBar(W.bw, 16)}
    <div class="wls">${legend}</div>
    ${ab}${multi}
  </div>`;
}
function feltWhyHTML(){
  const W = whyBreakdown(); if(!W) return "";
  const fav = W.bw.b4 + W.bw.b3, bad = W.bw.b1 + W.bw.b0;
  return `<div class="fw">${stackBar(W.bw, 7)}
    <div class="fw-t">${W.ahead != null ? `今リード<b>${pctS(W.ahead,0)}</b>・逆転<b>${pctS(W.comeback,0)}</b>` : `有利<b class="g">${pctS(fav,0)}</b>・不利<b class="o">${pctS(bad,0)}</b>`}</div></div>`;
}
function ringSeatHTML(p, pt, pos){
  if(p.out) return `<div class="rg-seat out" style="left:${pt.x}%;top:${pt.y}%"><div class="nm">${esc(p.name)}</div><div class="sub">敗退</div></div>`;
  const turn = G.phase === "play" && G.toAct === p.id;
  const show = p.shown || (ui.reveal && G.phase === "done");
  const win = G.phase === "done" && p.won > 0;
  const cards = p.folded && !show ? "" : `<div class="cards">${p.hole.map(c => show ? card(cs(c), "xs") : `<span class="card xs back"></span>`).join("")}</div>`;
  return `<div class="rg-seat ${turn ? "turn" : ""} ${p.folded ? "fold" : ""} ${win ? "win" : ""}" style="left:${pt.x}%;top:${pt.y}%">
    ${pt.extra || ""}${cards}
    <div class="nm">${esc(p.name)}${pos.name ? `<span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span>` : ""}</div>
    <div class="stk">${fmt(p.stack)}</div>
    <div class="act">${turn ? "考え中…" : win ? `<b>+${fmt(p.won)}</b>` : p.act || p.style.n}${p.shown && p.score ? `・${CAT_NAME[catOf(p.score)]}` : ""}</div>
  </div>`;
}
function mySeatHTML(p, pt, pos){
  const turn = G.phase === "play" && G.toAct === 0, win = G.phase === "done" && p.won > 0;
  return `<div class="rg-seat me ${turn ? "turn" : ""} ${p.folded ? "fold" : ""} ${win ? "win" : ""}" style="left:${pt.x}%;top:${pt.y}%">
    ${pt.extra || ""}
    <div class="nm">あなた<span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span></div>
    <div class="stk">${fmt(p.stack)}</div>
    <div class="act">${turn ? "あなたの番" : win ? `<b>+${fmt(p.won)}</b>` : p.act || "&nbsp;"}</div>
  </div>`;
}
// 画面下に固定：自分の手札（スクロールしなくても常に見える）
function myStripHTML(){
  const me = G.players[0];
  if(!me.hole.length) return "";
  const pos = posInfo(0);
  const hand = me.folded ? "フォールド" : G.board.length ? CAT_NAME[catOf(evaluate(me.hole.concat(G.board)))] : tierBadgeText(me);
  const won = G.phase === "done" && me.won > 0;
  return `<div class="ms ${me.folded ? "fold" : ""} ${won ? "win" : ""}">
    <div class="cards">${me.hole.map(c => card(cs(c), "md")).join("")}</div>
    <div class="ms-i">
      <div class="ms-h">${hand}</div>
      <div class="ms-s"><span class="pr-pos ${pos.name === "BTN" ? "btn" : ""}">${pos.name}</span><b>${fmt(me.stack)}</b><span>${(me.stack / G.bb).toFixed(1)}BB${me.bet ? `・ベット中 ${fmt(me.bet)}` : ""}${won ? `・<b class="plus">+${fmt(me.won)}</b>` : ""}</span></div>
    </div>
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
  const good = a.toCall ? a.eqR >= a.need : a.eq >= 0.5;
  return `<div class="panel pr-adv">
    <div class="ptitle">GTO的な目安<span class="sp"></span><small>${a.ranges.map(r => r.label).filter((v, i, x) => x.indexOf(v) === i).join("・")}</small></div>
    <div class="big four">
      <div><span>推定勝率</span><b>${pctS(a.eq, 0)}</b></div>
      <div><span>実現率</span><b>×${a.R.toFixed(2)}</b><span>${a.ip ? "インポジ" : "アウトオブ"}</span></div>
      <div><span>実現後</span><b style="color:${good ? "#7ff0ff" : "inherit"}">${pctS(a.eqR, 0)}</b></div>
      <div><span>必要勝率</span><b>${a.toCall ? pctS(a.need, 0) : "—"}</b></div>
    </div>
    ${a.toCall ? `<p class="sub" style="margin-bottom:8px">必要勝率 = コール ${fmt(a.toCall)} ÷（ブラインド・アンティ込みのポット ${fmt(a.pot)} ＋ コール）${a.need > a.req + 0.001 ? `＋ 後ろの人などの余裕 ${pctS(a.need - a.req, 0)}` : ""}。コールの期待値 ${a.ev >= 0 ? "+" : "−"}${fmt(Math.abs(a.ev))}</p>` : ""}
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
// 13×13の表を描く（cellFn(r,c) → { cls, title }）
function gridHTML(cellFn, mine, onTap){
  let h = "";
  for(let r = 0; r < 13; r++) for(let c = 0; c < 13; c++){
    const x = cellFn(r, c);
    const isMine = mine && mine[0] === r && mine[1] === c;
    h += `<div class="hc ${x.cls} ${isMine ? "mine" : ""}" ${onTap ? `onclick="${onTap}(${r},${c})"` : ""}>${clsName(r, c)}</div>`;
  }
  return `<div class="hgrid mini">${h}</div>`;
}
const DEF_CLS = { "3bet":"d3", call:"dc", fold:"df" };
const DEF_NAME = { "3bet":"3ベット", call:"コール", fold:"フォールド" };
function defLegend(dc){
  return `<div class="dlg"><span><i class="d3"></i>3ベット ${pctS(dc.freq.r3,0)}</span><span><i class="dc"></i>コール ${pctS(dc.freq.call,0)}</span><span><i class="df"></i>フォールド ${pctS(dc.freq.fold,0)}</span>
    <span class="sub">ディフェンス合計 ${pctS(dc.freq.r3 + dc.freq.call,0)}</span></div>`;
}
function openGrid(tier, mine){
  return gridHTML((r, c) => { const code = CHART[r][c]; return { cls: `${code} ${TIERS[code] > tier ? "dim" : ""}` }; }, mine);
}
// あなたの手札 vs 各ポジションのオープン（同じレイズ額・デッドマネーで比較）
function posTable(spot, hole){
  const key = `${G.handNo}|pt|${JSON.stringify(spot)}`;
  if(cache.pt && cache.pt.key === key) return cache.pt.val;
  const heroI = PF_ORDER.indexOf(spot.hero);
  const present = G.seats.map(i => posInfo(i).name);
  const names = PF_ORDER.filter((p, i) => p !== spot.hero && (spot.hero === "BB" || i < heroI) && present.includes(p));
  const info0 = handInfo(cs(hole[0]), cs(hole[1]));
  const rows = names.map(op => {
    const tier = POS_TIER[op];
    if(op === spot.opener){                                // 今の場面は表・おすすめと同じ値を使う
      const g = defenseChart(spot).grid[info0.row][info0.col], dc = defenseChart(spot);
      return { op, eq:g.eq, R:g.R, eqR:g.eqR, need:dc.need, act:g.act, cur:true };
    }
    const eq = equityRange(hole, [], [{ combos: rangeChart(tier), aggr: [] }], 4000, 0);
    const ip = ipVs(spot.hero, op), R = realize(ip, 0, hole[0], hole[1], eq), eqR = eq * R;
    const toCall = spot.openBB - spot.postedBB, req = toCall / (spot.potBB + toCall), need = req + 0.015 * spot.behind + 0.02 * spot.callers;
    const info = handInfo(cs(hole[0]), cs(hole[1]));
    return { op, eq, R, eqR, need, act: decideDef(eq, eqR, need, info.name, tier), cur: op === spot.opener };
  });
  cache.pt = { key, val: rows };
  return rows;
}
function chartHTML(){
  const me = G.players[0], info = handInfo(cs(me.hole[0]), cs(me.hole[1])), mine = [info.row, info.col];
  const ps = G.street === 0 && G.phase === "play" && G.toAct === 0 ? (advise(), G.pfSpot) : G.pfSpot;
  const browse = `<button class="btn sm" onclick="Practice.browser()">レンジ表を見る</button>`;
  const ref = G.street > 0 || G.phase === "done" ? "（プリフロップの判断）" : "";
  if(ps && ps.kind === "defend"){
    const s = ps.spot, dc = defenseChart(s);
    const cell = dc.grid[info.row][info.col];
    const rows = posTable(s, ps.hole);
    return `<div class="panel">
      <div class="ptitle">ディフェンス表${ref}<span class="sp"></span>${browse}</div>
      <p class="sub" style="margin-bottom:8px">あなた ${s.hero} vs ${esc(s.openerName)} ${s.opener} の ${s.openBB}BBオープン。${dc.ip ? "インポジション" : "アウトオブポジション"}・必要勝率 ${pctS(dc.need,0)}</p>
      ${gridHTML((r, c) => ({ cls: DEF_CLS[dc.grid[r][c].act] }), mine)}
      ${defLegend(dc)}
      <div class="dme"><b>${info.name}</b>：推定勝率 ${pctS(cell.eq,0)} × 実現率 ${cell.R.toFixed(2)} = <b>${pctS(cell.eqR,0)}</b>　→　<b class="${DEF_CLS[cell.act]}t">${DEF_NAME[cell.act]}</b></div>
      <div class="ptitle" style="margin-top:12px;font-size:13px">あなたの手札 vs 各ポジションのオープン</div>
      <table class="pr-pt"><tr><th>オープン</th><th>推定勝率</th><th>実現率</th><th>実現後</th><th>必要</th><th>判断</th></tr>
        ${rows.map(x => `<tr class="${x.cur ? "mine" : ""}"><td>${x.op}${x.cur ? "（今）" : ""}</td><td>${pctS(x.eq,0)}</td><td>×${x.R.toFixed(2)}</td><td>${pctS(x.eqR,0)}</td><td>${pctS(x.need,0)}</td><td class="${DEF_CLS[x.act]}t">${DEF_NAME[x.act]}</td></tr>`).join("")}
      </table>
      <p class="sub" style="margin-top:8px">前のポジションほどオープンレンジが強いので勝率が下がり、ディフェンスできる手札が減ります。BBはアウトオブポジション（SBのオープンに対してだけインポジション）なので実現率が低くなります</p>
    </div>`;
  }
  if(ps && ps.kind === "vs3bet" || G.raiseCount >= 2 && G.street === 0){
    return `<div class="panel"><div class="ptitle">プリフロップ表${ref}<span class="sp"></span>${browse}</div>
      <p class="sub">3ベット以上を受けた場面は、オープン表・ディフェンス表の対象外です。相手のレンジ（上位約6%）に対する勝率と実現率で判断します</p></div>`;
  }
  const pos = ps && ps.pos ? ps.pos : posInfo(0).name, tier = POS_TIER[pos] ?? 4;
  return `<div class="panel">
    <div class="ptitle">オープンレンジ表${ref}<span class="sp"></span>${browse}</div>
    <p class="sub" style="margin-bottom:8px">誰もレイズしていない時に、あなた（${pos}）から最初にレイズする範囲。明るいマスが ${pos} のオープン範囲、ピンクの枠があなたの手札（<span class="tier ${info.code}" style="padding:1px 6px">${info.name}・${TIER_LABEL[info.tier]}</span>）</p>
    ${openGrid(tier, mine)}
  </div>`;
}

// ---------------------------------------------------------------------
//  レンジ表ブラウザ（好きなポジションの組み合わせで見る）
// ---------------------------------------------------------------------
let rb = { hero:"BB", opener:"BTN", size:2.5, cell:null };
function browserHTML(){
  const heroI = PF_ORDER.indexOf(rb.hero);
  const openers = rb.hero === "BB" ? PF_ORDER.filter(p => p !== "BB") : PF_ORDER.slice(0, heroI);
  if(rb.opener !== "none" && !openers.includes(rb.opener)) rb.opener = "none";
  const seg = (vals, cur, fn) => `<div class="pr-seg wrap">${vals.map(([v, l]) => `<button class="${cur === v ? "on" : ""}" onclick="Practice.rb('${fn}','${v}')">${l}</button>`).join("")}</div>`;
  let body;
  const anteBB = cfg.ante === "none" ? 0 : cfg.ante === "bb" ? 1 : 9 / 8;
  if(rb.opener === "none"){
    const tier = POS_TIER[rb.hero];
    let w = 0, t = 0; for(let r = 0; r < 13; r++) for(let c = 0; c < 13; c++){ t += clsWeight(r, c); if(TIERS[CHART[r][c]] <= tier) w += clsWeight(r, c); }
    body = `<p class="sub" style="margin:8px 0">${rb.hero} のオープンレンジ（全体の約${pctS(w / t, 0)}）。写真のチャートどおり</p>${openGrid(tier, null)}`;
  }else{
    const posted = rb.hero === "BB" ? 1 : rb.hero === "SB" ? 0.5 : 0;
    const opPosted = rb.opener === "SB" ? 0.5 : 0;
    const potBB = +(1.5 + anteBB + rb.size - opPosted).toFixed(2);
    const pfI = PF_ORDER.indexOf(rb.hero);
    const behind = rb.hero === "BB" ? 0 : rb.hero === "SB" ? 1 : PF_ORDER.length - 1 - pfI;
    const dc = defenseChart({ hero: rb.hero, opener: rb.opener, openBB: rb.size, postedBB: posted, potBB, behind, callers: 0 });
    const sel = rb.cell ? dc.grid[rb.cell[0]][rb.cell[1]] : null;
    body = `<p class="sub" style="margin:8px 0">${rb.hero} vs ${rb.opener} の${rb.size}BBオープン（${dc.ip ? "インポジション" : "アウトオブポジション"}）。アンティ${cfg.ante === "none" ? "なし" : cfg.ante === "bb" ? "BB" : "全員"}・必要勝率 ${pctS(dc.need,0)}</p>
      ${gridHTML((r, c) => ({ cls: DEF_CLS[dc.grid[r][c].act] }), rb.cell, "Practice.rbCell")}
      ${defLegend(dc)}
      ${sel ? `<div class="dme"><b>${sel.name}</b>：推定勝率 ${pctS(sel.eq,0)} × 実現率 ${sel.R.toFixed(2)} = <b>${pctS(sel.eqR,0)}</b>（必要 ${pctS(dc.need,0)}）→ <b class="${DEF_CLS[sel.act]}t">${DEF_NAME[sel.act]}</b></div>` : `<p class="sub" style="margin-top:6px">マスをタップすると、その手札の勝率と実現率が出ます</p>`}`;
  }
  return `<h2>レンジ表<span class="sp"></span><button class="x" onclick="closeModal()">✕</button></h2>
    <div class="pr-lbl" style="margin-top:0">あなたのポジション</div>${seg(PF_ORDER.map(p => [p, p]), rb.hero, "hero")}
    <div class="pr-lbl">先にオープンした人</div>${seg([["none","なし（自分がオープン）"]].concat(openers.map(p => [p, p])), rb.opener, "opener")}
    ${rb.opener !== "none" ? `<div class="pr-lbl">オープンの額</div>${seg([["2.2","2.2BB"],["2.5","2.5BB"],["3","3BB"]], String(rb.size), "size")}` : ""}
    ${body}
    <p class="sub" style="margin-top:10px">ディフェンス表は、相手のオープンレンジに対する勝率・実現率・必要勝率（ブラインドとアンティのデッドマネー込み）から計算した目安です（ソルバーの解ではありません）</p>`;
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
  return `<div class="pr-bar ${myTurn ? "turn" : ""}"><div class="in">${myStripHTML()}${inner}</div></div>`;
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
  browser(){ rb.cell = null; if(G && G.players && G.players[0].hole.length){ const p = posInfo(0).name; if(PF_ORDER.includes(p)) rb.hero = p; const o = G.opener >= 0 ? posInfo(G.opener).name : null; if(o) rb.opener = o; }
    openModal(browserHTML()); },
  rb(k, v){ rb[k] = k === "size" ? Number(v) : v; rb.cell = null; openModal(browserHTML()); },
  rbCell(r, c){ rb.cell = [r, c]; openModal(browserHTML()); },
  // テスト用
  _sim(n){ return simulate(n); },
  _def(o){ const d = defenseChart(o); return d.freq; }
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
