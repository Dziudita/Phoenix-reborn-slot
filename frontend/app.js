// --- CSV loader: fixes outer quotes around JSON field ---
async function loadCSV(path) {
  const txt = await fetch(path).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}`);
    return r.text();
  });

  const lines = txt.trim().split(/\r?\n/);
  lines.shift(); // drop header

  return lines.filter(Boolean).map(line => {
    const firstComma  = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    const lastComma   = line.lastIndexOf(",");

    const simulation_id   = line.slice(0, firstComma).trim();
    const weight          = Number(line.slice(firstComma + 1, secondComma).trim());
    let   events_json_raw = line.slice(secondComma + 1, lastComma).trim(); // CSV-quoted JSON
    const final_multiplier= Number(line.slice(lastComma + 1).trim());

    // CSV naudoja dvigubinamas kabutes ("") – paverčiam į "
    let jsonFixed = events_json_raw.replaceAll('""', '"');

    // Nulupam IŠORINES kabutes, jei jos yra (CSV laukas paprastai būna apsuptas ")
    if (jsonFixed.startsWith('"') && jsonFixed.endsWith('"')) {
      jsonFixed = jsonFixed.slice(1, -1);
    }

    let events_json;
    try {
      events_json = JSON.parse(jsonFixed);
    } catch (e) {
      console.error("JSON parse failed for:", jsonFixed);
      throw e;
    }

    return { simulation_id, weight, events: events_json, final_multiplier };
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
let outcomes      = [];
let outcomesLight = [];
let outcomesDark  = [];
let balance = 1000;
let bet = 1.0;

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

// pool for demo symbols
const SYMBOL_POOL = ["🜂","🜁","🜃","🜄","A","K","Q","J","🜸","🔥"];

// set column symbols given a starting index (cycles through pool)
function setReelSymbols(colIndex, startIndex){
  const col = reelsEl.children[colIndex];
  col.querySelectorAll(".symbol").forEach((cell, r)=>{
    cell.textContent = SYMBOL_POOL[(startIndex + r) % SYMBOL_POOL.length];
  });
}

// flash effect on win
function flashWin(){
  reelsEl.classList.remove("winflash");
  void reelsEl.offsetWidth; // reflow to restart animation
  reelsEl.classList.add("winflash");
}

// Simple spin animation with staggered stops
async function spinAnimate(targetStops, baseDuration = 700, stagger = 100){
  // clear previous highlights
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
          const tick = Math.floor(elapsed / 70); // speed
          setReelSymbols(i, tick);
        } else {
          setReelSymbols(i, targetStops[i] || 0);
        }
      }
      if (!allDone) requestAnimationFrame(frame);
      else {
        [...reelsEl.children].forEach(r => r.classList.remove("spin"));
        // mark center row as "stop" indicator
        reelsEl.querySelectorAll(".reel").forEach(col=>{
          col.querySelectorAll(".symbol")[1]?.classList.add("stop");
        });
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// ---- Modal helpers ----
function openModal(){ modal.classList.remove("hidden"); }
function closeModalFn(){ modal.classList.add("hidden"); }
closeModal.onclick = closeModalFn;

// choose from a weighted list and play result (with a quick spin)
function playFrom(list){
  if (!list?.length) return alert("No Free Spins data yet (demo).");
  const totalW = list.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = list[0];
  for (const o of list){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }

  const targetStops = chosen.events.stops || [0,0,0,0,0];
  spinAnimate(targetStops, 600, 80).then(()=>{
    const payout = bet * (chosen.final_multiplier || 0);
    balance += payout;
    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();

    // demo highlight if lines present
    if (chosen.events.lines && chosen.events.lines.length){
      const cols = reelsEl.querySelectorAll(".reel");
      for (let i=0;i<5;i++){
        cols[i].querySelectorAll(".symbol")[1]?.classList.add("win-cell");
      }
    }
  });
}
chooseLight.onclick = ()=>{ closeModalFn(); playFrom(outcomesLight); };
chooseDark.onclick  = ()=>{ closeModalFn(); playFrom(outcomesDark);  };

// ---- Init: load CSVs ----
async function init(){
  try { outcomes      = await loadCSV("./math/outcomes_base.csv"); } catch(e){ console.warn(e); }
  try { outcomesLight = await loadCSV("./math/outcomes_light.csv"); } catch(e){ /* ok if missing */ }
  try { outcomesDark  = await loadCSV("./math/outcomes_dark.csv"); } catch(e){ /* ok if missing */ }
}
init();

// ---- Spin button ----
spinBtn.onclick = async () => {
  if (!outcomes.length) return;
  if (balance < bet) return alert("Not enough balance (demo).");

  balance -= bet;
  balanceEl.textContent = format(balance);
  winEl.textContent = "0.00";

  // weighted pick
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

  // demo highlight if lines present
  if (chosen.events.lines && chosen.events.lines.length){
    const cols = reelsEl.querySelectorAll(".reel");
    for (let i=0;i<5;i++){
      cols[i].querySelectorAll(".symbol")[1]?.classList.add("win-cell");
    }
  }

  // trigger FS choice
  if ((chosen.events.features||[]).includes("FREESPIN_START")){
    openModal();
  }
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
