// --- CSV loader (stops + optional features). final_multiplier ignoruosim, win skaičiuosim patys
async function loadCSV(path) {
  const txt = await fetch(path).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}`);
    return r.text();
  });
  const lines = txt.trim().split(/\r?\n/);
  lines.shift(); // header
  return lines.filter(Boolean).map(line => {
    const firstComma  = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    const lastComma   = line.lastIndexOf(",");
    const simulation_id = line.slice(0, firstComma).trim();
    const weight        = Number(line.slice(firstComma + 1, secondComma).trim());
    let jsonRaw         = line.slice(secondComma + 1, lastComma).trim();
    let jsonFixed = jsonRaw.replaceAll('""','"');
    if (jsonFixed.startsWith('"') && jsonFixed.endsWith('"')) jsonFixed = jsonFixed.slice(1, -1);
    const events = JSON.parse(jsonFixed);
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

// Free Spins choice modal (triggered base)
const modal       = document.getElementById("bonusModal");
const chooseLight = document.getElementById("chooseLight");
const chooseDark  = document.getElementById("chooseDark");
const closeModal  = document.getElementById("closeModal");

// Bonus Buy modal (new)
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
let bet = 1.0;
let isSpinning = false;

// BONUS BUY kainos (x bet) — ĮDĖK SAVO SKAIČIUS IŠ SIMULIACIJOS
// pvz. jei lentelėj gavosi bb_price_light_xbet=85.4 → dėk 85
const BONUS_PRICE_LIGHT = 85;   // TODO: pakeisk pagal savo sim rezultatus
const BONUS_PRICE_DARK  = 115;  // TODO: pakeisk pagal savo sim rezultatus

function format(n){ return Number(n).toFixed(2); }
function setBet(v){
  bet = Math.max(0.1, Math.min(100, Math.round(v*100)/100));
  betEl.textContent = format(bet);
}

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
  if (IS_SCATTER(seq[0])) return {mult:0,positions:[]};
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
  const scatters = countScatters(stops);
  const features = [];
  if (scatters>=3) features.push("FREESPIN_START");
  for (const line of PAYLINES){
    const res = evalLine(stops, line);
    if (res.mult>0){ totalMult+=res.mult; winPositions.push(...res.positions); }
  }
  return { totalMult, winPositions, features };
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

// ---- Modals ----
function openModal(){ modal.classList.remove("hidden"); buyBtn.disabled = true; }
function closeModalFn(){ modal.classList.add("hidden"); buyBtn.disabled = false; }
closeModal.onclick = closeModalFn;

function openBuy(){ 
  // rodom kainas pagal dabartinį BET
  const costLight = bet * BONUS_PRICE_LIGHT;
  const costDark  = bet * BONUS_PRICE_DARK;
  priceLightEl.textContent = `${format(costLight)}`;
  priceDarkEl.textContent  = `${format(costDark)}`;
  buyModal.classList.remove("hidden");
  spinBtn.disabled = true;
  buyBtn.disabled = true;
}
function closeBuyFn(){
  buyModal.classList.add("hidden");
  spinBtn.disabled = false;
  buyBtn.disabled = false;
}
closeBuy.onclick = closeBuyFn;

// ---- FS paleidimas (Light/Dark) iš CSV
function playFrom(list){
  if (!list?.length) return alert("No Free Spins data yet (demo).");
  // weighted pick
  const totalW = list.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = list[0];
  for (const o of list){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }
  const stops = chosen.events.stops || [0,0,0,0,0];

  spinAnimate(stops, 600, 100).then(()=>{
    const { totalMult, winPositions } = evalSpin(stops);
    const payout = bet * totalMult;
    balance += payout;
    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();
    highlightPositions(winPositions);
  });
}
chooseLight.onclick = ()=>{ closeModalFn(); playFrom(outcomesLight); };
chooseDark.onclick  = ()=>{ closeModalFn(); playFrom(outcomesDark);  };

// ---- Init ----
async function init(){
  try { outcomes      = await loadCSV("./math/outcomes_base.csv"); } catch(e){ console.warn(e); }
  try { outcomesLight = await loadCSV("./math/outcomes_light.csv"); } catch(e){ /* ok */ }
  try { outcomesDark  = await loadCSV("./math/outcomes_dark.csv"); } catch(e){ /* ok */ }
}
init();

// ---- Spin ----
spinBtn.onclick = async () => {
  if (!outcomes.length) return;
  if (balance < bet) return alert("Not enough balance (demo).");
  if (isSpinning) return;
  isSpinning = true; spinBtn.disabled = true;

  balance -= bet;
  balanceEl.textContent = format(balance);
  winEl.textContent = "0.00";

  // pick outcome by weight
  const totalW = outcomes.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = outcomes[0];
  for (const o of outcomes){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }
  const stops = chosen.events.stops || [0,0,0,0,0];

  await spinAnimate(stops);

  const { totalMult, winPositions, features } = evalSpin(stops);
  const payout = bet * totalMult;
  balance += payout;
  winEl.textContent = format(payout);
  balanceEl.textContent = format(balance);
  if (payout>0) flashWin();
  highlightPositions(winPositions);

  if (features.includes("FREESPIN_START") || (chosen.events.features||[]).includes("FREESPIN_START")){
    openModal(); // Light/Dark pasirinkimas už base trigger
  }

  isSpinning = false; spinBtn.disabled = false;
};

// ---- Bonus Buy ----
buyBtn.onclick = () => { openBuy(); };

// Buy Light
buyLightBtn.onclick = ()=>{
  const cost = bet * BONUS_PRICE_LIGHT;
  if (balance < cost) return alert("Not enough balance for Light FS.");
  balance -= cost; balanceEl.textContent = format(balance);
  closeBuyFn();
  // perkam Light → tiesiai FS (be pasirinkimo modalo)
  playFrom(outcomesLight);
};

// Buy Dark
buyDarkBtn.onclick = ()=>{
  const cost = bet * BONUS_PRICE_DARK;
  if (balance < cost) return alert("Not enough balance for Dark FS.");
  balance -= cost; balanceEl.textContent = format(balance);
  closeBuyFn();
  playFrom(outcomesDark);
};

// ---- Bet controls ----
betMinus.onclick = ()=> setBet(bet - 0.1);
betPlus.onclick  = ()=> setBet(bet + 0.1);
