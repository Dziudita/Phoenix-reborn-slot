// --- CSV loader: fixes outer quotes around JSON field ---
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
    const final_mult    = Number(line.slice(lastComma + 1).trim());

    // unescape and strip outer quotes
    let jsonFixed = jsonRaw.replaceAll('""','"');
    if (jsonFixed.startsWith('"') && jsonFixed.endsWith('"')) {
      jsonFixed = jsonFixed.slice(1, -1);
    }
    const events = JSON.parse(jsonFixed);

    return { simulation_id, weight, events, final_multiplier: final_mult };
  });
}

// ---- DOM refs ----
const reelsEl   = document.getElementById("reels");
const balanceEl = document.getElementById("balance");
const winEl     = document.getElementById("win");
const betEl     = document.getElementById("bet");
const spinBtn   = document.getElementById("spin");
const buyBtn    = document.getElementById("bonusBuy");
const betMinus  = document.getElementById("betMinus");
const betPlus   = document.getElementById("betPlus");

// Modal
const modal       = document.getElementById("bonusModal");
const chooseLight = document.getElementById("chooseLight");
const chooseDark  = document.getElementById("chooseDark");
const closeModal  = document.getElementById("closeModal");

// ---- State ----
let outcomes = [];
let outcomesLight = [];
let outcomesDark  = [];
let balance = 1000;
let bet = 1.0;
let isSpinning = false;

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
      const icons = ["A","K","Q","J","🜂","🜁","🜃","🜄"];
      cell.textContent = icons[(i*3+r)%icons.length];
      col.appendChild(cell);
    }
  });
}
drawPlaceholders();

const SYMBOL_POOL = ["🜂","🜁","🜃","🜄","A","K","Q","J","🜸","🔥"];

function setReelSymbols(colIndex, startIndex){
  const col = reelsEl.children[colIndex];
  col.querySelectorAll(".symbol").forEach((cell, r)=>{
    cell.textContent = SYMBOL_POOL[(startIndex + r) % SYMBOL_POOL.length];
  });
}

function flashWin(){
  reelsEl.classList.remove("winflash");
  void reelsEl.offsetWidth;
  reelsEl.classList.add("winflash");
}

async function spinAnimate(targetStops, baseDuration = 720, stagger = 160){
  reelsEl.querySelectorAll(".symbol").forEach(n=>n.classList.remove("win-cell","stop"));
  const durations = Array.from({length:5}, (_,i)=> baseDuration + i*stagger);
  const start = performance.now();
  [...reelsEl.children].forEach(r => r.classList.add("spin"));

  return new Promise(resolve=>{
    function frame(t){
      let allDone = true;
      for(let i=0;i<5;i++){
        const elapsed = t - start;
        const d = durations[i];
        if (elapsed < d){
          allDone = false;
          const tick = Math.floor(elapsed / 70);
          setReelSymbols(i, tick);
        } else {
          setReelSymbols(i, targetStops[i] || 0);
        }
      }
      if (!allDone) requestAnimationFrame(frame);
      else {
        [...reelsEl.children].forEach(r => r.classList.remove("spin"));
        reelsEl.querySelectorAll(".reel").forEach(col=>{
          col.querySelectorAll(".symbol")[1]?.classList.add("stop");
        });
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// highlight EXACT cells from CSV (col,row) with row 0..2 (0=top)
function highlightPositions(positions=[]) {
  const cols = reelsEl.querySelectorAll(".reel");
  positions.forEach(([c,r])=>{
    const col = cols[c];
    const cell = col?.querySelectorAll(".symbol")[r];
    if (cell) cell.classList.add("win-cell");
  });
}

// ---- Modal helpers ----
function openModal(){ modal.classList.remove("hidden"); buyBtn.disabled = true; }
function closeModalFn(){ modal.classList.add("hidden"); buyBtn.disabled = false; }
closeModal.onclick = closeModalFn;

function playFrom(list){
  if (!list?.length) return alert("No Free Spins data yet (demo).");
  const totalW = list.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = list[0];
  for (const o of list){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }

  const targetStops = chosen.events.stops || [0,0,0,0,0];
  spinAnimate(targetStops, 600, 100).then(()=>{
    const payout = bet * (chosen.final_multiplier || 0);
    balance += payout;
    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();
    highlightPositions(chosen.events.win_positions || []);
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

  const totalW = outcomes.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = outcomes[0];
  for (const o of outcomes){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }

  const targetStops = chosen.events.stops || [0,0,0,0,0];
  await spinAnimate(targetStops);

  const payout = bet * (chosen.final_multiplier || 0);
  balance += payout;
  winEl.textContent = format(payout);
  balanceEl.textContent = format(balance);
  if (payout>0) flashWin();

  highlightPositions(chosen.events.win_positions || []);

  if ((chosen.events.features||[]).includes("FREESPIN_START")){
    openModal();
  }

  isSpinning = false; spinBtn.disabled = false;
};

// ---- Bonus Buy ----
buyBtn.onclick = () => {
  const cost = bet * 100;
  if (balance < cost) return alert("Not enough balance for Bonus Buy (demo).");
  balance -= cost;
  balanceEl.textContent = format(balance);
  openModal();
};

// ---- Bet controls ----
betMinus.onclick = ()=> setBet(bet - 0.1);
betPlus.onclick  = ()=> setBet(bet + 0.1);
