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

// Paytable (multiplier on bet) — prireikus RTP korekcijai, mažink šitas reikšmes
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

// ---- State ----
let outcomes = [];
let outcomesLight = [];
let outcomesDark  = [];
let balance = 1000;
let bet = 1.0;
let isSpinning = false;

// BONUS BUY kainos (x bet) — įsidėk savo sim reikšmes
const BONUS_PRICE_LIGHT = 85;
const BONUS_PRICE_DARK  = 115;

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
  if (IS_SCATTER(seq[0])) return {mult:0,positions:[]}; // scatter pirmoj kol. nenuskaito line
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

// ---- Toast (trumpas pranešimas viršuje) ----
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

// ---- Bonus Buy modal refs (iš index.html)
const buyModal    = document.getElementById("buyModal");
const buyLightBtn = document.getElementById("buyLight");
const buyDarkBtn  = document.getElementById("buyDark");
const closeBuy    = document.getElementById("closeBuy");
const priceLightEl= document.getElementById("priceLight");
const priceDarkEl = document.getElementById("priceDark");

// ---- Bonus Buy modal controls ----
function openBuy(){ 
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

// ---- FS OVERLAY (sukuriam dinamiškai) ----
let fsOverlay = null, fsTitle = null, fsCounter = null, fsTotal = null;
function ensureFSOverlay(){
  if (fsOverlay) return;
  fsOverlay = document.createElement('div');
  fsOverlay.style.position='fixed';
  fsOverlay.style.inset='0';
  fsOverlay.style.background='rgba(0,0,0,.6)';
  fsOverlay.style.display='flex';
  fsOverlay.style.alignItems='center';
  fsOverlay.style.justifyContent='center';
  fsOverlay.style.zIndex='70';
  fsOverlay.style.backdropFilter='blur(2px)';

  const panel = document.createElement('div');
  panel.style.width='min(520px,92vw)';
  panel.style.border='1px solid #3a2a3d';
  panel.style.borderRadius='16px';
  panel.style.padding='20px';
  panel.style.background='linear-gradient(180deg,#20161f,#151019)';
  panel.style.boxShadow='0 12px 60px rgba(0,0,0,.5)';
  panel.style.textAlign='center';

  fsTitle = document.createElement('h2');
  fsTitle.style.margin='0 0 10px';
  fsTitle.style.letterSpacing='1px';
  fsTitle.textContent = 'FREE SPINS';

  fsCounter = document.createElement('div');
  fsCounter.style.opacity='.85';
  fsCounter.style.margin='6px 0 10px';

  fsTotal = document.createElement('div');
  fsTotal.style.fontWeight='800';
  fsTotal.style.fontSize='20px';

  panel.appendChild(fsTitle);
  panel.appendChild(fsCounter);
  panel.appendChild(fsTotal);
  fsOverlay.appendChild(panel);
  document.body.appendChild(fsOverlay);
}
function showFSOverlay(mode, spinsLeft, totalWin){
  ensureFSOverlay();
  fsTitle.textContent = mode==='light' ? 'Light Free Spins 🕊️' : 'Dark Free Spins 🦅';
  fsCounter.textContent = `Spins left: ${spinsLeft}`;
  fsTotal.textContent = `FS total: ${format(totalWin)}`;
  fsOverlay.style.display='flex';
}
function hideFSOverlay(){
  if (fsOverlay) fsOverlay.style.display='none';
}

// ---- FS raundas (tikras 10/7 sukimų ciklas) ----
function weightedPick(list){
  const totalW = list.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = list[0];
  for (const o of list){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }
  return chosen;
}
async function runFreeSpins(mode){
  // lock UI
  spinBtn.disabled = true; buyBtn.disabled = true;

  const spins = mode==='light' ? 10 : 7;
  let gmult = (mode==='dark') ? 2 : 1; // dark start x2
  let fsWin = 0;

  showFSOverlay(mode, spins, fsWin);

  for (let i=0;i<spins;i++){
    const src = mode==='light' ? outcomesLight : outcomesDark;
    if (!src?.length) break;

    const chosen = weightedPick(src);
    const stops = chosen.events.stops || [0,0,0,0,0];

    // FS greitesnė animacija
    await spinAnimate(stops, 580, 100);

    const { totalMult, winPositions } = evalSpin(stops);
    const multApplied = totalMult * gmult;
    const payout = bet * multApplied;

    balance += payout;
    fsWin += payout;

    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();
    highlightPositions(winPositions);

    // Dark: +1x už bet kokį scatter tų FS metu (kitam spin'ui)
    if (mode==='dark'){
      const scat = countScatters(stops);
      if (scat >= 1) gmult += 1;
    }

    showFSOverlay(mode, (spins - i - 1), fsWin);

    // nedidelis „kvėpavimas“ tarp FS sukimų
    await new Promise(r=> setTimeout(r, 350));
  }

  // trumpas užlaikymas, tada uždarom overlay
  await new Promise(r=> setTimeout(r, 600));
  hideFSOverlay();

  // unlock UI
  spinBtn.disabled = false; buyBtn.disabled = false;
}

// Sugeneruotas FS startas pagal scat count
function startFS(mode){
  toast(mode==='light'?'Light FS! 🕊️':'Dark FS! 🦅');
  runFreeSpins(mode);
}

// ---- FS paleidimas (vienas sukimukas – naudojama Bonus Buy demui, jeigu norėtum vietoj pilno ciklo)
function playFrom(list){
  if (!list?.length) return alert("No Free Spins data yet (demo).");
  const chosen = weightedPick(list);
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

// ---- Init ----
async function init(){
  try { outcomes      = await loadCSV("./math/outcomes_base.csv"); } catch(e){ console.warn(e); }
  try { outcomesLight = await loadCSV("./math/outcomes_light.csv"); } catch(e){ /* ok */ }
  try { outcomesDark  = await loadCSV("./math/outcomes_dark.csv"); } catch(e){ /* ok */ }
}
init();

// ---- Spin (BASE GAME) ----
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

  const { totalMult, winPositions, scatters } = evalSpin(stops);
  const payout = bet * totalMult;
  balance += payout;
  winEl.textContent = format(payout);
  balanceEl.textContent = format(balance);
  if (payout>0) flashWin();
  highlightPositions(winPositions);

  // BONUS TRIGGER pagal scat skaičių:
  // 3 scatters -> LIGHT FS (10), 4+ scatters -> DARK FS (7)
  if (scatters >= 3) {
    const mode = (scatters >= 4) ? 'dark' : 'light';
    await runFreeSpins(mode);
  }

  isSpinning = false; spinBtn.disabled = false;
};

// ---- Bonus Buy ----
buyBtn.onclick = () => { openBuy(); };

buyLightBtn?.addEventListener('click', async ()=>{
  const cost = bet * BONUS_PRICE_LIGHT;
  if (balance < cost) return alert("Not enough balance for Light FS.");
  balance -= cost; balanceEl.textContent = format(balance);
  closeBuyFn();
  await runFreeSpins('light');
});

buyDarkBtn?.addEventListener('click', async ()=>{
  const cost = bet * BONUS_PRICE_DARK;
  if (balance < cost) return alert("Not enough balance for Dark FS.");
  balance -= cost; balanceEl.textContent = format(balance);
  closeBuyFn();
  await runFreeSpins('dark');
});

// ---- Bet controls ----
betMinus.onclick = ()=> setBet(bet - 0.1);
betPlus.onclick  = ()=> setBet(bet + 0.1);
