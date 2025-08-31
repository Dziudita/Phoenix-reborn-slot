// --- CSV loader (stops + final_multiplier). Win skaičiuosim patys, o FS prioritetas = final_multiplier
async function loadCSV(path) {
  const txt = await fetch(path).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}`);
    return r.text();
  });
  const lines = txt.trim().split(/\r?\n/);
  const header = lines.shift(); // simulation_id,weight,events_json,final_multiplier
  return lines.filter(Boolean).map(line => {
    const firstComma  = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    const lastComma   = line.lastIndexOf(",");
    const simulation_id = line.slice(0, firstComma).trim();
    const weight        = Number(line.slice(firstComma + 1, secondComma).trim());
    let jsonRaw         = line.slice(secondComma + 1, lastComma).trim();
    let jsonFixed = jsonRaw.replaceAll('""','"');
    if (jsonFixed.startsWith('"') && jsonFixed.endsWith('"')) jsonFixed = jsonFixed.slice(1, -1);
    let events = {};
    try { events = JSON.parse(jsonFixed); } catch(e){ events = {}; }
    const final_mult = Number(line.slice(lastComma + 1).trim() || "0");
    return { simulation_id, weight, events, final_multiplier: final_mult };
  });
}

// ---- SYMBOLS & PAYTABLE ----
const SYM = { FIRE:0, AIR:1, EARTH:2, WATER:3, A:4, K:5, Q:6, J:7, SCATTER:8, WILD:9 };
const SYMBOL_POOL = [SYM.FIRE,SYM.AIR,SYM.EARTH,SYM.WATER,SYM.A,SYM.K,SYM.Q,SYM.J,SYM.SCATTER,SYM.WILD];

// Paytable (multiplier on bet)
const PAY = {
  [SYM.FIRE]:  {3:10,4:30,5:80},
  [SYM.AIR]:   {3:8, 4:20,5:60},
  [SYM.EARTH]: {3:6, 4:16,5:50},
  [SYM.WATER]: {3:5, 4:12,5:40},
  [SYM.A]:     {3:4, 4:10,5:30},
  [SYM.K]:     {3:3, 4:8, 5:25},
  [SYM.Q]:     {3:2, 4:6, 5:20},
  [SYM.J]:     {3:2, 4:5, 5:15},
};
const IS_WILD    = s => s === SYM.WILD;
const IS_SCATTER = s => s === SYM.SCATTER;

// 20 paylines (row 0..2)
const PAYLINES = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
  [0,0,1,0,0],[2,2,1,2,2],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
  [2,1,1,1,2],[0,1,0,1,0],[2,1,2,1,2],[1,1,0,1,1],[1,1,2,1,1],
  [0,2,0,2,0],[2,0,2,0,2],[1,0,1,0,1],[1,2,1,2,1],[0,2,2,2,0],
];

// ---- DOM refs ----
const reelsEl   = document.getElementById("reels");
const balanceEl = document.getElementById("balance");
const winEl     = document.getElementById("win");
const betEl     = document.getElementById("bet");
const spinBtn   = document.getElementById("spin");
const buyBtn    = document.getElementById("bonusBuy");
const betMinus  = document.getElementById("betMinus");
const betPlus   = document.getElementById("betPlus");

// Bonus Buy modal
const buyModal    = document.getElementById("buyModal");
const buyLightBtn = document.getElementById("buyLight");
const buyDarkBtn  = document.getElementById("buyDark");
const closeBuy    = document.getElementById("closeBuy");
const priceLightEl= document.getElementById("priceLight");
const priceDarkEl = document.getElementById("priceDark");

// ---- State ----
let outcomes = [];
let outcomesLight = [];
let outcomesDark  = [];
let balance = 1000;
let bet = 0.10;
let betIndex = 0;
let isSpinning = false;

// ---- BET LADDER ----
const BET_STEPS = [0.10,0.20,0.40,0.60,0.80,1.00,1.20,1.40,1.60,2.00,3.00,5.00];
function setBetByIndex(i){
  betIndex = Math.max(0, Math.min(BET_STEPS.length-1, i));
  bet = BET_STEPS[betIndex];
  betEl.textContent = format(bet);
}
betMinus.onclick = ()=> setBetByIndex(betIndex-1);
betPlus.onclick  = ()=> setBetByIndex(betIndex+1);
setBetByIndex(0);

// ---- Bonus Buy kainos pagal bet ----
function getBonusPrices(b){
  return { light: b*125, dark: b*200 };
}

// ---- Helpers ----
function format(n){ return Number(n).toFixed(2); }

// ---- UI init ----
function drawPlaceholders(){
  reelsEl.querySelectorAll(".reel").forEach((col, i) => {
    col.innerHTML = "";
    for (let r=0;r<3;r++){
      const cell = document.createElement("div");
      cell.className = "symbol";
      cell.textContent = ["A","K","Q","J","🜂","🜁","🜃","🜄","🥚","🔥"][(i*3+r)%10];
      col.appendChild(cell);
    }
  });
}
drawPlaceholders();

// --- eval helpers ---
function symbolAt(stops, col, row){
  const startIdx = stops[col] || 0;
  return SYMBOL_POOL[(startIdx + row) % SYMBOL_POOL.length];
}
function countScatters(stops){
  let c=0; for(let col=0;col<5;col++){ for(let row=0;row<3;row++){ if (IS_SCATTER(symbolAt(stops,col,row))) c++; } }
  return c;
}
function evalLine(stops, line){
  const seq = line.map((row,col)=> symbolAt(stops,col,row));
  if (IS_SCATTER(seq[0])) return {mult:0,positions:[]}; // scatter pirmos kolonos neima
  let base = null;
  for (const s of seq){ if (!IS_WILD(s) && !IS_SCATTER(s)){ base = s; break; } }
  if (base===null) return {mult:0,positions:[]};
  let cnt=0; for (const s of seq){ if (s===base || IS_WILD(s)) cnt++; else break; }
  if (cnt<3) return {mult:0,positions:[]};
  const mult = (PAY[base]||{})[cnt]||0;
  if (!mult) return {mult:0,positions:[]};
  const positions = Array.from({length:cnt}, (_,i)=>[i, line[i]]);
  return {mult, positions};
}
function evalSpin(stops){
  let totalMult=0; let winPositions=[];
  for (const line of PAYLINES){
    const res = evalLine(stops, line);
    if (res.mult>0){ totalMult+=res.mult; winPositions.push(...res.positions); }
  }
  const scatters = countScatters(stops);
  return { totalMult, winPositions, scatters };
}

// --- animacija ---
function setReelSymbols(colIndex, startIndex){
  const poolChars = ["🜂","🜁","🜃","🜄","A","K","Q","J","🥚","🔥"];
  const col = reelsEl.children[colIndex];
  col.querySelectorAll(".symbol").forEach((cell, r)=>{
    cell.textContent = poolChars[(startIndex + r) % poolChars.length];
  });
}
function flashWin(){ reelsEl.classList.remove("winflash"); void reelsEl.offsetWidth; reelsEl.classList.add("winflash"); }
async function spinAnimate(targetStops, baseDuration = 720, stagger = 160){
  reelsEl.querySelectorAll(".symbol").forEach(n=>n.classList.remove("win-cell","stop"));
  const durations = Array.from({length:5}, (_,i)=> baseDuration + i*stagger);
  const start = performance.now();
  [...reelsEl.children].forEach(r => r.classList.add("spin"));
  return new Promise(resolve=>{
    function frame(t){
      let allDone = true;
      for(let i=0;i<5;i++){
        const elapsed = t - start, d = durations[i];
        if (elapsed < d){ allDone = false; const tick = Math.floor(elapsed / 70); setReelSymbols(i, tick); }
        else { setReelSymbols(i, targetStops[i] || 0); }
      }
      if (!allDone) requestAnimationFrame(frame);
      else {
        [...reelsEl.children].forEach(r => r.classList.remove("spin"));
        reelsEl.querySelectorAll(".reel").forEach(col=>{ col.querySelectorAll(".symbol")[1]?.classList.add("stop"); });
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
function highlightPositions(positions=[]) {
  const cols = reelsEl.querySelectorAll(".reel");
  positions.forEach(([c,r])=> cols[c]?.querySelectorAll(".symbol")[r]?.classList.add("win-cell"));
}

// ---- Toast ----
function toast(msg){
  const n = document.createElement('div');
  n.textContent = msg;
  n.style.position='fixed'; n.style.left='50%'; n.style.top='16px';
  n.style.transform='translateX(-50%)';
  n.style.padding='10px 14px'; n.style.borderRadius='10px';
  n.style.background='rgba(0,0,0,.7)'; n.style.color='#fff';
  n.style.zIndex='80'; n.style.fontWeight='800';
  document.body.appendChild(n);
  setTimeout(()=> n.remove(), 1200);
}

// ---- Weighted pick ----
function weightedPick(list){
  const totalW = list.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = list[0];
  for (const o of list){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }
  return chosen;
}

// ---- Free Spins (Light/Dark) ----
// DARK: global multiplier start x2, +1x už bet kokį scatter spin'e (taikomas TIK jei nenaudojam final_multiplier)
async function runFreeSpins(mode){
  spinBtn.disabled = true; buyBtn.disabled = true;

  const spins = mode==='light' ? 10 : 7;
  let gmult = (mode==='dark') ? 2 : 1;
  let fsWin = 0;

  toast(mode==='light'?'Light FS! 🕊️':'Dark FS! 🦅');

  for (let i=0;i<spins;i++){
    const src = mode==='light' ? outcomesLight : outcomesDark;
    if (!src?.length) break;

    const chosen = weightedPick(src);
    const stops = chosen.events.stops || [0,0,0,0,0];

    // animacija
    await spinAnimate(stops, 580, 100);

    // 1) bandome naudoti CSV final_multiplier
    const hasFinal = typeof chosen.final_multiplier === 'number' && chosen.final_multiplier > 0;
    const evalRes = evalSpin(stops);
    let multApplied = hasFinal ? chosen.final_multiplier : evalRes.totalMult;

    // 2) DARK global multiplier taikomas tik kai nenaudojam final_multiplier
    if (!hasFinal && mode==='dark') {
      multApplied *= gmult;
    }

    const payout = bet * multApplied;
    balance += payout; fsWin += payout;

    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();
    highlightPositions(evalRes.winPositions);

    // DARK: +1x jei tame FS sukimę yra bent vienas scatter (tik kitam sukimui)
    if (mode==='dark'){
      const scat = countScatters(stops);
      if (scat >= 1 && !hasFinal) gmult += 1;
    }

    await new Promise(r=> setTimeout(r, 350));
  }

  spinBtn.disabled = false; buyBtn.disabled = false;
}

// ---- Init ----
async function init(){
  try { outcomes      = await loadCSV("./math/outcomes_base.csv"); } catch(e){ console.warn(e); }
  try { outcomesLight = await loadCSV("./math/outcomes_light.csv"); } catch(e){ /* ok */ }
  try { outcomesDark  = await loadCSV("./math/outcomes_dark.csv"); } catch(e){ /* ok */ }
}
init();

// ---- Spin (base) ----
spinBtn.onclick = async () => {
  if (!outcomes.length) return;
  if (balance < bet) return alert("Not enough balance.");
  if (isSpinning) return;
  isSpinning = true; spinBtn.disabled = true;

  balance -= bet; balanceEl.textContent = format(balance); winEl.textContent = "0.00";

  const chosen = weightedPick(outcomes);
  const stops = chosen.events.stops || [0,0,0,0,0];

  await spinAnimate(stops);

  const { totalMult, winPositions, scatters } = evalSpin(stops);
  const payout = bet * totalMult;
  balance += payout;
  winEl.textContent = format(payout);
  balanceEl.textContent = format(balance);
  if (payout>0) flashWin(); highlightPositions(winPositions);

  // 3 scatters -> Light FS; 4+ scatters -> Dark FS
  if (scatters >= 3){
    await runFreeSpins(scatters>=4 ? 'dark' : 'light');
  }

  isSpinning = false; spinBtn.disabled = false;
};

// ---- Bonus Buy ----
function openBuy(){ 
  const { light, dark } = getBonusPrices(bet);
  priceLightEl.textContent = format(light);
  priceDarkEl.textContent  = format(dark);
  buyModal.classList.remove("hidden");
  spinBtn.disabled = true; buyBtn.disabled = true;
}
function closeBuyFn(){
  buyModal.classList.add("hidden");
  spinBtn.disabled = false; buyBtn.disabled = false;
}
closeBuy.onclick = closeBuyFn;

buyBtn.onclick = ()=> openBuy();

buyLightBtn.onclick = async ()=>{
  const { light } = getBonusPrices(bet);
  if (balance < light) return alert("Not enough balance.");
  balance -= light; balanceEl.textContent = format(balance);
  closeBuyFn(); await runFreeSpins('light');
};
buyDarkBtn.onclick = async ()=>{
  const { dark } = getBonusPrices(bet);
  if (balance < dark) return alert("Not enough balance.");
  balance -= dark; balanceEl.textContent = format(balance);
  closeBuyFn(); await runFreeSpins('dark');
};
