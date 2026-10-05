import { paintPaper, startInk, clawd, wordCloud, isShortAnswers } from '/sketch.js';
import { startI18n } from '/i18n.js';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const [mode, rawCode] = location.pathname.split('/').filter(Boolean);
const code = rawCode?.toUpperCase();
const storage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key,value) { try { localStorage.setItem(key,value); } catch { /* In-memory identity still works for this visit. */ } } };
const randomId = () => [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2,'0')).join('');
const participant = storage.get('roompulse-participant') || randomId();
storage.set('roompulse-participant',participant);
let key = sessionStorage.getItem(`roompulse-${mode}-${code || 'host'}`) || '';
if (location.hash.length > 1) { key = location.hash.slice(1); sessionStorage.setItem(`roompulse-${mode}-${code || 'host'}`,key); history.replaceState(null,'',location.pathname); }
let state, base = location.origin, activeDraft = null, draftAnswer = null, editing = false, busy = false, fetching = false, pending = false;
const typeLabel = { rating:'Rating scale', text:'Open response', choice:'Multiple choice' };

paintPaper();
let paperTimer; addEventListener('resize', () => { clearTimeout(paperTimer); paperTimer = setTimeout(paintPaper, 150); });
startInk();
startI18n();

async function api(path, data, method = 'GET') {
  const response = await fetch(path, { method, headers: { 'Content-Type':'application/json', 'x-admin-key': mode === 'admin' ? key : '', 'x-host-key': mode === 'host' ? key : '', 'x-participant-id': participant }, ...(data !== undefined ? { body:JSON.stringify(data) } : {}) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Could not connect. Please try again.'); }
  return response.json();
}
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true,4500); }
function connection(online) { $('#connection').innerHTML = `<i class="${online ? '' : 'offline'}"></i>${online ? 'Connected' : 'Reconnecting…'}`; }
function participantLink() { return `${base}/join/${code}`; }
async function qr(value, target) { const { image } = await api('/api/qr',{value},'POST'); const el = $(target); if (el) el.src = image; }
async function share(admin = false) {
  const url = admin ? `${base}/admin/${code}#${key}` : participantLink();
  $('#share-content').innerHTML = `<span class="eyebrow">${admin ? 'PRIVATE ACCESS' : 'EVERY VOICE WELCOME'}</span><h2>${admin ? 'Your control room, on your phone.' : 'Scan. Join. Have your say.'}</h2><p>${admin ? 'This QR gives full control of the session. Share it only with your co-hosts.' : 'Open your camera and point it here. No account or app needed.'}</p><img id="dialog-qr" class="qr-large ink" alt="${admin ? 'Private administrator' : 'Participant'} QR code"><div class="share-code">${code}</div><input aria-label="Share link" class="link-input" readonly value="${esc(url)}"><p class="micro">${admin ? 'Keep this link private.' : 'On a local server, connect to the same network as the laptop.'}</p>`;
  $('#share-dialog').showModal();
  await qr(url,'#dialog-qr');
}
$('#close-dialog').onclick = () => $('#share-dialog').close();

function home() {
  app.innerHTML = `<section class="landing"><div><span class="eyebrow">GOOD CONVERSATIONS START HERE</span><h1>Make room for<br>every <em>voice.</em></h1><p class="lead">A thought, a fresh perspective, a spark of an idea.<br>Bring yours to the conversation.</p><form id="join-form" class="join-card"><label for="room-code">Have a session code?</label><div class="join-row"><input id="room-code" name="code" placeholder="ABCDEF" minlength="6" maxlength="6" pattern="[A-Za-z]{6}" required autocomplete="off" autocapitalize="characters"><button class="button primary">Join the room <span>↗</span></button></div><span class="micro">No sign-up. Just you and your ideas.</span></form><p class="host-note">Hosting? Use the private organizer link shown in your server terminal.</p></div><div class="landing-art ink" aria-hidden="true"><div class="art-label">MANY MINDS. ONE ROOM.</div><div class="bubble ink one">What if we tried…<span>✦</span></div><div class="bubble ink two">I see it differently.<span>↗</span></div><div class="bubble ink three">Let's build on that.<span>＋</span></div><div class="art-clawd">${clawd({ angle: -62 })}</div><div class="note art-note">Great ideas don't happen alone.</div></div></section><div class="feature-strip"><span><b>01</b> Scan & join</span><span><b>02</b> Share your perspective</span><span><b>03</b> See the room come alive</span></div>`;
  $('#join-form').onsubmit = async e => { e.preventDefault(); const c = $('#room-code').value.trim().toUpperCase(); try { await api(`/api/sessions/${c}`); location.href = `/join/${c}`; } catch(error) { toast(error.message); } };
}
async function host() {
  const sessions = await api('/api/host/sessions');
  app.innerHTML = `<section class="page-intro"><span class="eyebrow">THE ORGANIZER'S DESK</span><h1>A room full of <em>possibility.</em></h1><p class="lead">Bring people together. Give every perspective a place.</p></section><div class="host-grid"><section class="panel ink"><div class="section-heading"><span class="step">＋</span><h2>Start a conversation</h2></div><form id="create-form"><label for="session-title">What's the session called?</label><input id="session-title" placeholder="Friday at the startup hub" maxlength="100" required><p class="micro">You'll get a participant QR and a separate, private admin QR.</p><button class="button primary full" type="submit">Create session <span>↗</span></button></form></section><section class="panel ink subtle"><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Your sessions <span class="count">${sessions.length}</span></h2><div class="session-list">${sessions.length ? sessions.map(s => `<a class="session-row" href="/admin/${s.code}#${s.adminKey}"><span><strong data-user>${esc(s.title)}</strong><small>${s.code} · ${s.created.slice(0,10)}</small></span><span>↗</span></a>`).join('') : '<p class="empty">Your next great conversation starts on the left.</p>'}</div></section></div>`;
  $('#create-form').onsubmit = async e => { e.preventDefault(); const button = e.submitter; button.disabled = true; try { const s = await api('/api/host/sessions',{title:$('#session-title').value},'POST'); location.href = `/admin/${s.code}#${s.adminKey}`; } catch(error) { toast(error.message); button.disabled = false; } };
}
function cloudView(answers) {
  return `<div class="word-cloud" data-user>${wordCloud(answers).map(w => `<span style="font-size:${w.size.toFixed(2)}em; rotate:${w.rot}deg; color:${w.color}" title="${w.n}×">${esc(w.word)}</span>`).join('')}</div>`;
}
function resultsView(q, result) {
  if (!result || !result.count) return '<div class="results-empty"><span>✦</span><h3>The next idea could change everything.</h3><p>Answers will appear here as people respond.</p></div>';
  if (q.type === 'text') return isShortAnswers(result.ideas) ? cloudView(result.ideas) : `<div class="idea-grid">${result.ideas.map((idea,i) => `<div class="idea ink"><span class="idea-number">PERSPECTIVE ${String(result.ideas.length-i).padStart(2,'0')}</span><p data-user>${esc(idea)}</p></div>`).join('')}</div>`;
  const max = Math.max(1,...result.counts);
  if (q.type === 'rating') return `<div class="rating-summary"><strong>${result.average.toFixed(1)}</strong><span>out of 5<br><small>${result.count} response${result.count === 1 ? '' : 's'}</small></span></div><div class="rating-chart">${result.counts.map((n,i) => `<div class="bar-column"><b>${n}</b><div class="bar-track"><div class="bar-fill ink" style="height:${n/max*100}%"></div></div><span>${i+1}</span></div>`).join('')}</div><div class="scale-labels"><span>Strongly disagree</span><span>Strongly agree</span></div>`;
  return `<div class="choice-results">${q.options.map((label,i) => `<div><div class="choice-label"><span data-user>${esc(label)}</span><b>${Math.round(result.counts[i]/result.count*100)}% <small>(${result.counts[i]})</small></b></div><div class="horizontal-track"><div class="ink" style="width:${result.counts[i]/result.count*100}%"></div></div></div>`).join('')}</div>`;
}
function questionList() {
  return state.questions.length ? state.questions.map((q,i) => `<button class="question-item ${q.id === state.active?.id ? 'selected' : ''}" data-activate="${q.id}" ${q.id === state.active?.id ? 'disabled' : ''}><span class="question-index">${String(i+1).padStart(2,'0')}</span><span class="question-copy"><strong data-user>${esc(q.prompt)}</strong><small>${typeLabel[q.type]} · ${q.results.count} responses</small></span><span>${q.id === state.active?.id ? '●' : '↗'}</span></button>`).join('') : '<div class="empty small">A blank canvas.<br>Add your first question below.</div>';
}
function livePanel() {
  const q = state.active;
  if (!q) return `<div class="live-idle">${clawd({ pose:'wave' })}<span class="eyebrow">LET'S GET THE ROOM TALKING</span><h2>One question.<br>A whole room of perspectives.</h2><p>Add a question, then select it to go live.<br>Participants can join while you get ready.</p></div>`;
  return `<div class="live-top"><span class="pill ${state.accepting ? 'live' : ''}">${state.accepting ? '● LIVE QUESTION' : 'Ⅱ RESPONSES PAUSED'}</span><span class="micro">${typeLabel[q.type]}</span></div><h2 class="active-prompt" data-user>${esc(q.prompt)}</h2><div class="result-meta"><span><b>${state.results?.count || 0}</b> responses</span><span>${state.revealed ? '◉ Results shared with the room' : '◎ Results visible only to you'}</span></div>${resultsView(q,state.results)}<div class="live-controls"><button class="button secondary" data-action="pause">${state.accepting ? 'Ⅱ Pause responses' : '▶ Resume responses'}</button><button class="button ${state.revealed ? 'secondary' : 'primary'}" data-action="reveal">${state.revealed ? 'Hide results' : 'Reveal to the room'} <span>↗</span></button></div>`;
}
function adminInitial() {
  if (!state.questions) throw new Error('This admin link is missing its private key. Reopen the full link from the organizer page.');
  app.innerHTML = `<section class="dashboard-heading"><div><span class="eyebrow">YOUR LIVE SESSION</span><h1 data-user>${esc(state.title)}</h1><p>Bring out the ideas in your room.</p></div><div class="heading-actions"><button class="button secondary" data-action="admin-qr">Admin QR <span>⌘</span></button><a class="button primary" href="/present/${code}" target="_blank" rel="noopener">Present <span>↗</span></a></div></section><div class="dashboard-grid"><aside><section class="panel ink question-panel"><div class="section-heading"><h2>Questions <span id="question-count" class="count"></span></h2><span class="micro">Select to go live</span></div><div id="question-list"></div><details class="question-composer" open><summary>＋ Add a question</summary><form id="question-form"><label for="prompt">Statement or question</label><textarea id="prompt" rows="3" placeholder="Our best ideas happen when we work together." maxlength="300" required></textarea><label for="question-type">How should people respond?</label><select id="question-type"><option value="rating">↗ Rating · 1 to 5</option><option value="text">≋ Ideas & opinions (short answers become a word cloud)</option><option value="choice">☷ Multiple choice</option></select><div id="options-field" hidden><label for="options">Options · one per line</label><textarea id="options" rows="4" placeholder="More community events\nShared workshops\nA better coffee machine" maxlength="808"></textarea></div><button class="button primary full" type="submit">Add to session <span>＋</span></button></form></details></section><button class="export-button" data-action="export">↓ Export all responses as CSV</button></aside><section class="panel ink live-panel" id="live-panel" aria-live="polite"></section><aside class="join-aside"><section class="panel ink join-panel"><span class="eyebrow">INVITE THE ROOM</span><h2>Good ideas<br>start with a scan.</h2><button class="qr-button" data-action="participant-qr" aria-label="Enlarge participant QR code"><img id="join-qr" alt="Participant QR code"></button><span class="micro">or enter the session code</span><div class="share-code">${code}</div><button class="button secondary full" data-action="participant-qr">Share session <span>↗</span></button><p class="micro">No app. No account.<br>Just a little curiosity.</p></section><div class="participant-stat"><span class="stat-icon">♧</span><div><strong id="participant-count">0</strong><span>people have responded</span></div></div><p class="network-note">Keep your laptop awake and connected. Local participants need access to its network.</p></aside></div>`;
  $('#question-type').onchange = () => { $('#options-field').hidden = $('#question-type').value !== 'choice'; $('#options').required = $('#question-type').value === 'choice'; };
  $('#question-form').onsubmit = async e => {
    e.preventDefault(); const button = e.submitter; button.disabled = true;
    try { await api(`/api/sessions/${code}/questions`,{prompt:$('#prompt').value,type:$('#question-type').value,options:$('#options').value.split('\n')},'POST'); $('#prompt').value = ''; $('#options').value = ''; await refresh(); toast('Question added. Select it when you’re ready to go live.'); } catch(error) { toast(error.message); } finally { button.disabled = false; }
  };
  qr(participantLink(),'#join-qr').catch(error => toast(error.message));
}
function adminRender() { if (!$('#question-list')) adminInitial(); $('#question-list').innerHTML = questionList(); $('#question-count').textContent = state.questions.length; $('#participant-count').textContent = state.participants; $('#live-panel').innerHTML = livePanel(); }
function responseForm(q) {
  if (q.type === 'text') return `<label class="sr-only" for="idea-input">Your idea or opinion</label><textarea id="idea-input" rows="5" maxlength="1000" placeholder="There's no wrong place to start…" data-user required>${esc(draftAnswer ?? '')}</textarea><div class="micro answer-hint">Up to 1,000 characters. One response per browser; you can edit it.</div>`;
  const labels = q.type === 'rating' ? ['1','2','3','4','5'] : q.options;
  return `<div class="${q.type === 'rating' ? 'rating-options' : 'choice-options'}">${labels.map((label,i) => { const value = q.type === 'rating' ? i+1 : i; return `<label class="answer-option"><input type="radio" name="answer" value="${value}" required ${draftAnswer === value ? 'checked' : ''}><span class="ink" data-user>${esc(label)}</span></label>`; }).join('')}</div>${q.type === 'rating' ? '<div class="scale-labels"><span>Strongly disagree</span><span>Strongly agree</span></div>' : ''}`;
}
let participantSignature = '';
function participantRender() {
  const q = state.active;
  if (activeDraft !== q?.id) { activeDraft = q?.id; draftAnswer = state.myAnswer; editing = false; }
  const signature = JSON.stringify([q,state.accepting,state.revealed,state.myAnswer,editing]);
  // Don't rebuild the answer form on other people's submissions: preserve focus and drafts.
  if (participantSignature === signature && $('#participant-results')) { $('#participant-results').innerHTML = state.revealed && q ? `<h3>The room's perspective</h3>${resultsView(q,state.results)}` : ''; return; }
  participantSignature = signature;
  const answered = state.myAnswer !== null && !editing;
  app.innerHTML = `<section class="participant-page"><div class="participant-heading"><span class="eyebrow" data-user>${esc(state.title)}</span><span class="code-tag">${code}</span></div><div class="panel ink participant-card">${!q ? `<div class="waiting-clawd">${clawd({ pose:'wave' })}</div><span class="eyebrow">YOU’RE IN THE RIGHT PLACE</span><h1>Take a breath.<br>The conversation is about to start.</h1><p>Your host will share the first question soon.<br>This page updates automatically.</p>` : `<div class="live-top"><span class="pill ${state.accepting ? 'live' : ''}">${state.accepting ? '● YOUR TURN' : 'Ⅱ RESPONSES PAUSED'}</span><span class="micro">${typeLabel[q.type]}</span></div><h1 data-user>${esc(q.prompt)}</h1>${answered ? `<div class="sent-state">${clawd({ pose:'happy' })}<h2>Your voice is in the room.</h2><p>${q.type === 'text' ? esc(state.myAnswer) : q.type === 'rating' ? `${state.myAnswer} out of 5` : esc(q.options[state.myAnswer])}</p>${state.accepting ? '<button class="text-button" data-action="edit-answer">Edit my response ↗</button>' : ''}</div>` : state.accepting ? `<form id="response-form">${responseForm(q)}<button class="button primary full" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send my response'} <span>↗</span></button></form>` : '<div class="empty">The host has paused responses.<br>Stay here for what comes next.</div>'}`}</div><p class="privacy-note">No names collected. One response per browser, per question.<br>Your words may be shown to the room.</p><section id="participant-results" class="participant-results">${state.revealed && q ? `<h3>The room's perspective</h3>${resultsView(q,state.results)}` : ''}</section></section>`;
  const form = $('#response-form');
  if (form) {
    form.oninput = () => { draftAnswer = q.type === 'text' ? $('#idea-input').value : Number(new FormData(form).get('answer')); };
    form.onsubmit = async e => {
      e.preventDefault(); if (busy) return; busy = true; e.submitter.disabled = true;
      try { await api(`/api/sessions/${code}/responses`,{questionId:q.id,answer:q.type === 'text' ? $('#idea-input').value : Number(new FormData(form).get('answer'))},'POST'); editing = false; await refresh(); toast('Response sent. Thanks for adding your perspective.'); } catch(error) { toast(error.message); await refresh(); } finally { busy = false; if(e.submitter.isConnected) e.submitter.disabled = false; }
    };
  }
}
function presentRender() {
  if (!$('#present-results')) { app.innerHTML = `<section class="present-page"><div class="present-title"><span class="eyebrow" data-user>${esc(state.title)}</span><button class="text-button" data-action="fullscreen">⛶ Full screen</button></div><div class="present-layout"><div id="present-results" aria-live="polite"></div><aside class="present-side"><div class="panel ink present-join"><span class="eyebrow">ADD YOUR VOICE</span><img id="present-qr" alt="Scan to join this session"><h2>${code}</h2><p>Scan to join the conversation.</p><p class="micro">${esc(base)}</p></div><div class="present-clawd">${clawd({ angle:-80 })}</div></aside></div></section>`; qr(participantLink(),'#present-qr').catch(error => toast(error.message)); }
  const q = state.active;
  $('#present-results').innerHTML = `<span class="pill ${state.accepting ? 'live' : ''}">${q ? state.accepting ? '● LIVE QUESTION' : 'Ⅱ RESPONSES PAUSED' : 'THE ROOM IS OPEN'}</span><h1>${q ? esc(q.prompt) : 'Every voice brings something new.'}</h1>${q && state.revealed ? resultsView(q,state.results) : '<div class="present-wait"><span class="note">'+ (q ? 'Take a moment. Share your perspective.<br>Results will appear when the host reveals them.' : 'Join us. The conversation is about to start.') +'</span></div>'}`;
}
async function refresh() {
  if (fetching) { pending = true; return; } fetching = true;
  try { const next = await api(`/api/sessions/${code}`); state = next; connection(true); if (mode === 'admin') adminRender(); else if (mode === 'present') presentRender(); else participantRender(); }
  finally { fetching = false; if (pending) { pending = false; refresh().catch(() => connection(false)); } }
}
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-action],[data-activate]'); if (!button) return;
  const action = button.dataset.action; button.disabled = true;
  try {
    if (button.dataset.activate) { await api(`/api/sessions/${code}`,{activeId:button.dataset.activate},'PATCH'); await refresh(); }
    if (action === 'pause' || action === 'reveal') { await api(`/api/sessions/${code}`,action === 'pause' ? {accepting:!state.accepting} : {revealed:!state.revealed},'PATCH'); await refresh(); }
    if (action === 'admin-qr' || action === 'participant-qr') await share(action === 'admin-qr');
    if (action === 'edit-answer') { draftAnswer = state.myAnswer; editing = true; participantRender(); }
    if (action === 'fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    if (action === 'export') {
      const response = await fetch(`/api/sessions/${code}/export`, {headers:{'x-admin-key':key}});
      if (!response.ok) throw new Error('Export failed. Reopen your private admin link.');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `roompulse-${code}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }
  } catch(error) { toast(error.message); } finally { if (button.isConnected) button.disabled = false; }
});
try {
  const config = await api('/api/config'); base = config.publicUrl || (['localhost','127.0.0.1','[::1]'].includes(location.hostname) ? config.localUrl : null) || location.origin;
  if (!mode) home();
  else if (mode === 'host') await host();
  else if (['admin','join','present'].includes(mode) && /^[A-Z]{6}$/.test(code)) {
    await refresh(); const events = new EventSource(`/api/sessions/${code}/events`);
    events.onmessage = () => refresh().catch(() => connection(false)); events.onerror = () => connection(false);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => connection(false)); });
    setInterval(() => { if (!document.hidden) refresh().catch(() => connection(false)); },15000);
  } else throw new Error('That link doesn’t look quite right. Check your session code.');
} catch(error) { app.innerHTML = `<section class="error-page panel ink">${clawd({ angle:-20 })}<h1>Let’s get you to the right room.</h1><p>${esc(error.message)}</p><a href="/" class="button primary">Back to home</a></section>`; }
