const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const app = express();
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const rooms = new Map();
const MAX_PLAYERS = 30;
const clean = (x, max = 40) => String(x ?? '').trim().slice(0, max);
const sendError = (socket, message) => socket.emit('game:error', message);
const randomPin = () => { let pin; do { pin = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(pin)); return pin; };
function summary(room) {
  return { pin: room.pin, status: room.status, questionIndex: room.index,
    totalQuestions: room.questions.length, playerCount: room.players.size,
    players: [...room.players.values()].map(p => ({ name: p.name, score: p.score, connected: !!p.socketId })).sort((a,b) => b.score - a.score),
    question: room.status === 'question' || room.status === 'results' ? (() => {
      const q = room.questions[room.index];
      return { text: q.text, choices: q.choices, duration: q.duration,
        endsAt: room.endsAt, correct: room.status === 'results' ? q.correct : null,
        counts: room.status === 'results' ? q.choices.map((_,i) => [...room.answers.values()].filter(a=>a.choice===i).length) : null };
    })() : null };
}
function broadcast(room) { io.to(room.pin).emit('game:state', summary(room)); }
function results(room) {
  if (room.status !== 'question') return;
  clearTimeout(room.timer); room.status = 'results';
  const q = room.questions[room.index];
  for (const [token, a] of room.answers) {
    const p = room.players.get(token); if (!p) continue;
    if (a.choice === q.correct) p.score += 500 + Math.floor(500 * Math.max(0, (room.endsAt - a.at) / (q.duration * 1000)));
  }
  broadcast(room);
}
function requireHost(socket, pin) {
  const room = rooms.get(clean(pin, 6));
  if (!room || room.hostSocket !== socket.id) { sendError(socket, 'Only the host can do that.'); return null; }
  return room;
}
io.on('connection', socket => {
  socket.on('host:create', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const raw = Array.isArray(payload?.questions) ? payload.questions : [];
    if (raw.length < 1 || raw.length > 50) return ack({ error: 'Add between 1 and 50 questions.' });
    const questions = [];
    for (const item of raw) {
      const text = clean(item.text, 250), choices = Array.isArray(item.choices) ? item.choices.map(x => clean(x, 120)) : [];
      const correct = Number(item.correct), duration = Number(item.duration);
      if (!text || choices.length !== 4 || choices.some(x => !x) || !Number.isInteger(correct) || correct < 0 || correct > 3 || ![10,15,20,30,45,60].includes(duration)) return ack({ error: 'Each question needs text, four choices, one correct answer, and a valid timer.' });
      questions.push({ text, choices, correct, duration });
    }
    const pin = randomPin();
    const room = { pin, hostSocket: socket.id, questions, players: new Map(), answers: new Map(), status: 'lobby', index: -1, timer: null, endsAt: null };
    rooms.set(pin, room); socket.join(pin); socket.data.hostPin = pin;
    ack({ pin }); broadcast(room);
  });
  socket.on('player:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const pin = clean(payload?.pin, 6), name = clean(payload?.name, 24);
    const room = rooms.get(pin);
    if (!room) return ack({ error: 'Game PIN not found.' });
    if (room.status === 'finished') return ack({ error: 'This game has finished.' });
    if (!name) return ack({ error: 'Enter a nickname.' });
    const requested = clean(payload?.token, 100);
    let token = requested && room.players.has(requested) ? requested : null;
    if (!token && room.status !== 'lobby') return ack({ error: 'Game already started.' });
    if (!token && room.players.size >= MAX_PLAYERS) return ack({ error: 'This game is full (30 players).' });
    if (!token && [...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return ack({ error: 'Nickname is already taken.' });
    if (!token) { token = crypto.randomBytes(24).toString('hex'); room.players.set(token, { name, score: 0, socketId: socket.id }); }
    const player = room.players.get(token);
    if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.leave(pin);
    player.socketId = socket.id;
    socket.data.player = { pin, token }; socket.join(pin);
    ack({ pin, token, name: player.name, answered: room.answers.has(token) });
    broadcast(room);
  });
  socket.on('player:answer', ({ choice } = {}) => {
    const info = socket.data.player; if (!info) return;
    const room = rooms.get(info.pin); if (!room || room.status !== 'question') return;
    const player = room.players.get(info.token);
    if (!player || player.socketId !== socket.id || room.answers.has(info.token)) return;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3 || Date.now() >= room.endsAt) return;
    room.answers.set(info.token, { choice, at: Date.now() });
    socket.emit('player:answered', choice);
    io.to(room.hostSocket).emit('host:answer-count', { answered: room.answers.size, total: room.players.size });
    if (room.answers.size >= [...room.players.values()].filter(p => p.socketId).length) results(room);
  });
  socket.on('host:next', ({ pin } = {}) => {
    const room = requireHost(socket, pin); if (!room) return;
    if (!['lobby', 'results'].includes(room.status)) return;
    if (room.index + 1 >= room.questions.length) { room.status = 'finished'; broadcast(room); return; }
    room.index++; room.status = 'question'; room.answers.clear();
    const duration = room.questions[room.index].duration;
    room.endsAt = Date.now() + duration * 1000;
    broadcast(room);
    room.timer = setTimeout(() => results(room), duration * 1000);
  });
  socket.on('host:reveal', ({ pin } = {}) => { const room = requireHost(socket, pin); if (room) results(room); });
  socket.on('disconnect', () => {
    const pin = socket.data.hostPin;
    if (pin) { const room = rooms.get(pin); if (room && room.hostSocket === socket.id) { clearTimeout(room.timer); io.to(pin).emit('game:closed'); rooms.delete(pin); } }
    const info = socket.data.player;
    if (info) { const room = rooms.get(info.pin), player = room?.players.get(info.token); if (player?.socketId === socket.id) { player.socketId = null; if (room.status === 'lobby') room.players.delete(info.token); broadcast(room); } }
  });
});
server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Quiz Party listening'));
