const roundStorageKey = "leilao-do-censo-round";
const lotValue = 250;
const referenceAnswer = "B) Fase 2.";
const teamColors = ["#f56554", "#087f8c", "#a4b51e", "#151d66"];
const initialTeams = ["Equipe 1", "Equipe 2", "Equipe 3", "Equipe 4"].map((name) => ({ name, balance: 1000, lots: 0 }));
const initialRoundState = { team: "", bid: null, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, teams: initialTeams };

const copyTeams = (teams) => teams.map((team) => ({ ...team }));
const normaliseState = (state) => ({ ...initialRoundState, ...state, teams: Array.isArray(state?.teams) && state.teams.length === 4 ? state.teams.map((team) => ({ ...team, balance: Math.trunc(Number(team.balance) || 0), lots: Math.max(0, Math.trunc(Number(team.lots) || 0)) })) : copyTeams(initialTeams) });
const readRoundState = () => { try { return normaliseState(JSON.parse(localStorage.getItem(roundStorageKey) || "{}")); } catch { return normaliseState({}); } };
const saveRoundState = (updates) => { const next = normaliseState({ ...readRoundState(), ...updates }); localStorage.setItem(roundStorageKey, JSON.stringify(next)); return next; };
const formatMoney = (value) => `R$ ${Math.trunc(Number(value) || 0).toLocaleString("pt-BR")}`;
const remainingSeconds = (state) => Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000));
const formatTime = (seconds) => `00:${String(seconds).padStart(2, "0")}`;

function renderTeamSummary(state) {
  document.querySelectorAll("[data-team-summary]").forEach((card) => {
    const team = state.teams.find((item) => item.name === card.dataset.teamSummary);
    if (!team) return;
    card.querySelector("[data-team-name]").textContent = team.name;
    card.querySelector("[data-team-balance]").textContent = formatMoney(team.balance);
    card.querySelector("[data-team-lots]").textContent = team.lots;
  });
}

function renderAuctioneer() {
  const state = readRoundState();
  const releaseButton = document.querySelector("#release-question");
  if (!releaseButton) return;
  const timerButton = document.querySelector("#start-timer");
  const resultButtons = document.querySelectorAll("[data-result]");
  const message = document.querySelector("#timer-message");
  const displays = document.querySelectorAll("[data-timer-display]");
  const status = document.querySelector("#question-status");
  const nextLotButton = document.querySelector("#prepare-next-lot");
  const finalTeam = document.querySelector("#final-team");
  const finalBid = document.querySelector("#final-bid");
  const confirmButton = document.querySelector("#confirm-final-bid");
  releaseButton.disabled = !state.confirmed || state.released;
  timerButton.disabled = !state.released || Boolean(state.timerEndsAt) || state.timerExpired || Boolean(state.result);
  resultButtons.forEach((button) => { button.disabled = !state.released || Boolean(state.result); button.classList.toggle("is-selected", state.result === button.dataset.result); });
  [finalTeam, finalBid, confirmButton].forEach((element) => { element.disabled = Boolean(state.result); });
  if (state.confirmed) {
    finalTeam.value = state.team;
    finalBid.value = Number.isInteger(state.bid) ? state.bid : "";
  }
  nextLotButton.hidden = !state.result;
  renderTeamSummary(state);
  if (state.result) { status.textContent = "Rodada encerrada"; message.textContent = state.result === "correct" ? "Resultado: lote adquirido e saldo atualizado." : "Resultado: lance redistribuído e saldos atualizados."; }
  else if (!state.released) { status.textContent = "Privada — pronta para liberação"; message.textContent = state.confirmed ? "Lance confirmado. Libere a pergunta quando estiver pronto." : "Confirme o lance e libere a pergunta para iniciar o tempo."; }
  else if (state.timerExpired) { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Tempo encerrado. Marque o resultado da resposta manualmente."; }
  else if (state.timerEndsAt) { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Tempo em andamento no Painel da disputa."; }
  else { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Pergunta liberada. Inicie o tempo quando a equipe estiver pronta."; }
  const seconds = state.timerEndsAt ? remainingSeconds(state) : 45;
  displays.forEach((element) => { element.textContent = state.timerExpired ? "Tempo encerrado" : formatTime(seconds); });
}

function renderPublicResult(state) {
  const title = document.querySelector("[data-public-result-title]");
  const message = document.querySelector("[data-public-result-message]");
  const recipients = document.querySelector("[data-public-recipients]");
  const shareValue = document.querySelector("[data-public-share]");
  const correctAnswer = document.querySelector("[data-public-correct-answer]");
  if (state.result === "correct") { title.textContent = "Lote adquirido"; message.textContent = `${state.team} acertou a resposta e adquiriu o lote.`; recipients.hidden = true; correctAnswer.hidden = true; return; }
  const share = Math.floor(state.bid / 3);
  title.textContent = "Lote não adquirido";
  message.textContent = `${state.team} não acertou a resposta.`;
  shareValue.textContent = formatMoney(share);
  correctAnswer.textContent = `Resposta correta: ${referenceAnswer}`;
  recipients.hidden = false;
  correctAnswer.hidden = false;
}

function renderPublicRanking(state) {
  const ranking = document.querySelector("[data-public-ranking]");
  if (!ranking) return;
  const teams = state.teams.map((team, index) => ({ team, index }));
  ranking.replaceChildren();
  teams.forEach(({ team, index }) => {
    const item = document.createElement("li");
    item.className = "public-ranking-team";
    item.style.setProperty("--team-color", teamColors[index]);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"); name.textContent = team.name;
    const lots = document.createElement("span"); lots.textContent = `${team.lots} ${team.lots === 1 ? "lote" : "lotes"}`;
    item.append(dot, name, lots);
    ranking.append(item);
  });
}

function renderPublicPanel() {
  const shell = document.querySelector(".public-shell");
  if (!shell) return;
  const state = readRoundState();
  const waiting = document.querySelector("[data-public-waiting]");
  const round = document.querySelector("[data-public-round]");
  const result = document.querySelector("[data-public-result]");
  waiting.hidden = state.released || Boolean(state.result);
  round.hidden = !state.released || Boolean(state.result);
  result.hidden = !state.result;
  shell.dataset.publicState = state.result ? "result" : state.released ? "released" : "waiting";
  if (state.result) { renderPublicResult(state); return; }
  if (!state.released) { renderPublicRanking(state); return; }
  document.querySelector("[data-public-team]").textContent = state.team;
  document.querySelector("[data-public-bid]").textContent = formatMoney(state.bid);
  const timer = document.querySelector("[data-public-timer]");
  const note = document.querySelector("[data-public-timer-note]");
  if (state.timerExpired) { timer.textContent = "Tempo encerrado"; timer.classList.add("is-ended"); note.textContent = "Aguardando a decisão do leiloeiro."; }
  else if (state.timerEndsAt) { timer.textContent = formatTime(remainingSeconds(state)); timer.classList.remove("is-ended"); note.textContent = "Tempo de resposta em andamento."; }
  else { timer.textContent = "00:45"; timer.classList.remove("is-ended"); note.textContent = "Aguardando o início do tempo."; }
}

function settleExpiredTimer() { const state = readRoundState(); if (state.timerEndsAt && remainingSeconds(state) === 0) saveRoundState({ timerEndsAt: null, timerExpired: true }); }
function applyResult(result) {
  const state = readRoundState();
  if (state.result) return;
  const share = Math.floor(state.bid / (state.teams.length - 1));
  const teams = state.teams.map((team) => {
    if (team.name !== state.team) return result === "wrong" ? { ...team, balance: team.balance + share } : team;
    return result === "correct" ? { ...team, balance: team.balance + lotValue, lots: team.lots + 1 } : { ...team, balance: team.balance - state.bid };
  });
  saveRoundState({ teams, result, timerEndsAt: null, timerExpired: true });
}

document.addEventListener("DOMContentLoaded", () => {
  const confirmButton = document.querySelector("#confirm-final-bid");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => {
      const team = document.querySelector("#final-team").value;
      const bidInput = document.querySelector("#final-bid");
      const bid = Number(bidInput.value);
      if (!team || !Number.isInteger(bid) || bid < 0) { bidInput.setCustomValidity("Informe um lance inteiro em reais."); bidInput.reportValidity(); return; }
      bidInput.setCustomValidity("");
      saveRoundState({ team, bid, confirmed: true, released: false, timerEndsAt: null, timerExpired: false, result: null }); renderAuctioneer();
    });
    document.querySelector("#release-question").addEventListener("click", () => { saveRoundState({ released: true }); renderAuctioneer(); });
    document.querySelector("#start-timer").addEventListener("click", () => { saveRoundState({ timerEndsAt: Date.now() + 45000, timerExpired: false }); renderAuctioneer(); });
    document.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => { applyResult(button.dataset.result); renderAuctioneer(); }));
    document.querySelector("#prepare-next-lot").addEventListener("click", () => {
      saveRoundState({ team: "", bid: null, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null });
      document.querySelector("#final-team").value = "";
      document.querySelector("#final-bid").value = "";
      renderAuctioneer();
    });
  }
  window.addEventListener("storage", () => { renderAuctioneer(); renderPublicPanel(); });
  setInterval(() => { settleExpiredTimer(); renderAuctioneer(); renderPublicPanel(); }, 250);
  renderAuctioneer(); renderPublicPanel();
});
