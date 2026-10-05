import express from 'express';
import QRCode from 'qrcode';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const secret = () => randomBytes(24).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validId = value => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createApp({ dataFile = resolve(root, 'data/roompulse.sqlite'), publicUrl = process.env.PUBLIC_URL } = {}) {
  if (dataFile !== ':memory:') mkdirSync(dirname(dataFile), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dataFile);
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (code TEXT PRIMARY KEY, title TEXT NOT NULL, admin_key TEXT NOT NULL, active_id TEXT, accepting INTEGER DEFAULT 0, revealed INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES sessions(code), prompt TEXT NOT NULL, type TEXT NOT NULL, options TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS responses (question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, participant TEXT NOT NULL, answer TEXT NOT NULL, updated TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(question_id, participant));`);
  db.prepare('INSERT OR IGNORE INTO config VALUES (?, ?)').run('host_key', secret());
  const hostKey = db.prepare('SELECT value FROM config WHERE key = ?').get('host_key').value;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    // Browser writes must originate from this app. No cross-origin API access.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}` && req.headers.origin !== publicUrl?.replace(/\/$/, '')) return res.status(403).json({ error: 'Cross-origin request rejected.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  const streams = new Map();
  function notify(code) { for (const res of streams.get(code) || []) res.write('data: changed\n\n'); }
  function session(req, res, next) {
    req.session = db.prepare('SELECT * FROM sessions WHERE code = ?').get(req.params.code.toUpperCase());
    if (!req.session) return res.status(404).json({ error: 'Session not found. Check your six-letter code.' });
    next();
  }
  function admin(req, res, next) {
    if (!equal(req.get('x-admin-key'), req.session.admin_key)) return res.status(403).json({ error: 'Open the private admin link to manage this session.' });
    next();
  }
  function host(req, res, next) {
    if (!equal(req.get('x-host-key'), hostKey)) return res.status(403).json({ error: 'Open the organizer link printed in the laptop terminal.' });
    next();
  }
  function questions(code) { return db.prepare('SELECT * FROM questions WHERE code = ? ORDER BY position').all(code).map(q => ({ id: q.id, prompt: q.prompt, type: q.type, options: JSON.parse(q.options) })); }
  function results(q) {
    const answers = db.prepare('SELECT answer FROM responses WHERE question_id = ? ORDER BY updated DESC, rowid DESC').all(q.id).map(row => JSON.parse(row.answer));
    if (q.type === 'text') return { count: answers.length, ideas: answers };
    const counts = Array(q.type === 'rating' ? 5 : q.options.length).fill(0);
    for (const answer of answers) counts[q.type === 'rating' ? answer - 1 : answer]++;
    return { count: answers.length, counts, average: q.type === 'rating' && answers.length ? answers.reduce((a,b) => a+b, 0) / answers.length : null };
  }
  function snapshot(s, isAdmin, participant) {
    const all = questions(s.code);
    const active = all.find(q => q.id === s.active_id) || null;
    const mine = active && validId(participant) ? db.prepare('SELECT answer FROM responses WHERE question_id = ? AND participant = ?').get(active.id, participant) : null;
    return {
      code: s.code, title: s.title, accepting: !!s.accepting, revealed: !!s.revealed, active,
      totalQuestions: all.length,
      results: active && (isAdmin || s.revealed) ? results(active) : null,
      myAnswer: mine ? JSON.parse(mine.answer) : null,
      ...(isAdmin ? { questions: all.map(q => ({ ...q, results: results(q) })), participants: db.prepare('SELECT COUNT(DISTINCT participant) AS count FROM responses r JOIN questions q ON q.id=r.question_id WHERE q.code=?').get(s.code).count } : {})
    };
  }
  app.get('/api/config', (req, res) => {
    const ips = Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
    const port = req.socket.localPort;
    res.json({ publicUrl: publicUrl?.replace(/\/$/, '') || null, localUrl: ips[0] ? `http://${ips[0]}:${port}` : null });
  });
  app.get('/api/host/sessions', host, (req, res) => res.json(db.prepare('SELECT code, title, admin_key AS adminKey, created FROM sessions ORDER BY rowid DESC').all()));
  app.post('/api/host/sessions', host, (req, res) => {
    const title = clean(req.body.title, 100);
    if (!title) return res.status(400).json({ error: 'Give your session a title.' });
    let code;
    do { code = Array.from(randomBytes(6), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[b % 24]).join(''); } while (db.prepare('SELECT code FROM sessions WHERE code=?').get(code));
    const adminKey = secret();
    db.prepare('INSERT INTO sessions(code,title,admin_key) VALUES(?,?,?)').run(code,title,adminKey);
    res.status(201).json({ code, adminKey });
  });
  app.get('/api/sessions/:code', session, (req, res) => res.json(snapshot(req.session, equal(req.get('x-admin-key'), req.session.admin_key), req.get('x-participant-id'))));
  app.get('/api/sessions/:code/events', session, (req, res) => {
    const code = req.session.code;
    res.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(res);
    res.write('data: connected\n\n');
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => { clearInterval(timer); streams.get(code)?.delete(res); if (!streams.get(code)?.size) streams.delete(code); });
  });
  app.post('/api/sessions/:code/questions', session, admin, (req, res) => {
    const prompt = clean(req.body.prompt, 300), type = req.body.type;
    const options = Array.isArray(req.body.options) ? req.body.options.map(v => clean(v,100)).filter(Boolean) : [];
    if (!prompt || !['text','rating','choice'].includes(type) || (type === 'choice' && (options.length < 2 || options.length > 8 || new Set(options).size !== options.length))) return res.status(400).json({ error: 'Add a statement and, for multiple choice, 2–8 different options.' });
    const existing = questions(req.session.code);
    if (existing.length >= 50) return res.status(400).json({ error: 'A session can have up to 50 questions.' });
    db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?)').run(secret(),req.session.code,prompt,type,JSON.stringify(type === 'choice' ? options : []),existing.length);
    notify(req.session.code); res.json({ ok: true });
  });
  app.patch('/api/sessions/:code', session, admin, (req,res) => {
    const s = req.session;
    if ('activeId' in req.body) {
      if (!questions(s.code).some(q => q.id === req.body.activeId)) return res.status(400).json({ error: 'Choose a question from this session.' });
      s.active_id = req.body.activeId; s.accepting = 1; s.revealed = 0;
    }
    for (const key of ['accepting','revealed']) if (key in req.body) {
      if (typeof req.body[key] !== 'boolean') return res.status(400).json({ error: 'Invalid setting.' });
      s[key] = Number(req.body[key]);
    }
    if (!s.active_id && (s.accepting || s.revealed)) return res.status(400).json({ error: 'Go live with a question first.' });
    db.prepare('UPDATE sessions SET active_id=?,accepting=?,revealed=? WHERE code=?').run(s.active_id,s.accepting,s.revealed,s.code);
    notify(s.code); res.json({ ok: true });
  });
  app.post('/api/sessions/:code/responses', session, (req,res) => {
    const s = req.session, participant = req.get('x-participant-id');
    if (!validId(participant)) return res.status(400).json({ error: 'Browser identity missing. Reload and try again.' });
    if (!s.accepting || !s.active_id || s.active_id !== req.body.questionId) return res.status(409).json({ error: 'This question is no longer accepting answers.' });
    const q = questions(s.code).find(q => q.id === s.active_id);
    let answer = req.body.answer;
    if (q.type === 'text') answer = clean(answer,1000);
    const valid = q.type === 'text' ? !!answer : Number.isInteger(answer) && (q.type === 'rating' ? answer >= 1 && answer <= 5 : answer >= 0 && answer < q.options.length);
    if (!valid) return res.status(400).json({ error: 'Enter an answer before sending.' });
    db.prepare('INSERT INTO responses(question_id,participant,answer) VALUES(?,?,?) ON CONFLICT(question_id,participant) DO UPDATE SET answer=excluded.answer,updated=CURRENT_TIMESTAMP').run(q.id,participant,JSON.stringify(answer));
    notify(s.code); res.json({ ok: true });
  });
  app.get('/api/sessions/:code/export', session, admin, (req,res) => {
    const rows = [['Session','Question','Type','Response']];
    for (const q of questions(req.session.code)) for (const row of db.prepare('SELECT answer FROM responses WHERE question_id=? ORDER BY rowid').all(q.id)) {
      const a = JSON.parse(row.answer); rows.push([req.session.title,q.prompt,q.type,q.type === 'choice' ? q.options[a] : String(a)]);
    }
    const csv = rows.map(row => row.map(v => '"'+ (/^[=+\-@\t\r\n]/.test(v) ? "'" : '') + v.replaceAll('"','""')+'"').join(',')).join('\r\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="roompulse-${req.session.code}.csv"` }).send('\uFEFF'+csv);
  });
  app.post('/api/qr', async (req,res) => {
    const value = clean(req.body.value,2048);
    if (!/^https?:\/\//.test(value)) return res.status(400).json({ error: 'Invalid link.' });
    res.json({ image: await QRCode.toDataURL(value, { width: 360, margin: 2, color: { dark: '#173d35', light: '#ffffff' }, errorCorrectionLevel: 'M' }) });
  });
  app.use('/api', (req,res) => res.status(404).json({ error: 'Unknown endpoint.' }));
  app.use(express.static(resolve(root, 'public')));
  app.get(['/', '/host', '/admin/:code', '/join/:code', '/present/:code'], (req,res) => res.sendFile(resolve(root,'public/index.html')));
  app.use((err,req,res,next) => { console.error(err.message); res.status(err.status || 500).json({ error: err.status === 413 ? 'That request is too large.' : err instanceof SyntaxError ? 'Invalid request.' : 'Something went wrong. Please try again.' }); });
  return { app, db, hostKey, close: () => { for (const set of streams.values()) for (const res of set) res.end(); db.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const instance = createApp();
  const ips = Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, '') || `http://${ips[0] || 'localhost'}:${port}`;
  const server = instance.app.listen(port, '0.0.0.0', () => {
    console.log(`\nRoompulse is ready.\n\nOrganizer (private): ${base}/host#${instance.hostKey}\nOn this laptop: http://localhost:${port}/host#${instance.hostKey}\nParticipants: ${base}\n\nNetwork addresses: ${ips.map(ip => `http://${ip}:${port}`).join(', ')}\nKeep this terminal open and your laptop awake.\n`);
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { instance.close(); server.close(() => process.exit(0)); });
}
