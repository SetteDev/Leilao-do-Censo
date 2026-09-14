const roundStorageKey = "leilao-do-censo-round";
const auctioneerAccessKey = "leilao-do-censo-auctioneer-access";
const auctioneerPassword = "Demografia";
const defaultTeamColors = ["#bf4135", "#006e7b", "#687500", "#151d66"];
const defaultConfig = { ocultarValor: true, capLance: 50, timerSeconds: 45 };
const normaliseConfig = (config) => ({ ...defaultConfig, ...(config || {}), ocultarValor: Boolean(config?.ocultarValor ?? defaultConfig.ocultarValor), capLance: Math.max(0, Math.trunc(Number(config?.capLance) || 0)), timerSeconds: Math.max(5, Math.trunc(Number(config?.timerSeconds) || defaultConfig.timerSeconds)) });
const createInitialTeams = () => ["Equipe 1", "Equipe 2", "Equipe 3", "Equipe 4"].map((name, index) => ({ name, color: defaultTeamColors[index], balance: 1000, lots: 0 }));
const initialRoundState = { team: "", bid: null, bidDebited: false, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationBets: [], approximationCalculated: false, valueRevealed: false, gameOver: false, awaitingSetup: false, standings: [], config: normaliseConfig({}), teams: createInitialTeams(), currentQuestionId: null, usedQuestionIds: [], catalogExhausted: false };

let questionCatalog = [];
let catalogLoadError = false;
let pendingLotFilter = null;
let syncStatus = "connecting";
let syncVersion = 0;
let stateStream = null;
let statePublishQueue = Promise.resolve();
let publicPresentationState = null;
const roundHeartbeatInterval = 5 * 60 * 1000;
const questions = () => questionCatalog;
const isApproximation = (question) => question?.modalidade === "aproximacao";
const isAuctionQuestion = (question) => question && !isApproximation(question);
const modalityLabel = (modality) => ({ multipla_escolha: "Múltipla escolha", aberta: "Resposta aberta", aproximacao: "Aproximação", verdadeiro_falso: "Verdadeiro ou falso" }[modality] || "Questão");
const copyTeams = (teams) => teams.map((team, index) => ({ name: String(team.name || `Equipe ${index + 1}`), color: team.color || defaultTeamColors[index], balance: Math.trunc(Number(team.balance) || 0), lots: Math.max(0, Math.trunc(Number(team.lots) || 0)) }));
const normaliseState = (state) => ({ ...initialRoundState, ...state, config: normaliseConfig(state?.config), teams: Array.isArray(state?.teams) && state.teams.length === 4 ? copyTeams(state.teams) : createInitialTeams(), usedQuestionIds: Array.isArray(state?.usedQuestionIds) ? state.usedQuestionIds : [], winningTeams: Array.isArray(state?.winningTeams) ? state.winningTeams : [], approximationAnswers: Array.isArray(state?.approximationAnswers) ? state.approximationAnswers : [], approximationBets: Array.isArray(state?.approximationBets) ? state.approximationBets : [], standings: Array.isArray(state?.standings) ? state.standings : [] });
const readRoundState = () => { try { return normaliseState(JSON.parse(localStorage.getItem(roundStorageKey) || "{}")); } catch { return normaliseState({}); } };
const saveLocalRoundState = (state) => { const next = normaliseState(state); localStorage.setItem(roundStorageKey, JSON.stringify(next)); return next; };
const saveRoundState = (updates) => { const next = saveLocalRoundState({ ...readRoundState(), ...updates }); queueRoundStatePublish(next); return next; };
const formatMoneyAmount = (value) => Math.trunc(Number(value) || 0).toLocaleString("pt-BR");
const formatMoney = (value) => `R$ ${formatMoneyAmount(value)}`;
function setMoneyValue(element, value) {
  if (!element) return;
  const money = document.createElement("span"); money.className = "money-value"; money.setAttribute("aria-label", formatMoney(value));
  const currency = document.createElement("span"); currency.className = "money-currency"; currency.textContent = "R$"; currency.setAttribute("aria-hidden", "true");
  const amount = document.createElement("span"); amount.className = "money-amount"; amount.textContent = formatMoneyAmount(value); amount.setAttribute("aria-hidden", "true");
  money.append(currency, amount); element.replaceChildren(money);
}
const formatApproximationValue = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
const remainingSeconds = (state) => Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000));
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0").slice(-2)}`;
const getQuestion = (state) => questions().find((question) => question.id === state.currentQuestionId) || null;

async function loadQuestionCatalog() {
  try {
    const response = await fetch("/api/questions", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as questões.");
    const data = await response.json();
    questionCatalog = Array.isArray(data) ? data : [];
  } catch {
    catalogLoadError = true;
    questionCatalog = [];
  }
}

function renderSyncStatus() {
  const publicCopy = {
    connecting: "Conectando à partida…",
    connected: "Painel conectado à partida",
    reconnecting: "Reconectando à partida…",
    offline: "Painel sem conexão com a partida"
  };
  const privateCopy = {
    connecting: "Conectando os painéis…",
    connected: "Sincronização ativa",
    reconnecting: "Reconectando os painéis…",
    offline: "Sem conexão — o Painel da disputa não receberá atualizações."
  };
  document.querySelectorAll("[data-public-sync-status]").forEach((status) => {
    status.textContent = publicCopy[syncStatus] || publicCopy.connecting;
    status.dataset.status = syncStatus;
  });
  document.querySelectorAll("[data-private-sync-status]").forEach((status) => {
    status.textContent = privateCopy[syncStatus] || privateCopy.connecting;
    status.dataset.status = syncStatus;
  });
}

function setSyncStatus(status) {
  syncStatus = status;
  renderSyncStatus();
}

function applySharedRoundState(payload) {
  if (!payload?.state || typeof payload.state !== "object") return;
  const version = Number(payload.version) || 0;
  if (version && version < syncVersion) return;
  syncVersion = Math.max(syncVersion, version);
  saveLocalRoundState(payload.state);
  renderAuctioneer();
  renderPublicPanel();
}

function queueRoundStatePublish(state) {
  statePublishQueue = statePublishQueue
    .catch(() => undefined)
    .then(async () => {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      });
      if (!response.ok) throw new Error("Não foi possível atualizar o painel público.");
      const payload = await response.json();
      syncVersion = Math.max(syncVersion, Number(payload.version) || 0);
      setSyncStatus("connected");
    })
    .catch(() => setSyncStatus("offline"));
  return statePublishQueue;
}

function restoreAuctioneerStateIfNeeded(payload) {
  if (payload?.state || !document.querySelector("#release-question")) return;
  queueRoundStatePublish(readRoundState());
}

function keepRoundConnectionAlive() {
  if (!document.querySelector("#release-question, .public-shell")) return;
  setInterval(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (payload.state) applySharedRoundState(payload);
        else restoreAuctioneerStateIfNeeded(payload);
      })
      .catch(() => setSyncStatus("reconnecting"));
  }, roundHeartbeatInterval);
}

async function initialiseStateSync() {
  setSyncStatus("connecting");
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Estado indisponível");
    const payload = await response.json();
    syncVersion = Number(payload.version) || 0;
    if (payload.state) applySharedRoundState(payload);
    setSyncStatus("connected");
    stateStream?.close();
    stateStream = new EventSource("/api/state/events");
    stateStream.addEventListener("state", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.state) applySharedRoundState(payload);
        else restoreAuctioneerStateIfNeeded(payload);
        setSyncStatus("connected");
      } catch {
        setSyncStatus("reconnecting");
      }
    });
    stateStream.onerror = () => setSyncStatus("reconnecting");
    restoreAuctioneerStateIfNeeded(payload);
  } catch {
    setSyncStatus("offline");
  }
}

function chooseNextQuestion(state, filter = null) {
  const available = questions().filter((question) => !state.usedQuestionIds.includes(question.id) && (!filter || filter.random || question.modalidade === filter.modalidade));
  if (!available.length) return { currentQuestionId: null, catalogExhausted: true };
  const question = available[Math.floor(Math.random() * available.length)];
  return { currentQuestionId: question.id, usedQuestionIds: [...state.usedQuestionIds, question.id], catalogExhausted: false };
}

function createTeamCard(team) {
  const card = document.createElement("div");
  card.className = "summary-team";
  card.style.setProperty("--team-color", team.color);
  const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("strong"); name.textContent = team.name;
  const details = document.createElement("dl");
  [["Saldo", team.balance, true], ["Lotes", team.lots, false]].forEach(([label, value, isMoney]) => {
    const row = document.createElement("div"); const term = document.createElement("dt"); const definition = document.createElement("dd");
    term.textContent = label;
    if (isMoney) setMoneyValue(definition, value); else definition.textContent = value;
    row.append(term, definition); details.append(row);
  });
  card.append(dot, name, details);
  return card;
}

function renderTeamSummary(state) {
  const list = document.querySelector("[data-teams-summary-list]");
  if (list) list.replaceChildren(...state.teams.map(createTeamCard));
}

function renderTeamSelect(state) {
  const select = document.querySelector("#final-team");
  if (!select) return;
  const key = state.teams.map((team) => team.name).join("|");
  if (select.dataset.teamsKey === key) return;
  const currentValue = select.value;
  select.replaceChildren();
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Selecione a equipe"; select.append(placeholder);
  state.teams.forEach((team) => { const option = document.createElement("option"); option.value = team.name; option.textContent = team.name; select.append(option); });
  select.value = state.teams.some((team) => team.name === currentValue) ? currentValue : "";
  select.dataset.teamsKey = key;
}

function renderApproximationAnswers(state) {
  const list = document.querySelector("[data-approximation-answers]");
  if (!list) return;
  const saved = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
  const savedBets = new Map(state.approximationBets.map((bet) => [bet.team, bet.value]));
  const retainCurrentValues = list.dataset.questionId === (state.currentQuestionId || "");
  const current = new Map(retainCurrentValues ? [...list.querySelectorAll("[data-approximation-team]")].map((input) => [input.dataset.approximationTeam, input.value]) : []);
  const currentBets = new Map(retainCurrentValues ? [...list.querySelectorAll("[data-approximation-bet]")].map((input) => [input.dataset.approximationBet, input.value]) : []);
  list.replaceChildren(...state.teams.map((team) => {
    const label = document.createElement("label"); label.className = "approximation-answer"; label.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span"); name.textContent = team.name;
    const fields = document.createElement("span"); fields.className = "approximation-answer-fields";
    const answer = document.createElement("input"); answer.type = "number"; answer.step = "any"; answer.inputMode = "decimal"; answer.placeholder = "Resposta"; answer.setAttribute("aria-label", `Resposta da ${team.name}`); answer.dataset.approximationTeam = team.name; answer.value = saved.get(team.name) ?? current.get(team.name) ?? "";
    const bet = document.createElement("input"); bet.type = "number"; bet.min = "0"; bet.step = "1"; bet.inputMode = "numeric"; bet.placeholder = "Aposta (R$)"; bet.setAttribute("aria-label", `Aposta da ${team.name}`); bet.dataset.approximationBet = team.name; bet.value = savedBets.get(team.name) ?? currentBets.get(team.name) ?? "";
    [answer, bet].forEach((input) => { input.disabled = !state.released || state.approximationCalculated || Boolean(state.result); });
    fields.append(answer, bet); label.append(dot, name, fields); return label;
  }));
  list.dataset.questionId = state.currentQuestionId || "";
}

function renderNextLotChooser(state) {
  const panel = document.querySelector("[data-next-lot-chooser]");
  if (!panel) return;
  const strip = document.querySelector("[data-category-chips]");
  if (!strip) return;
  const remaining = questions().filter((question) => !state.usedQuestionIds.includes(question.id));
  const confirm = document.querySelector("#confirm-next-lot");
  const makeChip = (label, filter) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "category-chip";
    button.textContent = label; button.disabled = !remaining.some((question) => filter.random || question.modalidade === filter.modalidade);
    button.addEventListener("click", () => { pendingLotFilter = filter; strip.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("is-selected", chip === button)); if (confirm) confirm.disabled = false; });
    return button;
  };
  strip.replaceChildren(
    makeChip("Aleatório", { random: true }),
    makeChip("Múltipla escolha", { modalidade: "multipla_escolha" }),
    makeChip("Resposta aberta", { modalidade: "aberta" }),
    makeChip("Aproximação", { modalidade: "aproximacao" }),
    makeChip("Verdadeiro ou falso", { modalidade: "verdadeiro_falso" })
  );
  if (confirm) confirm.disabled = true;
}

function renderOptions(question) {
  document.querySelectorAll("[data-question-options]").forEach((list) => {
    const alternatives = Array.isArray(question?.alternativas) ? question.alternativas : [];
    list.hidden = alternatives.length === 0;
    list.dataset.modality = question?.modalidade || "";
    list.classList.toggle("is-boolean", question?.modalidade === "verdadeiro_falso");
    list.replaceChildren(...alternatives.map((alternative) => { const item = document.createElement("li"); item.textContent = alternative; return item; }));
  });
}

function renderQuestion(state) {
  const question = getQuestion(state);
  const exhausted = document.querySelector("[data-catalog-exhausted]");
  const questionContent = document.querySelector("[data-question-content]");
  if (!question) {
    if (exhausted) exhausted.hidden = !state.catalogExhausted;
    if (questionContent) questionContent.hidden = true;
    return null;
  }
  if (exhausted) exhausted.hidden = true;
  if (questionContent) questionContent.hidden = false;
  const approximation = isApproximation(question);
  document.querySelectorAll("[data-lot-value-area], [data-public-lot-value-area]").forEach((element) => { element.hidden = approximation; });
  document.querySelectorAll("[data-lot-number]").forEach((element) => { element.textContent = question.id; });
  document.querySelectorAll("[data-lot-value]").forEach((element) => {
    const masked = element.closest(".public-shell") && state.config.ocultarValor && !state.valueRevealed && !state.result;
    element.textContent = approximation ? "" : masked ? "R$ ?" : formatMoney(question.valorLote);
  });
  document.querySelectorAll("[data-question-modality]").forEach((element) => { element.textContent = modalityLabel(question.modalidade); });
  document.querySelectorAll("[data-question-text]").forEach((element) => { element.textContent = question.enunciado; });
  renderOptions(question);
  document.querySelectorAll("[data-reference-answer]").forEach((element) => { element.textContent = question.resposta; });
  document.querySelectorAll("[data-question-note]").forEach((element) => { element.textContent = approximation ? "As equipes respondem e registram suas apostas após a liberação da rodada." : "A pergunta só aparece no Painel da disputa após a confirmação do lance. O valor fica oculto — o leiloeiro decide quando (e se) revelá-lo."; });
  return question;
}

function renderAuctioneer() {
  const state = readRoundState(); const releaseButton = document.querySelector("#release-question");
  if (!releaseButton) return;
  const question = renderQuestion(state); const timerButton = document.querySelector("#start-timer"); const resultButtons = document.querySelectorAll("[data-result]"); const message = document.querySelector("#timer-message"); const displays = document.querySelectorAll("[data-timer-display]"); const status = document.querySelector("#question-status"); const nextLotButton = document.querySelector("#prepare-next-lot"); const startAnotherGameButton = document.querySelector("#start-another-game"); const finalTeam = document.querySelector("#final-team"); const finalBid = document.querySelector("#final-bid"); const confirmButton = document.querySelector("#confirm-final-bid"); const bidForm = document.querySelector("[data-bid-form]"); const approximationPanel = document.querySelector("[data-approximation-result]"); const standardResult = document.querySelector("[data-standard-result]"); const approximationButton = document.querySelector("#confirm-approximation"); const approximationReleaseButton = document.querySelector("#release-approximation-result"); const resultTitle = document.querySelector("#result-title"); const revealButton = document.querySelector("#reveal-value"); const valueVisibility = document.querySelector("[data-value-visibility]"); const endGameButton = document.querySelector("#end-game"); const endPanel = document.querySelector("[data-match-end-panel]");
  renderTeamSelect(state); renderTeamSummary(state); renderApproximationAnswers(state);
  const noRound = !question;
  const approximation = isApproximation(question);
  if (bidForm) bidForm.hidden = approximation;
  if (approximationPanel) approximationPanel.hidden = !approximation;
  if (standardResult) standardResult.hidden = approximation;
  if (resultTitle) resultTitle.textContent = approximation ? "Registrar resultado" : "Marcar resultado";
  releaseButton.disabled = noRound || state.gameOver || state.released || (!approximation && !state.confirmed);
  releaseButton.firstChild.textContent = approximation ? "Liberar rodada no Painel da disputa " : "Liberar pergunta no Painel da disputa ";
  timerButton.disabled = noRound || state.gameOver || !state.released || Boolean(state.timerEndsAt) || state.timerExpired || Boolean(state.result);
  resultButtons.forEach((button) => { button.disabled = noRound || state.gameOver || approximation || !state.released || Boolean(state.result); button.classList.toggle("is-selected", state.result === button.dataset.result); });
  if (approximationButton) approximationButton.disabled = noRound || state.gameOver || !approximation || !state.released || state.approximationCalculated || Boolean(state.result);
  [finalTeam, finalBid, confirmButton].forEach((element) => { if (element) element.disabled = noRound || state.gameOver || approximation || Boolean(state.result) || state.confirmed; });
  if (state.confirmed && !approximation) { finalTeam.value = state.team; finalBid.value = Number.isInteger(state.bid) ? state.bid : ""; }
  if (valueVisibility) valueVisibility.textContent = state.result ? "revelado ao final da rodada" : state.valueRevealed ? "revelado no Painel da disputa" : state.config.ocultarValor ? "oculto das equipes" : "anunciado às equipes";
  if (revealButton) { revealButton.hidden = !(question && !approximation && state.config.ocultarValor && !state.result); revealButton.disabled = noRound || Boolean(state.result); revealButton.textContent = state.valueRevealed ? "Ocultar valor no Painel" : "Revelar valor no Painel"; }
  nextLotButton.hidden = !state.result || state.gameOver;
  if (startAnotherGameButton) startAnotherGameButton.hidden = !state.gameOver;
  if (approximationReleaseButton) approximationReleaseButton.hidden = !state.approximationCalculated || Boolean(state.result) || state.gameOver;
  if (endPanel) endPanel.hidden = state.gameOver;
  if (endGameButton) endGameButton.disabled = state.gameOver || (!state.result && !state.catalogExhausted);
  if (catalogLoadError) { status.textContent = "Catálogo indisponível"; message.textContent = "Não foi possível carregar as questões. Inicie pelo servidor local."; return; }
  if (noRound) { status.textContent = "Catálogo esgotado"; message.textContent = "Não há mais perguntas disponíveis. Adicione novas questões ao catálogo para continuar."; displays.forEach((element) => { element.textContent = formatTime(state.config.timerSeconds); }); return; }
  if (state.gameOver) { status.textContent = "Partida encerrada"; message.textContent = "Acompanhe o ranking final no Painel da disputa."; displays.forEach((element) => { element.textContent = formatTime(state.config.timerSeconds); }); return; }
  if (state.result) { status.textContent = "Rodada encerrada"; message.textContent = approximation ? "Apostas distribuídas entre a(s) equipe(s) mais próxima(s)." : state.result === "correct" ? "Resultado: lote adquirido e saldo atualizado." : "Resultado: lance redistribuído e saldos atualizados."; }
  else if (state.approximationCalculated) { status.textContent = "Respostas calculadas"; message.textContent = "Respostas foram exibidas. Libere resposta correta e equipe vencedora."; }
  else if (!state.released) { status.textContent = "Privada — pronta para liberação"; message.textContent = approximation ? "Libere a rodada quando todas as equipes estiverem prontas para responder." : state.confirmed ? "Lance confirmado e saldo descontado. Libere a pergunta quando estiver pronto." : "Confirme o lance e libere a pergunta para iniciar o tempo."; }
  else if (state.timerExpired) { status.textContent = "Exibida no Painel da disputa"; message.textContent = approximation ? "Tempo encerrado. Registre respostas e calcule resultado." : "Tempo encerrado. Marque o resultado da resposta manualmente."; }
  else if (state.timerEndsAt) { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Tempo em andamento no Painel da disputa."; }
  else { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Rodada liberada. Inicie o tempo quando as equipes estiverem prontas."; }
  const seconds = state.timerEndsAt ? remainingSeconds(state) : state.config.timerSeconds;
  displays.forEach((element) => { element.textContent = state.timerExpired ? "Tempo encerrado" : formatTime(seconds); });
}

function renderPublicApproximationAnswers(state) {
  const panel = document.querySelector("[data-public-approximation-answers]"); const list = document.querySelector("[data-public-approximation-answer-list]");
  if (!panel || !list) return;
  const answers = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
  const bets = new Map(state.approximationBets.map((bet) => [bet.team, bet.value]));
  list.replaceChildren(...state.teams.map((team) => {
    const item = document.createElement("li"); item.className = "public-approximation-answer"; item.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"); name.textContent = team.name;
    const answerMetric = document.createElement("span"); answerMetric.className = "public-approximation-metric";
    const answerValue = document.createElement("b"); answerValue.className = "public-approximation-answer-value"; answerValue.textContent = formatApproximationValue(answers.get(team.name));
    answerMetric.append(answerValue);
    const betMetric = document.createElement("span"); betMetric.className = "public-approximation-metric public-approximation-metric--bet";
    const betValue = document.createElement("b"); betValue.className = "public-approximation-bet-value"; setMoneyValue(betValue, bets.get(team.name));
    betMetric.append(betValue);
    item.append(dot, name, answerMetric, betMetric); return item;
  }));
  panel.hidden = false;
}

function renderPublicResult(state) {
  const question = getQuestion(state); const title = document.querySelector("[data-public-result-title]"); const message = document.querySelector("[data-public-result-message]"); const recipients = document.querySelector("[data-public-recipients]"); const shareValue = document.querySelector("[data-public-share]"); const correctAnswer = document.querySelector("[data-public-correct-answer]"); const panel = document.querySelector("[data-public-result]");
  const winningTeam = state.result === "approximation" ? state.teams.find((team) => state.winningTeams.includes(team.name)) : state.teams.find((team) => team.name === state.team);
  if (panel) {
    panel.classList.toggle("is-celebration", state.result === "correct" || state.result === "approximation");
    panel.classList.toggle("is-setback", state.result === "wrong");
    panel.style.setProperty("--result-color", state.result === "wrong" ? "var(--coral)" : winningTeam?.color || "var(--teal)");
  }
  if (state.result === "approximation") {
    const winners = state.winningTeams.join(" e ");
    const pot = state.approximationBets.reduce((total, bet) => total + Math.max(0, Math.trunc(Number(bet.value) || 0)), 0);
    const share = Math.floor(pot / state.winningTeams.length);
    const answers = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
    const winnerAnswers = state.winningTeams.map((team) => formatApproximationValue(answers.get(team))).join(" e ");
    title.textContent = `${winners} ${state.winningTeams.length === 1 ? "ficou mais próxima" : "ficaram mais próximas"}`;
    message.textContent = `${state.winningTeams.length === 1 ? "Resposta da equipe" : "Respostas das equipes"}: ${winnerAnswers}. ${state.winningTeams.length === 1 ? "Lote adquirido." : "Lotes adquiridos."}`;
    recipients.hidden = false; recipients.querySelector("p").textContent = state.winningTeams.length === 1 ? "Total das apostas recebido:" : "Valor recebido por cada equipe empatada:"; setMoneyValue(shareValue, share);
    correctAnswer.textContent = `Resposta correta: ${question.resposta}`; correctAnswer.hidden = false;
    return;
  }
  if (state.result === "correct") { title.textContent = "Lote adquirido"; message.textContent = `${state.team} acertou a resposta e adquiriu o lote.`; recipients.hidden = true; correctAnswer.hidden = true; return; }
  const share = Math.floor(state.bid / (state.teams.length - 1));
  title.textContent = "Lote não adquirido"; message.textContent = `${state.team} não acertou a resposta.`; setMoneyValue(shareValue, share); recipients.querySelector("p").textContent = "Valor recebido pelas outras equipes:"; correctAnswer.textContent = `Resposta correta: ${question?.resposta || ""}`; recipients.hidden = false; correctAnswer.hidden = false;
}

function renderPublicRanking(state) {
  const ranking = document.querySelector("[data-public-ranking]");
  if (!ranking) return;
  ranking.replaceChildren(...state.teams.map((team) => {
    const item = document.createElement("li"); item.className = "public-ranking-team"; item.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true"); const name = document.createElement("strong"); name.textContent = team.name;
    const stats = document.createElement("span"); stats.className = "public-team-stats";
    const lots = document.createElement("span"); lots.className = "public-team-stat public-team-stat--lots"; const lotLabel = document.createElement("small"); lotLabel.textContent = "Lotes"; const lotValue = document.createElement("b"); lotValue.textContent = team.lots; lots.append(lotLabel, lotValue);
    const balance = document.createElement("span"); balance.className = "public-team-stat public-team-stat--balance"; const balanceLabel = document.createElement("small"); balanceLabel.textContent = "Saldo"; const balanceValue = document.createElement("b"); setMoneyValue(balanceValue, team.balance); balance.append(balanceLabel, balanceValue);
    stats.append(lots, balance); item.append(dot, name, stats); return item;
  }));
}

function renderPublicRoundContext(state, question) {
  const context = document.querySelector("[data-public-round-context]");
  if (!context) return;
  context.replaceChildren();
  if (isApproximation(question)) {
    const message = document.createElement("strong"); message.textContent = "Todas as equipes respondem";
    const detail = document.createElement("span"); detail.textContent = "Vence quem chegar mais perto e leva o total das apostas.";
    context.append(message, detail); return;
  }
  const winner = state.teams.find((team) => team.name === state.team);
  const dot = document.createElement("span"); dot.className = "team-dot"; dot.style.setProperty("--team-color", winner?.color || defaultTeamColors[0]); dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("strong"); name.textContent = state.team; const detail = document.createElement("span"); detail.textContent = "assumiu o lote por "; const bid = document.createElement("b"); setMoneyValue(bid, state.bid); detail.append(bid); context.append(dot, name, detail);
}

function renderFinalRanking(state) {
  const list = document.querySelector("[data-final-list]");
  if (!list) return;
  list.replaceChildren(...state.standings.map((team, index) => {
    const item = document.createElement("li"); item.className = "final-rank-item"; item.style.setProperty("--team-color", team.color);
    const rank = document.createElement("span"); rank.className = "final-rank-position"; rank.textContent = String(index + 1);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"); name.textContent = team.name;
    const stats = document.createElement("span"); stats.className = "final-rank-stats";
    const lots = document.createElement("b"); lots.textContent = `${team.lots} ${team.lots === 1 ? "lote" : "lotes"}`;
    const detail = document.createElement("small"); setMoneyValue(detail, team.balance);
    stats.append(lots, detail); item.append(rank, dot, name, stats); return item;
  }));
}

function showPublicFailure(message) {
  const failure = document.querySelector("[data-public-failure]");
  const failureMessage = document.querySelector("[data-public-failure-message]");
  if (failureMessage) failureMessage.textContent = message;
  if (failure) failure.hidden = false;
}

function presentPublicState(shell, nextState) {
  const previousState = publicPresentationState;
  publicPresentationState = nextState;
  shell.dataset.publicState = nextState;
  if (!previousState || previousState === nextState || typeof Element.prototype.animate !== "function") return;

  const targetSelector = {
    waiting: "[data-public-waiting]",
    setup: "[data-public-start-waiting]",
    failure: "[data-public-failure]",
    released: "[data-public-round]",
    "released-answers": "[data-public-round]",
    result: "[data-public-result]",
    final: "[data-final-ranking]"
  }[nextState];
  const target = targetSelector ? shell.querySelector(targetSelector) : null;
  if (!target || target.hidden) return;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const styles = getComputedStyle(document.documentElement);
  const duration = Number.parseFloat(styles.getPropertyValue(reducedMotion ? "--motion-reduced" : "--motion-state")) || (reducedMotion ? 160 : 260);
  const easing = styles.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.23, 1, 0.32, 1)";
  target.animate(
    reducedMotion
      ? [{ opacity: 0.78 }, { opacity: 1 }]
      : [{ opacity: 0, transform: "translateY(2%) scale(0.985)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
    { duration, easing }
  );
}

function renderPublicPanel() {
  const shell = document.querySelector(".public-shell"); if (!shell) return;
  const state = readRoundState(); const question = getQuestion(state); renderQuestion(state);
  const waiting = document.querySelector("[data-public-waiting]"); const startWaiting = document.querySelector("[data-public-start-waiting]"); const round = document.querySelector("[data-public-round]"); const result = document.querySelector("[data-public-result]"); const final = document.querySelector("[data-final-ranking]"); const teaser = document.querySelector("[data-public-teaser]"); const approximationAnswers = document.querySelector("[data-public-approximation-answers]"); const failure = document.querySelector("[data-public-failure]");
  renderSyncStatus();
  const hasSavedRound = Boolean(localStorage.getItem(roundStorageKey));
  if (catalogLoadError || (syncStatus === "offline" && !hasSavedRound)) {
    if (waiting) waiting.hidden = true; if (startWaiting) startWaiting.hidden = true; if (round) round.hidden = true; if (result) result.hidden = true; if (final) final.hidden = true; if (approximationAnswers) approximationAnswers.hidden = true;
    showPublicFailure(catalogLoadError ? "Não foi possível carregar as questões. Verifique se o servidor da partida está em execução." : "Não foi possível conectar ao estado da partida. Verifique a rede e tente novamente.");
    presentPublicState(shell, "failure");
    return;
  }
  if (failure) failure.hidden = true;
  const gameOver = Boolean(state.gameOver);
  if (final) final.hidden = !gameOver;
  if (gameOver) { if (startWaiting) startWaiting.hidden = true; waiting.hidden = true; round.hidden = true; result.hidden = true; if (approximationAnswers) approximationAnswers.hidden = true; renderFinalRanking(state); presentPublicState(shell, "final"); return; }
  if (state.awaitingSetup) { if (startWaiting) startWaiting.hidden = false; waiting.hidden = true; round.hidden = true; result.hidden = true; if (final) final.hidden = true; if (teaser) teaser.hidden = true; if (approximationAnswers) approximationAnswers.hidden = true; presentPublicState(shell, "setup"); return; }
  if (startWaiting) startWaiting.hidden = true;
  if (teaser) teaser.hidden = !question || isApproximation(question);
  waiting.hidden = state.released || Boolean(state.result); round.hidden = !state.released || Boolean(state.result) || !question; result.hidden = !state.result;
  round.classList.toggle("is-answers-only", Boolean(state.approximationCalculated && !state.result));
  if (state.result) { renderPublicResult(state); presentPublicState(shell, "result"); return; }
  if (approximationAnswers) approximationAnswers.hidden = true;
  if (!state.released) { renderPublicRanking(state); presentPublicState(shell, "waiting"); return; }
  renderPublicRoundContext(state, question);
  if (state.approximationCalculated) renderPublicApproximationAnswers(state);
  const timer = document.querySelector("[data-public-timer]"); const note = document.querySelector("[data-public-timer-note]");
  if (state.timerExpired) { timer.textContent = "Tempo encerrado"; timer.classList.add("is-ended"); note.textContent = "Aguardando a decisão do leiloeiro."; }
  else if (state.timerEndsAt) { timer.textContent = formatTime(remainingSeconds(state)); timer.classList.remove("is-ended"); note.textContent = "Tempo de resposta em andamento."; }
  else { timer.textContent = formatTime(state.config.timerSeconds); timer.classList.remove("is-ended"); note.textContent = "Aguardando o início do tempo."; }
  presentPublicState(shell, state.approximationCalculated ? "released-answers" : "released");
}

function settleExpiredTimer() {
  const state = readRoundState();
  if (!state.timerEndsAt || remainingSeconds(state) !== 0) return false;
  saveRoundState({ timerEndsAt: null, timerExpired: true });
  return true;
}

function refreshActiveTimer() {
  if (settleExpiredTimer()) {
    renderAuctioneer();
    renderPublicPanel();
    return;
  }

  const state = readRoundState();
  if (!state.timerEndsAt || state.timerExpired || state.result || state.gameOver) return;
  const timerValue = formatTime(remainingSeconds(state));
  document.querySelectorAll("[data-timer-display]").forEach((display) => {
    if (display.textContent !== timerValue) display.textContent = timerValue;
  });
  const publicTimer = document.querySelector("[data-public-timer]");
  if (publicTimer && publicTimer.textContent !== timerValue) {
    publicTimer.textContent = timerValue;
    publicTimer.classList.remove("is-ended");
  }
  const publicTimerNote = document.querySelector("[data-public-timer-note]");
  if (publicTimerNote) publicTimerNote.textContent = "Tempo de resposta em andamento.";
}
function applyResult(result) {
  const state = readRoundState(); const question = getQuestion(state); if (state.result || !state.confirmed || !question || !isAuctionQuestion(question)) return;
  const share = Math.floor(state.bid / (state.teams.length - 1));
  const teams = state.teams.map((team) => {
    if (team.name !== state.team) return result === "wrong" ? { ...team, balance: team.balance + share } : team;
    const debitedBalance = state.bidDebited ? team.balance : team.balance - state.bid;
    return result === "correct" ? { ...team, balance: debitedBalance + question.valorLote, lots: team.lots + 1 } : { ...team, balance: debitedBalance };
  });
  saveRoundState({ teams, bidDebited: true, result, timerEndsAt: null, timerExpired: true });
}

function getApproximationTarget(answer) {
  const match = String(answer || "").match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : NaN;
}

function calculateApproximation() {
  const state = readRoundState(); const question = getQuestion(state); const approximationAnswers = [...document.querySelectorAll("[data-approximation-team]")].map((input) => ({ team: input.dataset.approximationTeam, value: input.value.trim() })); const approximationBets = [...document.querySelectorAll("[data-approximation-bet]")].map((input) => ({ team: input.dataset.approximationBet, value: input.value.trim() })); const target = getApproximationTarget(question?.resposta);
  const invalidAnswer = approximationAnswers.find((answer) => answer.value === "" || !Number.isFinite(Number(answer.value)));
  const invalidBet = approximationBets.find((bet) => bet.value === "" || !Number.isInteger(Number(bet.value)) || Number(bet.value) < 0 || Number(bet.value) > Math.floor(state.teams.find((team) => team.name === bet.team)?.balance || 0));
  if (!isApproximation(question) || state.result || state.approximationCalculated || !state.released || !Number.isFinite(target) || invalidAnswer || invalidBet) return;
  const distances = approximationAnswers.map((answer) => ({ team: answer.team, distance: Math.abs(Number(answer.value) - target) }));
  const smallestDistance = Math.min(...distances.map((answer) => answer.distance));
  const selected = distances.filter((answer) => Math.abs(answer.distance - smallestDistance) < 1e-9).map((answer) => answer.team);
  saveRoundState({ winningTeams: selected, approximationAnswers, approximationBets, approximationCalculated: true, timerEndsAt: null, timerExpired: true });
}

function applyApproximationResult() {
  const state = readRoundState(); const question = getQuestion(state); const selected = state.winningTeams;
  if (!isApproximation(question) || state.result || !state.approximationCalculated || !selected.length) return;
  const bets = new Map(state.approximationBets.map((bet) => [bet.team, Math.max(0, Math.trunc(Number(bet.value) || 0))]));
  const pot = [...bets.values()].reduce((total, bet) => total + bet, 0);
  const share = Math.floor(pot / selected.length);
  const teams = state.teams.map((team) => ({ ...team, balance: team.balance - (bets.get(team.name) || 0) + (selected.includes(team.name) ? share : 0), lots: team.lots + (selected.includes(team.name) ? 1 : 0) }));
  saveRoundState({ teams, result: "approximation", timerEndsAt: null, timerExpired: true });
}

function computeFinalStandings(state) {
  return state.teams.map((team) => ({ name: team.name, color: team.color, balance: team.balance, lots: team.lots }))
    .sort((a, b) => b.lots - a.lots || b.balance - a.balance);
}

function startSelectedLot(filter) {
  const state = readRoundState();
  saveRoundState({ team: "", bid: null, bidDebited: false, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationBets: [], approximationCalculated: false, valueRevealed: false, ...chooseNextQuestion(state, filter) });
  const finalTeam = document.querySelector("#final-team"); const finalBid = document.querySelector("#final-bid"); const chooser = document.querySelector("[data-next-lot-chooser]");
  if (finalTeam) finalTeam.value = ""; if (finalBid) finalBid.value = ""; if (chooser) chooser.hidden = true; pendingLotFilter = null;
  renderAuctioneer();
}

function endGame() {
  const state = readRoundState();
  if (!state.result && !state.catalogExhausted) return;
  if (!window.confirm("Encerrar a partida e exibir o ranking final?")) return;
  saveRoundState({ gameOver: true, standings: computeFinalStandings(state) });
  const chooser = document.querySelector("[data-next-lot-chooser]"); if (chooser) chooser.hidden = true;
  renderAuctioneer();
}

function startNewGame(teams, config) {
  const base = { ...initialRoundState, teams, usedQuestionIds: [], config: normaliseConfig(config) };
  const next = saveLocalRoundState({ ...base, ...chooseNextQuestion(base) });
  queueRoundStatePublish(next);
}

function prepareAnotherGame() {
  const next = saveLocalRoundState({ ...initialRoundState, awaitingSetup: true });
  queueRoundStatePublish(next);
  window.location.href = "leiloeiro.html";
}

function initialiseSetup() {
  const startButton = document.querySelector("#start-game"); if (!startButton) return;
  const state = readRoundState();
  const activeGame = Boolean(state.currentQuestionId || state.usedQuestionIds.length || state.result);
  const fromMatch = new URLSearchParams(window.location.search).get("from") === "partida";
  const activeChoice = document.querySelector("[data-active-game-choice]");
  const startLabel = document.querySelector("[data-start-game-label]");
  if (activeChoice) activeChoice.hidden = !(activeGame && fromMatch);
  if (startLabel) startLabel.textContent = activeGame ? "Iniciar nova partida" : "Iniciar partida";
  state.teams.forEach((team, index) => { const name = document.querySelector(`#team-${index + 1}`); const color = document.querySelector(`#color-${index + 1}`); name.value = team.name; color.value = team.color; name.closest(".team-field").style.setProperty("--team-color", team.color); });
  const ocultarValor = document.querySelector("#config-ocultar-valor"); const capLance = document.querySelector("#config-cap-lance"); const timerSeconds = document.querySelector("#config-timer-seconds");
  if (ocultarValor) ocultarValor.checked = state.config.ocultarValor;
  if (capLance) capLance.value = state.config.capLance;
  if (timerSeconds) timerSeconds.value = state.config.timerSeconds;
  startButton.addEventListener("click", () => {
    const teams = [0, 1, 2, 3].map((index) => ({ name: document.querySelector(`#team-${index + 1}`).value.trim(), color: document.querySelector(`#color-${index + 1}`).value, balance: 1000, lots: 0 }));
    const names = teams.map((team) => team.name.toLocaleLowerCase("pt-BR")); const message = document.querySelector("#setup-message");
    if (catalogLoadError || !questions().length) { message.textContent = "Não foi possível carregar o catálogo de questões. Inicie o servidor local e tente novamente."; return; }
    if (teams.some((team) => !team.name) || new Set(names).size !== teams.length) { message.textContent = "Informe quatro nomes diferentes para iniciar a partida."; return; }
    const config = { ocultarValor: ocultarValor ? ocultarValor.checked : true, capLance: capLance ? capLance.value : 50, timerSeconds: timerSeconds ? timerSeconds.value : 45 };
    startNewGame(teams, config); window.location.href = "partida.html";
  });
}

function initialiseAuctioneerAccess() {
  if (!document.body.matches("[data-auctioneer-access]")) return true;
  const gate = document.querySelector("[data-access-gate]");
  const content = document.querySelector("[data-private-content]");
  const form = document.querySelector("[data-access-form]");
  const password = document.querySelector("#access-password");
  const message = document.querySelector("[data-access-message]");
  const grantAccess = () => { sessionStorage.setItem(auctioneerAccessKey, "granted"); gate.hidden = true; content.hidden = false; };
  if (sessionStorage.getItem(auctioneerAccessKey) === "granted") { grantAccess(); return true; }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (password.value === auctioneerPassword) { grantAccess(); window.location.reload(); return; }
    message.textContent = "Senha incorreta. Tente novamente.";
    password.select();
  });
  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!initialiseAuctioneerAccess()) return;
  await loadQuestionCatalog();
  await initialiseStateSync();
  keepRoundConnectionAlive();
  initialiseSetup();
  const confirmButton = document.querySelector("#confirm-final-bid");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => { const state = readRoundState(); if (state.confirmed) return; const team = document.querySelector("#final-team").value; const bidInput = document.querySelector("#final-bid"); const bid = Number(bidInput.value); if (!team || !Number.isInteger(bid) || bid < 0) { bidInput.setCustomValidity("Informe um lance inteiro em reais."); bidInput.reportValidity(); return; } const biddingTeam = state.teams.find((entry) => entry.name === team); const balance = Math.floor(Number(biddingTeam?.balance) || 0); const cap = state.config.capLance; const maxBid = cap > 0 ? Math.floor(balance * cap / 100) : balance; if (bid > maxBid) { const limitText = cap > 0 ? `Teto de lance: ${cap}% do saldo (máximo ${formatMoney(maxBid)}).` : `Saldo disponível: ${formatMoney(maxBid)}.`; bidInput.setCustomValidity(limitText); bidInput.reportValidity(); return; } bidInput.setCustomValidity(""); const teams = state.teams.map((entry) => entry.name === team ? { ...entry, balance: entry.balance - bid } : entry); saveRoundState({ teams, team, bid, bidDebited: true, confirmed: true, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationBets: [], approximationCalculated: false, valueRevealed: false }); renderAuctioneer(); });
    document.querySelector("#release-question").addEventListener("click", () => { saveRoundState({ released: true }); renderAuctioneer(); });
    document.querySelector("#start-timer").addEventListener("click", () => { const state = readRoundState(); saveRoundState({ timerEndsAt: Date.now() + (state.config.timerSeconds * 1000), timerExpired: false }); renderAuctioneer(); });
    document.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => { applyResult(button.dataset.result); renderAuctioneer(); }));
    document.querySelector("#confirm-approximation").addEventListener("click", () => { const state = readRoundState(); const answers = [...document.querySelectorAll("[data-approximation-team]")]; const bets = [...document.querySelectorAll("[data-approximation-bet]")]; const invalidAnswer = answers.find((input) => input.value.trim() === "" || !Number.isFinite(Number(input.value))); if (invalidAnswer) { invalidAnswer.setCustomValidity("Registre a resposta desta equipe."); invalidAnswer.reportValidity(); return; } const invalidBet = bets.find((input) => { const balance = Math.floor(state.teams.find((team) => team.name === input.dataset.approximationBet)?.balance || 0); return input.value.trim() === "" || !Number.isInteger(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > balance; }); if (invalidBet) { invalidBet.setCustomValidity("Informe uma aposta inteira entre R$ 0 e o saldo da equipe."); invalidBet.reportValidity(); return; } [...answers, ...bets].forEach((input) => input.setCustomValidity("")); calculateApproximation(); renderAuctioneer(); });
    const revealButton = document.querySelector("#reveal-value");
    if (revealButton) revealButton.addEventListener("click", () => { const state = readRoundState(); saveRoundState({ valueRevealed: !state.valueRevealed }); renderAuctioneer(); });
    const approximationReleaseButton = document.querySelector("#release-approximation-result");
    if (approximationReleaseButton) approximationReleaseButton.addEventListener("click", () => { applyApproximationResult(); renderAuctioneer(); });
    const startAnotherGameButton = document.querySelector("#start-another-game");
    if (startAnotherGameButton) startAnotherGameButton.addEventListener("click", () => prepareAnotherGame());
    document.querySelector("#prepare-next-lot").addEventListener("click", () => {
      const state = readRoundState(); const chooser = document.querySelector("[data-next-lot-chooser]");
      const remaining = questions().filter((question) => !state.usedQuestionIds.includes(question.id));
      if (!remaining.length) { endGame(); return; }
      chooser.hidden = false; renderNextLotChooser(state);
    });
    const confirmNextLot = document.querySelector("#confirm-next-lot");
    if (confirmNextLot) confirmNextLot.addEventListener("click", () => { if (!pendingLotFilter) return; startSelectedLot(pendingLotFilter); });
    const cancelChooser = document.querySelector("#cancel-chooser");
    if (cancelChooser) cancelChooser.addEventListener("click", () => { const chooser = document.querySelector("[data-next-lot-chooser]"); if (chooser) chooser.hidden = true; });
    const endGameButton = document.querySelector("#end-game");
    if (endGameButton) endGameButton.addEventListener("click", () => endGame());
  }
  const retryPublicConnection = document.querySelector("#retry-public-connection");
  if (retryPublicConnection) retryPublicConnection.addEventListener("click", () => initialiseStateSync());
  window.addEventListener("storage", () => { renderAuctioneer(); renderPublicPanel(); });
  setInterval(refreshActiveTimer, 250);
  renderAuctioneer(); renderPublicPanel();
});
