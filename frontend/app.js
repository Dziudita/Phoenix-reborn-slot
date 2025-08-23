// --- tiny helper: load CSV and parse into rows with JSON ---
async function loadCSV(path) {
  const txt = await fetch(path).then(r => r.text());
  const lines = txt.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  return lines.map(line => {
    // simple CSV: split first 3 commas only
    const firstComma = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    const thirdComma = line.indexOf(",", secondComma + 1);
    const simulation_id = line.slice(0, firstComma);
    const weight = Number(line.slice(firstComma + 1, secondComma));
    const events_json_raw = line.slice(secondComma + 1, thirdComma);
    const final_multiplier = Number(line.slice(thirdComma + 1));
    const events_json = JSON.parse(events_json_raw.replaceAll('""','"'));
    return { simulation_id, weight, events: events_json, final_multiplier };
  });
}

const reelsEl = document.getElementById("reels");
const balanceEl = document.getElementById("balance");
const winEl = document.getElementById("win");
const betEl = document.getElementById("bet");
const spinBtn = document.getElementById("spin");
const buyBtn = document.getElementById("bonusBuy");
const betMinus = document.getElementById("betMinus");
const betPlus = document.getElementById("betPlus");

let outcomes = [];
let balance = 1000;
let bet = 1.0;

function format(n){ return Number(n).toFixed(2); }
function setBet(v){ bet = Math.max(0.1, Math.min(100, Math.round(v*100)/100)); betEl.textContent = format(bet); }

function drawPlaceholders(){
  reelsEl.querySelectorAll(".reel").forEach((col, i) => {
    col.innerHTML = "";
    for (let r=0;r<3;r++){
      const cell = document.createElement("div");
      cell.className = "symbol";
      // just placeholders (we’ll replace with events later)
      const icons = ["A","K","Q","J","🜂","🜁","🜃","🜄"]; // alchemy vibe
      cell.textContent = icons[(i*3+r)%icons.length];
      col.appendChild(cell);
    }
  });
}
drawPlaceholders();

function animateStops(stops){
  // very simple: show stop indexes as numbers (demo only)
  reelsEl.querySelectorAll(".reel").forEach((col, i) => {
    col.querySelectorAll(".symbol").forEach((cell, r) => {
      cell.textContent = ["🜂","🜁","🜃","🜄","A","K","Q","J","🜸","🔥"][ (stops[i]+r) % 10 ];
    });
  });
}

function flashWin(){
  reelsEl.classList.remove("winflash");
  void reelsEl.offsetWidth; // reflow
  reelsEl.classList.add("winflash");
}

async function init(){
  outcomes = await loadCSV("./math/outcomes_base.csv"); // relative to /frontend/
}
init();

// SPIN logic (demo): pick a random outcome by weight
spinBtn.onclick = () => {
  if (!outcomes.length) return;
  if (balance < bet) return alert("Not enough balance (demo).");

  balance -= bet;
  balanceEl.textContent = format(balance);
  winEl.textContent = "0.00";

  const totalW = outcomes.reduce((a,o)=>a+o.weight,0);
  let pick = Math.random()*totalW, chosen = outcomes[0];
  for (const o of outcomes){ pick -= o.weight; if (pick <= 0){ chosen = o; break; } }

  animateStops(chosen.events.stops || [0,0,0,0,0]);

  const payout = bet * (chosen.final_multiplier || 0);
  setTimeout(()=> {
    balance += payout;
    winEl.textContent = format(payout);
    balanceEl.textContent = format(balance);
    if (payout>0) flashWin();

    // If outcome triggers FS, show a quick toast (demo)
    if ((chosen.events.features||[]).includes("FREESPIN_START")){
      alert("Bonus triggered: choose Light or Dark (demo stub)");
    }
  }, 450);
};

// BONUS BUY (demo): just show message — later we’ll switch to outcomes_light/dark
buyBtn.onclick = () => {
  const cost = bet * 100;
  if (balance < cost) return alert("Not enough balance for Bonus Buy (demo).");
  balance -= cost;
  balanceEl.textContent = format(balance);
  alert("Bonus Buy purchased! Choose Light or Dark (demo stub)");
};

betMinus.onclick = ()=> setBet(bet - 0.1);
betPlus.onclick  = ()=> setBet(bet + 0.1);
