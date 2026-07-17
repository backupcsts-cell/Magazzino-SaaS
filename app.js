/**
 * APP.JS - Frontend statico (GitHub Pages) di Magazzino Cloud Pro.
 *
 * Struttura del file:
 *   1) Login Email + OTP (nuovo)
 *   2) callApi() + shim di google.script.run (nuovo) - permette al codice applicativo
 *      esistente (ex JavaScript.html), che chiamava google.script.run.withSuccessHandler
 *      (...).withFailureHandler(...).nomeFunzione(args), di continuare a funzionare
 *      SENZA MODIFICHE, semplicemente instradando quelle chiamate verso fetch() sul
 *      backend Apps Script pubblicato come API JSON.
 *   3) avviaApp_() - contiene la logica applicativa originale (tabs, form, tabelle,
 *      dashboard, modali, export, backup...), invariata rispetto alla versione
 *      precedente, ma eseguita solo DOPO che il login è andato a buon fine.
 */

(function () {
  'use strict';

  const CFG = window.MAGAZZINO_CONFIG || {};
  const STORAGE_KEY = 'mc_sessione';

  // ---------------------------------------------------------------------
  // 1) LOGIN EMAIL + OTP
  // ---------------------------------------------------------------------

  const loginScreen = document.getElementById('loginScreen');
  const loginStepEmail = document.getElementById('loginStepEmail');
  const loginStepOtp = document.getElementById('loginStepOtp');
  const loginStatus = document.getElementById('loginStatus');
  const formLoginEmail = document.getElementById('formLoginEmail');
  const formLoginOtp = document.getElementById('formLoginOtp');
  const btnInviaOtp = document.getElementById('btnInviaOtp');
  const btnVerificaOtp = document.getElementById('btnVerificaOtp');
  const btnCambiaEmail = document.getElementById('btnCambiaEmail');
  const btnRinviaOtp = document.getElementById('btnRinviaOtp');
  const btnLogout = document.getElementById('btnLogout');
  const appEl = document.getElementById('app');
  const topbarEl = document.querySelector('.topbar');

  let emailInAttesa = '';

  function mostraStatoLogin_(messaggio, tipo) {
    loginStatus.textContent = messaggio || '';
    loginStatus.className = 'status-msg' + (messaggio ? ' ' + (tipo || 'err') : '');
  }

  function grezzoFetch_(action, params, richiedeToken) {
    const sessione = leggiSessione_();
    const body = Object.assign(
      { action: action, appKey: CFG.APP_KEY },
      richiedeToken ? { token: sessione ? sessione.token : null } : {},
      params || {}
    );
    return fetch(CFG.API_URL, {
      method: 'POST',
      // BUGFIX/NOTA TECNICA: Content-Type "text/plain" (anziché "application/json") fa
      // sì che il browser tratti questa POST come "simple request" e non invii una
      // preflight OPTIONS, che i Web App di Apps Script non sanno gestire. Il corpo
      // resta comunque una stringa JSON valida: il backend la fa il parsing con
      // JSON.parse(e.postData.contents), indipendentemente dall'header dichiarato.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    })
      .then(r => r.json())
      .then(res => {
        if (!res.ok) throw new Error(res.error || 'Errore sconosciuto.');
        return res.data;
      });
  }

  function leggiSessione_() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function salvaSessione_(sess) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
  }
  function cancellaSessione_() {
    localStorage.removeItem(STORAGE_KEY);
  }

  formLoginEmail.addEventListener('submit', function (e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) return;
    btnInviaOtp.disabled = true;
    btnInviaOtp.innerHTML = '<span class="login-spinner"></span> Invio in corso...';
    mostraStatoLogin_('');

    grezzoFetch_('richiediOtp', { email: email }, false)
      .then(() => {
        emailInAttesa = email;
        document.getElementById('loginEmailRiepilogo').textContent = email;
        loginStepEmail.classList.remove('active');
        loginStepOtp.classList.add('active');
        document.getElementById('loginOtp').focus();
        mostraStatoLogin_('Se l\'indirizzo è abilitato, riceverai un codice a breve.', 'ok');
      })
      .catch(err => mostraStatoLogin_(err.message, 'err'))
      .finally(() => {
        btnInviaOtp.disabled = false;
        btnInviaOtp.textContent = 'Invia Codice di Accesso';
      });
  });

  formLoginOtp.addEventListener('submit', function (e) {
    e.preventDefault();
    const otp = document.getElementById('loginOtp').value.trim();
    if (!otp) return;
    btnVerificaOtp.disabled = true;
    btnVerificaOtp.innerHTML = '<span class="login-spinner"></span> Verifica in corso...';
    mostraStatoLogin_('');

    grezzoFetch_('verificaOtp', { email: emailInAttesa, otp: otp }, false)
      .then(sess => {
        // Durata sessione lato client: solo indicativa (per decidere se saltare la
        // schermata di login ad un successivo avvio); la vera scadenza è sempre
        // applicata dal backend (validaSessione_ in Auth.js) ad ogni chiamata.
        salvaSessione_({
          token: sess.token,
          email: sess.email,
          nome: sess.nome,
          role: sess.role,
          creato: Date.now()
        });
        entraNellApp_(sess);
      })
      .catch(err => mostraStatoLogin_(err.message, 'err'))
      .finally(() => {
        btnVerificaOtp.disabled = false;
        btnVerificaOtp.textContent = 'Conferma e Accedi';
      });
  });

  btnCambiaEmail.addEventListener('click', function () {
    loginStepOtp.classList.remove('active');
    loginStepEmail.classList.add('active');
    mostraStatoLogin_('');
    document.getElementById('loginOtp').value = '';
  });

  btnRinviaOtp.addEventListener('click', function () {
    if (!emailInAttesa) return;
    mostraStatoLogin_('Invio di un nuovo codice...', 'ok');
    grezzoFetch_('richiediOtp', { email: emailInAttesa }, false)
      .then(() => mostraStatoLogin_('Nuovo codice inviato.', 'ok'))
      .catch(err => mostraStatoLogin_(err.message, 'err'));
  });

  btnLogout.addEventListener('click', function () {
    const sess = leggiSessione_();
    cancellaSessione_();
    if (sess && sess.token) {
      // Best-effort: revoca la sessione anche lato server. Non blocca il logout locale
      // se la chiamata fallisce (es. sessione già scaduta).
      grezzoFetch_('logout', { token: sess.token }, false).catch(() => {});
    }
    window.location.reload();
  });

  function entraNellApp_(sess) {
    document.body.dataset.role = sess.role;
    document.getElementById('userBadgeEmail').textContent = sess.email;
    document.getElementById('userBadgeRuolo').textContent = sess.role;
    const nomeEl = document.getElementById('userBadgeNome');
    if (sess.nome) { nomeEl.textContent = sess.nome; nomeEl.style.display = 'block'; }

    loginScreen.style.display = 'none';
    appEl.classList.add('visible');
    if (topbarEl) topbarEl.classList.add('visible');

    avviaApp_();
  }

  // All'avvio: se esiste già una sessione salvata, prova ad entrare direttamente.
  // Se il token risultasse nel frattempo scaduto/non valido, la prima chiamata API
  // (init, dentro avviaApp_ -> init()) fallirà e riportiamo l'utente al login.
  (function tentaAutoLogin_() {
    const sess = leggiSessione_();
    if (sess && sess.token) {
      entraNellApp_(sess);
    }
  })();

  // ---------------------------------------------------------------------
  // 2) callApi() + shim di google.script.run
  // ---------------------------------------------------------------------

  function callApi(action, params) {
    return grezzoFetch_(action, params, true).catch(err => {
      // Se il backend rifiuta la sessione (scaduta o revocata), forziamo un nuovo
      // login pulito invece di lasciare l'utente bloccato su una schermata rotta.
      const msg = String(err.message || '');
      if (msg.indexOf('Sessione') !== -1 || msg.indexOf('non autorizzat') !== -1) {
        cancellaSessione_();
        alert('Sessione scaduta o non valida. Effettua nuovamente il login.');
        window.location.reload();
      }
      throw err;
    });
  }

  const MAPPA_AZIONI_ = {
    getInizializzazione: () => callApi('init'),
    getGiacenze: () => callApi('getGiacenze'),
    getProdotti: () => callApi('getProdotti'),
    getAlerts: () => callApi('getAlerts'),
    eseguiCarico: (a) => callApi('eseguiCarico', { dati: a[0] }),
    eseguiScarico: (a) => callApi('eseguiScarico', { dati: a[0] }),
    salvaModificaArticolo: (a) => callApi('salvaModificaArticolo', { codice: a[0], descrizione: a[1], tipo: a[2], scortaMinima: a[3], note: a[4] }),
    eliminaArticoloCompleto: (a) => callApi('eliminaArticoloCompleto', { codice: a[0] }),
    getStoricoMovimenti: (a) => callApi('getStoricoMovimenti', { query: a[0], filtroOperazione: a[1], offset: a[2], limit: a[3] }),
    esportaGiacenzeCSV: () => callApi('esportaGiacenzeCSV'),
    esportaStoricoCSV: (a) => callApi('esportaStoricoCSV', { filtroCodice: a[0] }),
    generaHtmlPdfGiacenze: () => callApi('generaHtmlPdfGiacenze'),
    generaHtmlPdfSottoScorta: () => callApi('generaHtmlPdfSottoScorta'),
    salvaGiorniAvviso: (a) => callApi('salvaGiorniAvviso', { giorni: a[0] }),
    backupManuale: () => callApi('backupManuale'),
    elencoBackup: () => callApi('elencoBackup'),
    ripristinaBackup: (a) => callApi('ripristinaBackup', { fileId: a[0] })
  };

  function creaGoogleScriptRunShim_() {
    let successHandler = null;
    let failureHandler = null;
    const proxy = {
      withSuccessHandler(cb) { successHandler = cb; return proxy; },
      withFailureHandler(cb) { failureHandler = cb; return proxy; }
    };
    Object.keys(MAPPA_AZIONI_).forEach(nome => {
      proxy[nome] = function (...args) {
        // BUGFIX: fetch() è asincrono. Prima si catturano gli handler correnti in
        // variabili locali e SOLO DOPO si azzerano quelli condivisi: così, quando la
        // risposta arriva più tardi, .then()/.catch() richiamano ancora la callback
        // giusta invece di trovarla già a null (il bug che teneva bloccati i bottoni
        // su "...in corso" e non caricava mai giacenze/alerts).
        const onSuccess = successHandler;
        const onFailure = failureHandler;
        successHandler = null;
        failureHandler = null;

        MAPPA_AZIONI_[nome](args)
          .then(risultato => { if (onSuccess) onSuccess(risultato); })
          .catch(err => { if (onFailure) onFailure(err); else console.error(err); });
      };
    });
    return proxy;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', {
    get() { return creaGoogleScriptRunShim_(); }
  });

  // ---------------------------------------------------------------------
  // 3) LOGICA APPLICATIVA ORIGINALE (invariata, ex JavaScript.html)
  //    Eseguita solo dopo un login riuscito, tramite avviaApp_().
  // ---------------------------------------------------------------------

  window.avviaApp_ = function avviaApp_() {
const USER_ROLE = document.body.dataset.role || '';
const IS_ADMIN = USER_ROLE === 'Admin';

let localGiacenze = [];
let localAlerts = null;
let storicoDatiCorrenti = [];
let giacenzeSortDir = null;
let storicoSortDir = 'desc';

// PAGINAZIONE STORICO: invece di caricare l'intero registro movimenti in un colpo solo,
// si richiedono al backend blocchi di STORICO_PAGE_SIZE righe per volta (le più recenti
// per prime), e si espone un pulsante "Carica altre" per richiedere il blocco successivo.
// La ricerca (per Codice o Descrizione) e il filtro Tipo Operazione sono entrambi
// applicati lato server (vedi getStoricoMovimenti in Magazzino.js), così totale/haAltri
// riflettono sempre esattamente ciò che è filtrato, non solo la ricerca per codice.
const STORICO_PAGE_SIZE = 100;
let storicoOffset = 0;
let storicoQueryCorrente = '';
let storicoOperazioneCorrente = 'DEFAULT';
let storicoHaAltri = false;
let storicoTotaleRighe = 0;
let storicoCaricamentoInCorso = false;

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formattaDataItaliana(stringaData) {
  if (!stringaData || stringaData === 'Nessuna' || stringaData === '-') return '<span style="color:var(--text-muted);">Nessuna</span>';
  const d = new Date(stringaData);
  if (isNaN(d.getTime())) return escapeHtml(stringaData);
  return d.toLocaleDateString('it-IT');
}

function formattaDataOraItaliana(stringaDataOra) {
  if (!stringaDataOra) return '';
  const d = new Date(stringaDataOra);
  if (isNaN(d.getTime())) return escapeHtml(stringaDataOra);
  return d.toLocaleString('it-IT');
}

function aggiornaIndicatoreOrdinamento(thId, direzione) {
  const th = document.getElementById(thId);
  if (!th) return;
  const icona = th.querySelector('.sort-icon');
  if (icona) icona.textContent = direzione === 'asc' ? '▲' : direzione === 'desc' ? '▼' : '';
}

// ADATTABILITÀ SMARTPHONE/TABLET: la sidebar diventa un pannello a comparsa sotto la
// soglia definita in Stylesheet.html (.sidebar.open). Hamburger nella topbar, overlay
// di sfondo e pulsante di chiusura nella sidebar controllano tutti lo stesso stato.
const sidebarEl_ = document.querySelector('.sidebar');
const sidebarOverlayEl_ = document.getElementById('sidebarOverlay');
const menuToggleBtn_ = document.getElementById('menuToggleBtn');
const sidebarCloseBtn_ = document.getElementById('sidebarCloseBtn');

function apriSidebarMobile_() {
  if (sidebarEl_) sidebarEl_.classList.add('open');
  if (sidebarOverlayEl_) sidebarOverlayEl_.classList.add('active');
}
function chiudiSidebarMobile_() {
  if (sidebarEl_) sidebarEl_.classList.remove('open');
  if (sidebarOverlayEl_) sidebarOverlayEl_.classList.remove('active');
}
if (menuToggleBtn_) {
  menuToggleBtn_.addEventListener('click', function() {
    if (sidebarEl_ && sidebarEl_.classList.contains('open')) chiudiSidebarMobile_();
    else apriSidebarMobile_();
  });
}
if (sidebarCloseBtn_) sidebarCloseBtn_.addEventListener('click', chiudiSidebarMobile_);
if (sidebarOverlayEl_) sidebarOverlayEl_.addEventListener('click', chiudiSidebarMobile_);

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('tab-' + this.dataset.tab).classList.add('active');
    
    if (this.dataset.tab === 'esporta' && document.getElementById('tabellaBackup')) {
      aggiornaListaBackup();
    }
    if (this.dataset.tab === 'storico') {
      eseguiCaricaStorico('');
    }

    // Su smartphone/tablet il menu si chiude automaticamente dopo la selezione,
    // per lasciare subito spazio al contenuto della tab scelta.
    chiudiSidebarMobile_();
  });
});

function init() {
  google.script.run.withSuccessHandler(data => {
    localGiacenze = data.giacenze;
    localAlerts = data.alerts;
    renderizzaDashboard(data.alerts);
    renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
    aggiornaIndicatoreOrdinamento('thGiacenzeScadenza', giacenzeSortDir);
    aggiornaIndicatoreOrdinamento('thStoricoData', storicoSortDir);
    
    popolaTendinaScarico(data.giacenze);

    const inputGiorni = document.querySelector('#formImpostazioni [name=giorniAvviso]');
    if (inputGiorni) inputGiorni.value = data.config.GiorniAvvisoScadenza || 30;
    
    const linkSheet = document.getElementById('linkSheet');
    if (linkSheet && data.spreadsheetUrl) linkSheet.href = data.spreadsheetUrl;
  }).getInizializzazione();
}

function popolaTendinaScarico(giacenze) {
  const select = document.getElementById('selectScaricoRapido');
  if (!select) return;
  
  select.innerHTML = '<option value="">-- Seleziona un articolo lotto per autocompilare o scrivi sotto --</option>';
  
  const disponibili = giacenze.filter(g => (Number(g.quantita) || 0) > 0);
  disponibili.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.codice;
    opt.dataset.lotto = g.lotto || '';
    
    let d = new Date(g.scadenza);
    let scadenzaTesto = (g.scadenza && !isNaN(d.getTime())) ? d.toLocaleDateString('it-IT') : 'Nessuna';
    opt.textContent = `${g.codice} - ${g.descrizione} [Lotto: ${g.lotto || 'N.D.'} | Scad: ${scadenzaTesto}] (Disp: ${g.quantita})`;
    select.appendChild(opt);
  });
}

// NAVIGAZIONE RAPIDA DASHBOARD -> CARICO/SCARICO, con precompilazione dei campi.
// Visibile e utilizzabile da TUTTI gli utenti (non solo Admin).
// BUGFIX: la Soglia Scorta Minima dell'articolo (già nota da Giacenze Correnti, vedi
// tr.dataset.scortaMinima in renderizzaTabellaGiacenze) non veniva precompilata insieme
// agli altri campi. Il form di Carico invia la soglia solo se il campo NON è vuoto (vedi
// eseguiCarico in Magazzino.js), quindi lasciarlo vuoto di per sé non la azzera già oggi;
// tuttavia mostrare il valore attuale evita che l'utente lo veda come "non impostato" e
// digiti una nuova soglia diversa da quella reale, sovrascrivendola per errore durante un
// semplice carico merci.
function vaiACaricoConDati(codice, descrizione, tipo, lotto, scadenza, scortaMinima) {
  const navBtn = document.querySelector('.nav-btn[data-tab="carico"]');
  if (navBtn) navBtn.click();

  const inCodice = document.getElementById('caricoCodice');
  const inDescrizione = document.getElementById('caricoDescrizione');
  const inTipo = document.getElementById('caricoTipo');
  const inLotto = document.getElementById('caricoLotto');
  const inScadenza = document.getElementById('caricoScadenza');
  const inQuantita = document.getElementById('caricoQuantita');
  const inScortaMinima = document.getElementById('caricoScortaMinima');

  if (inCodice) inCodice.value = codice || '';
  if (inDescrizione) inDescrizione.value = descrizione || '';
  if (inTipo && tipo) inTipo.value = tipo;
  if (inLotto) inLotto.value = lotto || '';
  if (inScadenza) inScadenza.value = scadenza || '';
  if (inScortaMinima) inScortaMinima.value = (scortaMinima !== undefined && scortaMinima !== null && String(scortaMinima).trim() !== '') ? Number(scortaMinima) : '';
  if (inQuantita) { inQuantita.value = ''; inQuantita.focus(); }
}

function vaiAScaricoConDati(codice, lotto) {
  const navBtn = document.querySelector('.nav-btn[data-tab="scarico"]');
  if (navBtn) navBtn.click();

  const inCodice = document.getElementById('inputScaricoCodice');
  const inLotto = document.getElementById('inputScaricoLotto');
  const inQuantita = document.getElementById('scaricoQuantita');

  if (inCodice) inCodice.value = codice || '';
  if (inLotto) inLotto.value = lotto || '';
  if (inQuantita) { inQuantita.value = ''; inQuantita.focus(); }
}

const selectScarico = document.getElementById('selectScaricoRapido');
if (selectScarico) {
  selectScarico.addEventListener('change', function() {
    const inputCodice = document.getElementById('inputScaricoCodice');
    const inputLotto = document.getElementById('inputScaricoLotto');
    
    if (this.value) {
      inputCodice.value = this.value;
      const selectedOption = this.options[this.selectedIndex];
      inputLotto.value = selectedOption.dataset.lotto || '';
    } else {
      inputCodice.value = '';
      inputLotto.value = '';
    }
  });
}

// LOGICA DEI WIDGET IN RIGA UNICA
function renderizzaDashboard(alerts) {
  const panel = document.getElementById('alertsPanel');
  if (!panel) return;
  panel.innerHTML = '';

  if (!alerts) return;

  const giorniConfig = (localAlerts && localAlerts.giorniAvviso) ? localAlerts.giorniAvviso : 30;

  const cardsData = [
    { titolo: '❌ Scaduti', valore: alerts.scaduti.length, classe: 'danger', descr: 'Lotti oltre data limite' },
    { titolo: '⚠️ In Scadenza', valore: alerts.inScadenza.length, classe: 'warning', descr: `Prossimi ${giorniConfig} gg` },
    { titolo: '📉 Sotto Scorta', valore: alerts.sottoScorta.length, classe: 'info', descr: 'Articoli sotto soglia' }
  ];

  cardsData.forEach(c => {
    const card = document.createElement('div');
    card.className = `widget-alert ${c.classe}`;
    card.style.flex = '1';
    card.style.minWidth = '150px';
    card.style.margin = '0';
    
    card.innerHTML = `<div class="num">${c.valore}</div><div class="label">${escapeHtml(c.titolo)}</div><div class="label" style="margin-top:2px; opacity:0.8; font-size:11px;">${escapeHtml(c.descr)}</div>`;
    panel.appendChild(card);
  });
  renderizzaSottoScorta(alerts.sottoScorta);
}

function renderizzaSottoScorta(lista) {
  const container = document.getElementById('sottoScortaDettaglio');
  if (!container) return;
  container.innerHTML = '';

  if (lista.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size:14px; margin:0;">🟢 Ottimo! Nessun articolo attualmente sotto la scorta minima impostata.</p>';
    return;
  }

  lista.forEach(item => {
    const box = document.createElement('div');
    box.style.background = 'rgba(255,255,255,0.02)';
    box.style.border = '1px solid rgba(255,255,255,0.05)';
    box.style.borderRadius = '6px';
    box.style.padding = '10px 14px';

    let htmlLotti = '';
    if (item.lotti && item.lotti.length > 0) {
      htmlLotti = `<div style="margin-top:6px; font-size:12px; color:var(--cyan); display:flex; flex-wrap:wrap; gap:8px;">` +
        item.lotti.map(l => {
          let d = new Date(l.scadenza);
          let scadenzaFmt = (l.scadenza && !isNaN(d.getTime())) ? d.toLocaleDateString('it-IT') : '';
          return `<span>• Lotto: ${escapeHtml(l.lotto)} — Disponibile: ${l.quantita} pz ${scadenzaFmt ? '['+scadenzaFmt+']' : ''}</span>`;
        }).join('') +
        `</div>`;
    } else {
      htmlLotti = `<div style="margin-top:6px; font-size:12px; color:var(--red);">⚠️ Nessun lotto attivo a magazzino (Totale: 0 unità)</div>`;
    }

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:12px;">
        <strong style="color:#fff; font-size:13px;">${escapeHtml(item.codice)} — ${escapeHtml(item.descrizione)}</strong>
        <span class="badge" style="background:rgba(255,51,102,0.15); color:var(--red); font-weight:600; font-size:12px; padding:2px 8px; border-radius:4px; white-space:nowrap;">
          Disponibile: ${item.quantitaAttuale} / Minimo richiesto: ${item.scortaMinima}
        </span>
      </div>
      ${htmlLotti}
    `;
    container.appendChild(box);
  });
}

function applicaOrdinamentoGiacenze(elenco) {
  if (!giacenzeSortDir) return elenco;
  return [...elenco].sort((a, b) => {
    if (!a.scadenza && !b.scadenza) return 0;
    if (!a.scadenza) return 1;
    if (!b.scadenza) return -1;
    return giacenzeSortDir === 'asc' ? new Date(a.scadenza) - new Date(b.scadenza) : new Date(b.scadenza) - new Date(a.scadenza);
  });
}

function renderizzaTabellaGiacenze(elenco, alerts) {
  const tbody = document.querySelector('#tabellaGiacenze tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (elenco.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:32px;">Nessun articolo presente in magazzino.</td></tr>';
    return;
  }

  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const giorniConfig = (alerts && alerts.giorniAvviso) ? Number(alerts.giorniAvviso) : 30;
  const limiteAvviso = new Date(oggi.getTime() + giorniConfig * 24 * 60 * 60 * 1000);

  elenco.forEach(g => {
    // BUGFIX: le classi CSS reali definite in Stylesheet.html per evidenziare le righe
    // sono "tr-danger" (scaduti) e "tr-warning" (in scadenza) — vedi tr.tr-danger/tr.tr-warning.
    // Qui venivano invece assegnate le classi "scaduto"/"in-scadenza", inesistenti nel
    // CSS: la classe finiva comunque sull'elemento <tr>, ma senza nessuna regola di
    // stile corrispondente, quindi NESSUNA riga risultava mai evidenziata (né rossa né
    // arancione) nella tabella "Giacenze Correnti", nonostante il calcolo della scadenza
    // fosse corretto.
    let rigaClasse = '';
    if (g.scadenza) {
      const d = new Date(g.scadenza); d.setHours(0,0,0,0);
      if (d < oggi) rigaClasse = 'tr-danger';
      else if (d <= limiteAvviso) rigaClasse = 'tr-warning';
    }

    const tr = document.createElement('tr');
    if (rigaClasse) tr.className = rigaClasse;

    let azioniAdmin = '';
    if (IS_ADMIN) {
      azioniAdmin = `
        <td style="text-align:center; white-space:nowrap; gap:6px;">
          <button class="btn btn-secondary btn-sm" data-action="modifica" style="padding:4px 8px; font-size:12px;">✏️ Modifica</button>
          <button class="btn btn-danger btn-sm" data-action="elimina" style="padding:4px 8px; font-size:12px;">🗑️ Elimina</button>
        </td>
      `;
    } else {
      azioniAdmin = `<td style="color:var(--text-muted); font-size:12px; text-align:center;">-</td>`;
    }

    // Pulsanti di movimento rapido, visibili a TUTTI gli utenti (non solo Admin):
    // portano direttamente alla tab Carico/Scarico con i dati della riga già precompilati.
    const azioniMovimento = `
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn btn-success btn-sm" data-action="carico" style="padding:4px 8px; font-size:12px;">📥 Carico</button>
        <button class="btn btn-primary btn-sm" data-action="scarico" style="padding:4px 8px; font-size:12px;">📤 Scarico</button>
      </td>
    `;

    const notaIcona = g.note ? ` <span title="${escapeHtml(g.note)}" style="cursor:help;">📝</span>` : '';

    // BUGFIX: i dati della riga vengono passati via dataset (proprietà DOM), non più
    // interpolati dentro attributi onclick="...('...')". In precedenza un apostrofo in
    // Codice/Descrizione/Lotto/Note (es. "D'Amico") chiudeva prematuramente la stringa
    // JS generata, causando un SyntaxError silenzioso e pulsanti che sembravano "morti".
    // Il dataset non ha questo problema: il browser gestisce il valore come stringa,
    // senza mai doverlo "reinterpretare" come codice JavaScript.
    tr.dataset.codice = g.codice;
    tr.dataset.descrizione = g.descrizione;
    tr.dataset.tipo = g.tipo;
    tr.dataset.lotto = g.lotto || '';
    tr.dataset.scadenza = g.scadenza || '';
    tr.dataset.scortaMinima = Number(g.scortaMinima || 0);
    tr.dataset.note = g.note || '';

    tr.innerHTML = `
      <td><strong>${escapeHtml(g.codice)}</strong></td>
      <td>${escapeHtml(g.descrizione)}${notaIcona}</td>
      <td><span class="badge ${String(g.tipo).toLowerCase()}">${escapeHtml(g.tipo)}</span></td>
      <td><span style="font-family:monospace; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${escapeHtml(g.lotto || 'N.D.')}</span></td>
      <td>${formattaDataItaliana(g.scadenza)}</td>
      <td style="text-align:right;"><strong>${g.quantita}</strong></td>
      <td style="font-size:11px; color:var(--text-muted);">${formattaDataOraItaliana(g.ultimoAggiornamento)}</td>
      ${azioniMovimento}
      ${azioniAdmin}
    `;
    tbody.appendChild(tr);
  });
}

// LOGICA AZIONE PULSANTE PDF
// BUGFIX: era collegato a google.script.run...generaPDFGiacenze(), funzione MAI esistita
// nel backend (Export.js espone generaHtmlPdfGiacenze(), che restituisce il contenuto HTML
// del report da stampare, non un URL da aprire) — ogni click produceva quindi un errore.
// Il pulsante "Stampa PDF" che funzionava davvero era solo quello duplicato/orfano
// (ora rimosso da Index.html), collegato alla funzione eseguiStampaPdfGiacenze() più sotto
// in questo stesso file. Ora l'unico pulsante rimasto (quello corretto in Dashboard) usa
// quella stessa funzione, già corretta e funzionante.
const btnStampaPDF = document.getElementById('btnStampaPDF');
if (btnStampaPDF) {
  btnStampaPDF.addEventListener('click', eseguiStampaPdfGiacenze);
}

// BUGFIX: unico gestore di click "delegato" sul tbody, al posto degli attributi
// onclick generati per ogni riga (vedi commento sopra in renderizzaTabellaGiacenze).
// Legge i dati dal dataset della riga (tr) più vicina al pulsante cliccato.
const tabellaGiacenzeBody = document.querySelector('#tabellaGiacenze tbody');
if (tabellaGiacenzeBody) {
  tabellaGiacenzeBody.addEventListener('click', function(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (!tr) return;
    const d = tr.dataset;
    switch (btn.dataset.action) {
      case 'modifica':
        apriModaleModifica(d.codice, d.descrizione, d.tipo, d.scortaMinima, d.note);
        break;
      case 'elimina':
        eseguiEliminaArticolo(d.codice, d.descrizione);
        break;
      case 'carico':
        vaiACaricoConDati(d.codice, d.descrizione, d.tipo, d.lotto, d.scadenza, d.scortaMinima);
        break;
      case 'scarico':
        vaiAScaricoConDati(d.codice, d.lotto);
        break;
    }
  });
}

const thGiacenzeScadenza = document.getElementById('thGiacenzeScadenza');
if (thGiacenzeScadenza) {
  thGiacenzeScadenza.addEventListener('click', () => {
    if (giacenzeSortDir === null) giacenzeSortDir = 'asc';
    else if (giacenzeSortDir === 'asc') giacenzeSortDir = 'desc';
    else giacenzeSortDir = null;
    
    document.querySelectorAll('#tabellaGiacenze th .sort-icon').forEach(i => i.textContent = '');
    aggiornaIndicatoreOrdinamento('thGiacenzeScadenza', giacenzeSortDir);
    renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
  });
}

const inputCercaGiacenze = document.getElementById('cercaGiacenze');
if (inputCercaGiacenze) {
  inputCercaGiacenze.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();
    const filtrate = localGiacenze.filter(g => 
      g.codice.toLowerCase().includes(query) || 
      g.descrizione.toLowerCase().includes(query) || 
      (g.lotto && g.lotto.toLowerCase().includes(query)) ||
      g.tipo.toLowerCase().includes(query)
    );
    renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(filtrate), localAlerts);
  });
}

const formCarico = document.getElementById('formCarico');
if (formCarico) {
  formCarico.addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = this.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Registrazione in corso...';

    const dati = {
      codice: document.getElementById('caricoCodice').value,
      descrizione: document.getElementById('caricoDescrizione').value,
      tipo: document.getElementById('caricoTipo').value,
      lotto: document.getElementById('caricoLotto').value,
      scadenza: document.getElementById('caricoScadenza').value,
      quantita: document.getElementById('caricoQuantita').value,
      scortaMinima: document.getElementById('caricoScortaMinima').value,
      note: document.getElementById('caricoNote').value
    };

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false; btn.textContent = '📥 Conferma Carico Merci';
        if (res.success) {
          this.reset();
          localGiacenze = res.nuoveGiacenze || localGiacenze;
          if (res.nuoviAlerts) { localAlerts = res.nuoviAlerts; renderizzaDashboard(res.nuoviAlerts); }
          renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
          popolaTendinaScarico(localGiacenze);
          alert('Carico registrato con successo.');
        }
      })
      .withFailureHandler(err => {
        btn.disabled = false; btn.textContent = '📥 Conferma Carico Merci';
        alert('Errore durante il carico: ' + err.message);
      })
      .eseguiCarico(dati);
  });
}

const btnResetCarico = document.getElementById('btnResetCarico');
if (btnResetCarico) {
  btnResetCarico.addEventListener('click', function() {
    if (formCarico) formCarico.reset();
  });
}

const formScarico = document.getElementById('formScarico');
if (formScarico) {
  formScarico.addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = this.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Registrazione in corso...';

    const dati = {
      codice: document.getElementById('inputScaricoCodice').value,
      lotto: document.getElementById('inputScaricoLotto').value,
      quantita: document.getElementById('scaricoQuantita').value,
      note: document.getElementById('scaricoNote').value
    };

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false; btn.textContent = '📤 Conferma Scarico Merci';
        if (res.success) {
          this.reset();
          if (document.getElementById('selectScaricoRapido')) document.getElementById('selectScaricoRapido').value = "";
          localGiacenze = res.nuoveGiacenze || localGiacenze;
          if (res.nuoviAlerts) { localAlerts = res.nuoviAlerts; renderizzaDashboard(res.nuoviAlerts); }
          renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
          popolaTendinaScarico(localGiacenze);
          alert('Scarico registrato con successo.');
        }
      })
      .withFailureHandler(err => {
        btn.disabled = false; btn.textContent = '📤 Conferma Scarico Merci';
        alert('Errore durante lo scarico: ' + err.message);
      })
      .eseguiScarico(dati);
  });
}

// GESTIONE STORICO MOVIMENTI
const formFiltroStorico = document.getElementById('formFiltroStorico');
if (formFiltroStorico) {
  formFiltroStorico.addEventListener('submit', function(e) {
    e.preventDefault();
    storicoSortDir = document.getElementById('storicoFiltroOrdine').value;
    const query = document.getElementById('storicoFiltroRicerca').value;
    eseguiCaricaStorico(query);
  });
}

const btnResetStorico = document.getElementById('btnResetStorico');
if (btnResetStorico) {
  btnResetStorico.addEventListener('click', function() {
    document.getElementById('storicoFiltroRicerca').value = '';
    document.getElementById('storicoFiltroOperazione').value = 'DEFAULT';
    document.getElementById('storicoFiltroOrdine').value = 'desc';
    storicoSortDir = 'desc';
    eseguiCaricaStorico('');
  });
}

// query: testo di ricerca da filtrare per Codice Articolo O Descrizione (vuoto = tutti).
// aggiungi: se true, richiede la pagina SUCCESSIVA e la accoda a quelle già mostrate
// (usato dal pulsante "Carica altre"); se false/omesso, riparte da zero (nuova ricerca,
// cambio filtro, refresh dopo un'operazione) e rilegge anche il Tipo Operazione
// attualmente selezionato, così la ricerca e il filtro restano "congelati" per tutte
// le pagine successive caricate con "Carica altre".
function eseguiCaricaStorico(query, aggiungi) {
  const tbody = document.querySelector('#tabellaStorico tbody');
  if (!tbody || storicoCaricamentoInCorso) return;
  storicoCaricamentoInCorso = true;

  const offsetRichiesto = aggiungi ? storicoOffset : 0;

  if (!aggiungi) {
    storicoQueryCorrente = query || '';
    storicoOperazioneCorrente = document.getElementById('storicoFiltroOperazione').value;
    storicoOffset = 0;
    storicoDatiCorrenti = [];
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:24px;">Caricamento storico in corso...</td></tr>';
  }
  aggiornaBottoneCaricaAltriStorico_(true);

  google.script.run
    .withSuccessHandler(risultato => {
      storicoDatiCorrenti = aggiungi ? storicoDatiCorrenti.concat(risultato.righe) : risultato.righe;
      storicoOffset = offsetRichiesto + risultato.righe.length;
      storicoHaAltri = risultato.haAltri;
      storicoTotaleRighe = risultato.totale;
      storicoCaricamentoInCorso = false;

      // La ricerca (Codice/Descrizione) e il Tipo Operazione sono già stati applicati
      // dal backend: qui resta solo da ordinare per data i dati già ricevuti.
      const datiOrdinati = applicaOrdinamentoStorico(storicoDatiCorrenti);
      aggiornaIndicatoreOrdinamento('thStoricoData', storicoSortDir);
      renderizzaTabellaStorico(datiOrdinati);
      aggiornaBottoneCaricaAltriStorico_(false);
    })
    .withFailureHandler(err => {
      storicoCaricamentoInCorso = false;
      if (!aggiungi) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">Errore caricamento: ${err.message}</td></tr>`;
      } else {
        alert('Errore nel caricamento di altri movimenti: ' + err.message);
      }
      aggiornaBottoneCaricaAltriStorico_(false);
    })
    .getStoricoMovimenti(storicoQueryCorrente, storicoOperazioneCorrente, offsetRichiesto, STORICO_PAGE_SIZE);
}

// Aggiorna testo/stato del pulsante "Carica altre" e il contatore delle righe mostrate.
// caricamentoInCorso: true mentre è in volo una richiesta al backend (disabilita il
// pulsante e mostra un'etichetta di attesa).
function aggiornaBottoneCaricaAltriStorico_(caricamentoInCorso) {
  const btn = document.getElementById('btnCaricaAltriStorico');
  const contatore = document.getElementById('storicoContatore');
  if (!btn) return;

  if (caricamentoInCorso) {
    btn.disabled = true;
    btn.textContent = '⏱️ Caricamento...';
    btn.style.display = (storicoDatiCorrenti.length === 0) ? 'none' : 'inline-block';
    return;
  }

  btn.disabled = false;
  btn.textContent = '⬇️ Carica altre';
  btn.style.display = storicoHaAltri ? 'inline-block' : 'none';

  if (contatore) {
    contatore.textContent = storicoTotaleRighe > 0
      ? `Mostrati ${storicoDatiCorrenti.length} di ${storicoTotaleRighe} movimenti`
      : '';
  }
}

const btnCaricaAltriStorico = document.getElementById('btnCaricaAltriStorico');
if (btnCaricaAltriStorico) {
  btnCaricaAltriStorico.addEventListener('click', () => {
    eseguiCaricaStorico(storicoQueryCorrente, true);
  });
}

function applicaOrdinamentoStorico(elenco) {
  return [...elenco].sort((a, b) => {
    const da = new Date(a.data);
    const db = new Date(b.data);
    if (isNaN(da.getTime())) return 1;
    if (isNaN(db.getTime())) return -1;
    return storicoSortDir === 'asc' ? da - db : db - da;
  });
}

function renderizzaTabellaStorico(rows) {
  const tbody = document.querySelector('#tabellaStorico tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:24px;">Nessun movimento trovato per i filtri selezionati.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    let badgeClasse = String(r.movimento).toLowerCase();
    let coloreQta = '#fff';
    if (r.movimento === 'CARICO') coloreQta = 'var(--green)';
    
    tr.innerHTML = `
      <td style="white-space:nowrap; font-size:12px; color:var(--text-muted);">${formattaDataOraItaliana(r.data)}</td>
      <td><span class="badge ${badgeClasse}">${escapeHtml(r.movimento)}</span></td>
      <td><strong>${escapeHtml(r.codice)}</strong></td>
      <td>${escapeHtml(r.descrizione)}</td>
      <td><span class="badge ${String(r.tipo).toLowerCase()}">${escapeHtml(r.tipo)}</span></td>
      <td><span style="font-family:monospace; background:rgba(255,255,255,0.05); padding:2px 4px; border-radius:4px;">${escapeHtml(r.lotto || '-')}</span></td>
      <td style="font-size:12px;">${formattaDataItaliana(r.scadenza)}</td>
      <td style="text-align:right; font-weight:600; color:${coloreQta}">${r.quantita || 0}</td>
      <td style="text-align:right; font-family:monospace; color:var(--text-muted);">${r.quantitaResidua !== "" ? r.quantitaResidua : '-'}</td>
      <td style="font-size:12px; max-width:220px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(r.utente)} / Note: ${escapeHtml(r.note)}">
        <span style="color:var(--cyan); display:block; font-size:11px;">${escapeHtml(r.utente)}</span>
        <span style="color:var(--text-muted); display:block; margin-top:2px; font-size:11px;">${escapeHtml(r.note)}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Il click sull'intestazione "Data e Ora" riordina SOLO le righe già caricate in
// memoria (nessuna nuova richiesta al backend): la paginazione avanza indipendentemente
// dall'ordinamento scelto. Ricerca e Tipo Operazione sono già stati applicati dal
// backend, quindi qui basta riordinare storicoDatiCorrenti così com'è.
const thStoricoData = document.getElementById('thStoricoData');
if (thStoricoData) {
  thStoricoData.addEventListener('click', () => {
    storicoSortDir = (storicoSortDir === 'desc') ? 'asc' : 'desc';
    if(document.getElementById('storicoFiltroOrdine')) {
      document.getElementById('storicoFiltroOrdine').value = storicoSortDir;
    }

    renderizzaTabellaStorico(applicaOrdinamentoStorico(storicoDatiCorrenti));
    aggiornaIndicatoreOrdinamento('thStoricoData', storicoSortDir);
  });
}

function scaricaFileFlusso_(res) {
  if (!res || !res.contenuto) { alert('Errore generazione export report.'); return; }
  const blob = new Blob([res.contenuto], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = res.nomeFile;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const btnExportGiacenze = document.getElementById('btnExportGiacenze');
if (btnExportGiacenze) {
  btnExportGiacenze.addEventListener('click', () => {
    google.script.run.withSuccessHandler(scaricaFileFlusso_).esportaGiacenzeCSV();
  });
}

const formExportStorico = document.getElementById('formExportStorico');
if (formExportStorico) {
  formExportStorico.addEventListener('submit', function(e) {
    e.preventDefault();
    const cod = document.getElementById('exportStoricoCodice').value;
    google.script.run.withSuccessHandler(scaricaFileFlusso_).esportaStoricoCSV(cod);
  });
}

const formImpostazioni = document.getElementById('formImpostazioni');
if (formImpostazioni) {
  formImpostazioni.addEventListener('submit', function(e) {
    e.preventDefault();
    const giorni = this.querySelector('[name=giorniAvviso]').value;
    const btn = this.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Salvataggio...';

    google.script.run
      .withSuccessHandler(() => {
        btn.disabled = false; btn.textContent = '💾 Salva Impostazioni';
        alert('Configurazione aggiornata.');
        init();
      })
      .withFailureHandler(err => {
        btn.disabled = false; btn.textContent = '💾 Salva Impostazioni';
        alert('Errore: ' + err.message);
      })
      .salvaGiorniAvviso(giorni);
  });
}

function aggiornaListaBackup() {
  const tbody = document.querySelector('#tabellaBackup tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted);">Aggiornamento registro copie...</td></tr>';

  google.script.run.withSuccessHandler(elenco => {
    tbody.innerHTML = '';
    if (elenco.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted); text-align:center;">Nessun backup trovato.</td></tr>';
      return;
    }
    elenco.forEach(b => {
      const tr = document.createElement('tr');
      const dStr = new Date(b.data).toLocaleString('it-IT');
      tr.innerHTML = `
        <td><span style="font-size:13px; font-weight:500;">${escapeHtml(b.nome)}</span></td>
        <td><span style="font-family:monospace; font-size:11px; color:var(--text-muted);">${dStr}</span></td>
        <td style="text-align:right; white-space:nowrap;">
          <a href="${b.url}" target="_blank" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:12px; text-decoration:none; display:inline-block; margin-right:4px;">👁️ Esamina</a>
          <button class="btn btn-warning btn-sm" onclick="eseguiRipristinoBackup('${b.id}')" style="padding:2px 8px; font-size:12px;">🔄 Ripristina</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }).elencoBackup();
}

const btnCreaBackup = document.getElementById('btnCreaBackup');
if (btnCreaBackup) {
  btnCreaBackup.addEventListener('click', () => {
    btnCreaBackup.disabled = true; btnCreaBackup.textContent = 'Generazione copia...';
    google.script.run
      .withSuccessHandler(res => {
        btnCreaBackup.disabled = false; btnCreaBackup.textContent = '🛡️ Genera Punto di Ripristino';
        if (res.ok) { alert(`Copia creata con successo:\n"${res.nome}"`); aggiornaListaBackup(); }
      })
      .withFailureHandler(err => {
        btnCreaBackup.disabled = false; btnCreaBackup.textContent = '🛡️ Genera Punto di Ripristino';
        alert('Errore: ' + err.message);
      })
      .backupManuale();
  });
}

function eseguiRipristinoBackup(id) {
  const conferma = confirm("Il ripristino sovrascriverà tutti i dati attuali. Procedere?");
  if (!conferma) return;

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed'; overlay.style.inset = '0'; overlay.style.background = 'rgba(0,0,0,0.8)';
  overlay.style.color = '#fff'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center'; overlay.style.zIndex = '9999'; overlay.style.fontSize = '18px';
  overlay.innerHTML = '<div><strong>🔄 Ripristino in corso... Non chiudere la pagina.</strong></div>';
  document.body.appendChild(overlay);

  google.script.run
    .withSuccessHandler(res => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (res.success) {
        alert('Ripristino completato!');
        // BUGFIX: le web app di Apps Script girano sempre in un iframe sandboxato su
        // un'origine diversa da quella del frame superiore (script.google.com vs
        // *.googleusercontent.com). window.top.location.reload() è un accesso
        // cross-origin bloccato dal browser: la chiamata falliva silenziosamente in
        // console e la pagina non si aggiornava mai davvero dopo un ripristino riuscito.
        // Si riusa qui lo stesso pattern già in uso altrove nel file (es. dopo
        // salvaGiorniAvviso): richiamare init() per ricaricare tutti i dati dal server
        // senza mai toccare window.top.
        init();
        const navDashboard = document.querySelector('.nav-btn[data-tab="dashboard"]');
        if (navDashboard) navDashboard.click();
      }
    })
    .withFailureHandler(err => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      alert('Errore critico: ' + err.message);
    })
    .ripristinaBackup(id);
}

function apriModaleModifica(codice, descrizione, tipo, scortaMinima, note) {
  document.getElementById('modificaCodice').value = codice;
  document.getElementById('modificaDescrizione').value = descrizione;
  document.getElementById('modificaTipo').value = tipo;
  document.getElementById('modificaScortaMinima').value = scortaMinima;
  document.getElementById('modificaNote').value = note;
  document.getElementById('modaleModificaArticolo').classList.add('active');
}

const btnAnnullaModale = document.getElementById('btnAnnullaModaleModifica');
if (btnAnnullaModale) {
  btnAnnullaModale.addEventListener('click', () => {
    document.getElementById('modaleModificaArticolo').classList.remove('active');
  });
}
const btnCloseModale = document.getElementById('closeModaleModifica');
if (btnCloseModale) {
  btnCloseModale.addEventListener('click', () => {
    document.getElementById('modaleModificaArticolo').classList.remove('active');
  });
}

const formModifica = document.getElementById('formModificaArticolo');
if (formModifica) {
  formModifica.addEventListener('submit', function(e) {
    e.preventDefault();
    const codice = document.getElementById('modificaCodice').value;
    const descrizione = document.getElementById('modificaDescrizione').value;
    const tipo = document.getElementById('modificaTipo').value;
    const scortaMinima = document.getElementById('modificaScortaMinima').value;
    const note = document.getElementById('modificaNote').value;

    google.script.run
      .withSuccessHandler(res => {
        if (res.success) {
          document.getElementById('modaleModificaArticolo').classList.remove('active');
          localGiacenze = res.nuoveGiacenze || localGiacenze;
          if (res.nuoviAlerts) { localAlerts = res.nuoviAlerts; renderizzaDashboard(res.nuoviAlerts); }
          renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
          popolaTendinaScarico(localGiacenze);
          alert('Articolo aggiornato.');
          if (document.querySelector('.nav-btn[data-tab="storico"]').classList.contains('active')) {
            const query = document.getElementById('storicoFiltroRicerca').value;
            eseguiCaricaStorico(query);
          }
        }
      })
      .withFailureHandler(err => { alert('Errore: ' + err.message); })
      .salvaModificaArticolo(codice, descrizione, tipo, scortaMinima, note);
  });
}

/**
 * STAMPA PDF GIACENZE
 */
function eseguiStampaPdfGiacenze() {
  const btn = document.getElementById('btnStampaPDF');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏱️ Generazione...';
  }

  google.script.run
    .withSuccessHandler(htmlContent => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📄 Stampa PDF Giacenze';
      }
      const win = window.open('', '_blank', 'width=800,height=600');
      win.document.write(htmlContent);
      win.document.close();
      setTimeout(() => { win.print(); }, 500);
    })
    .withFailureHandler(err => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📄 Stampa PDF Giacenze';
      }
      alert('Errore nella generazione PDF: ' + err.message);
    })
    .generaHtmlPdfGiacenze();
}

/**
 * STAMPA PDF SOTTOSCORTA
 */
function eseguiStampaPdfSottoScorta() {
  const btn = document.getElementById('btnStampaPdfSottoScorta');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏱️ Generazione...';
  }

  google.script.run
    .withSuccessHandler(htmlContent => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📉 Stampa PDF Sottoscorta';
      }
      const win = window.open('', '_blank', 'width=800,height=600');
      win.document.write(htmlContent);
      win.document.close();
      setTimeout(() => { win.print(); }, 500);
    })
    .withFailureHandler(err => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📉 Stampa PDF Sottoscorta';
      }
      alert('Errore nella generazione PDF: ' + err.message);
    })
    .generaHtmlPdfSottoScorta();
}

const btnStampaPdfSottoScorta = document.getElementById('btnStampaPdfSottoScorta');
if (btnStampaPdfSottoScorta) {
  btnStampaPdfSottoScorta.addEventListener('click', eseguiStampaPdfSottoScorta);
}

function eseguiEliminaArticolo(codice, descrizione) {
  const quantitaResidua = localGiacenze
    .filter(g => g.codice === codice)
    .reduce((tot, g) => tot + (Number(g.quantita) || 0), 0);

  let msg = 'Eliminare definitivamente l\'articolo "' + codice + '"?';
  if (quantitaResidua > 0) msg += '\n\n⚠️ Attenzione: sono presenti ancora ' + quantitaResidua + ' unità.';
  
  if (!confirm(msg)) return;

  google.script.run.withSuccessHandler(res => {
    if (res.success) {
      localGiacenze = res.nuoveGiacenze || localGiacenze;
      if (res.nuoviAlerts) { localAlerts = res.nuoviAlerts; renderizzaDashboard(res.nuoviAlerts); }
      renderizzaTabellaGiacenze(applicaOrdinamentoGiacenze(localGiacenze), localAlerts);
      popolaTendinaScarico(localGiacenze);
      alert('Articolo eliminato.');
      if (document.querySelector('.nav-btn[data-tab="storico"]').classList.contains('active')) {
        const query = document.getElementById('storicoFiltroRicerca').value;
        eseguiCaricaStorico(query);
      }
    }
  }).withFailureHandler(err => { alert('Errore: ' + err.message); }).eliminaArticoloCompleto(codice);
}

    init();
  };
})();
