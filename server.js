const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'debatex-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

const users = {};
const rooms = {};

function findUserByUsername(username) {
  return Object.values(users).find(u => u.username === username);
}

// ─────────────────────────────────────────────
//  RULE-BASED JUDGE  (zero API key needed)
// ─────────────────────────────────────────────

const TOPICS = [
  "Social media does more harm than good to society",
  "Artificial intelligence will eliminate more jobs than it creates",
  "College education is no longer worth the cost",
  "Climate change should be treated as a global emergency requiring immediate action",
  "Cryptocurrency will replace traditional banking within 20 years",
  "Remote work is more productive than working in an office",
  "Governments should ban single-use plastics entirely",
  "Video games have a net positive effect on mental health",
  "Space exploration is a waste of money when Earth has unsolved problems",
  "Universal Basic Income should be implemented globally",
  "Social media influencers have more cultural impact than traditional celebrities",
  "Nuclear energy is the best solution to the climate crisis",
  "Homework does more harm than good for students",
  "Animals should have the same legal rights as humans",
  "The death penalty should be abolished worldwide",
  "Genetically modified foods are safe and should be embraced",
  "Online learning will replace traditional schools within 50 years",
  "Billionaires should not exist in a fair society",
  "Smartphones have made humans less intelligent",
  "Veganism is the only ethical diet in the modern world",
  "Democracy is the best form of government for all nations",
  "Censorship on the internet is sometimes necessary",
  "Humans should colonize Mars within the next 100 years",
  "Fast fashion should be banned due to its environmental impact",
  "Mental health days should be mandatory in workplaces",
  "Cash will be completely replaced by digital payments within a decade",
  "Athletes are paid too much compared to their social contribution",
  "The voting age should be lowered to 16",
  "Standardized testing is an outdated and unfair measure of intelligence",
  "Zoos should be abolished in the modern era",
  "Autonomous vehicles will make roads safer than human drivers",
  "Privacy is more important than national security",
  "The four-day work week should become the global standard",
  "Eating meat is ethically unjustifiable in today's world",
  "Screen time limits should be enforced for children by law",
  "Technology companies have too much power over democracy",
  "Free healthcare should be a universal human right",
  "Parents should be held legally responsible for their children's crimes",
  "Reality TV shows do more harm than good to society",
  "The use of performance-enhancing drugs should be allowed in sports",
  "Graffiti is a legitimate form of art, not vandalism",
  "Humans are fundamentally good by nature",
  "Social media algorithms are destroying political discourse",
  "Tourism does more harm than good to local cultures",
  "The internet has made people more lonely, not less",
  "Mandatory military service should be introduced in all countries",
  "Junk food advertising should be banned",
  "Robots will make humanity happier and more fulfilled",
  "The news media creates more fear than it resolves",
  "Open borders would benefit the global economy"
];

const STRONG_WORDS = [
  'because','therefore','evidence','research','study','proves','demonstrates',
  'statistics','data','fact','example','clearly','according','shows','results',
  'majority','significant','important','critical','essential','fundamental',
  'proven','established','scientific','logical','rational','argument','point',
  'furthermore','moreover','additionally','consequently','thus','hence',
  'analysis','survey','report','experts','scientists','scholars','history',
  'illustrates','supports','confirms','reveals','concludes','indicates'
];

const WEAK_WORDS = [
  'i think','maybe','perhaps','probably','i feel','i believe','might',
  'sort of','kind of','i guess','i suppose','not sure','anyway'
];

const COMMENTS_FOR = [
  "Strong opening — a clear position backed by reasoning. Point awarded. ⚡",
  "Good structure. The argument flows logically. Keep building on this. 📈",
  "Solid point. Adding specific examples next would make this bulletproof. 🎯",
  "The FOR side is building momentum. Well-reasoned argument. ✅",
  "Evidence-backed reasoning — exactly what this judge likes to see. 📊",
  "Persuasive. The FOR side is clearly in their element here. 🔥",
  "Clear and concise. A well-made argument scores points every time. ✔️",
  "Good rebuttal energy. You're not just arguing — you're countering. 💪",
  "Strong rhetoric backed by reasoning. The crowd would be swayed. 🎤",
  "The FOR side continues to press. Logical consistency noted. 🧠"
];

const COMMENTS_AGAINST = [
  "A sharp counter-argument. The AGAINST side is not backing down. ⚡",
  "Good challenge to the opposing view. Keep the pressure on. 🔄",
  "The AGAINST side raises valid concerns. This judge is listening. 👂",
  "Solid pushback. Pointing out weaknesses in an argument is a skill. 🎯",
  "The AGAINST side is finding their rhythm. Keep this up. 📈",
  "Well-structured counter. Dismantling the other side — good work. 💥",
  "The AGAINST side lands a meaningful point. Scoreboard shifts. ✅",
  "You're not just disagreeing — you're explaining WHY. That's debating. 🧠",
  "Powerful challenge. This is what a real debate looks like. 🔥",
  "The AGAINST side comes alive. Momentum is shifting. ⚖️"
];

const COMMENTS_WEAK = [
  "This judge expected more substance. A claim without evidence is just an opinion. 🤔",
  "Interesting point — but where's the evidence? Assertions don't win debates. ❓",
  "Too vague. Be specific — examples, data, or logic. Right now it's just words. 📝",
  "The other side will eat this alive without supporting evidence. ⚠️",
  "Passion is good. Reasoning is better. This judge needs more of the latter. 💡",
  "Short arguments rarely win debates. Elaborate, explain, convince. 📢",
  "This judge has seen stronger. Dig deeper into your argument. 🔍",
  "A good start — but finish the thought. Half an argument scores half the points. ⚡"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDebateTopic() {
  return pickRandom(TOPICS);
}

function scoreArgument(text) {
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).length;
  let score = 0;

  // Length scoring (max 3)
  if (wordCount >= 80) score += 3;
  else if (wordCount >= 40) score += 2;
  else if (wordCount >= 15) score += 1;

  // Strong word bonus (max 4)
  const strong = STRONG_WORDS.filter(w => lower.includes(w)).length;
  score += Math.min(strong, 4);

  // Weak word penalty
  const weak = WEAK_WORDS.filter(w => lower.includes(w)).length;
  score -= weak;

  // Question bonus (engaging rhetoric)
  if (text.includes('?')) score += 1;

  // Punctuation variety
  if (text.includes(',') && text.includes('.')) score += 1;

  return Math.max(0, Math.min(10, score));
}

function judgeArgument(room, speakerUsername, text) {
  const isD1 = room.debaters[0] && room.debaters[0].username === speakerUsername;
  const argScore = scoreArgument(text);

  if (!room.scores) room.scores = { d1: 0, d2: 0, d1Count: 0, d2Count: 0 };
  if (isD1) { room.scores.d1 += argScore; room.scores.d1Count++; }
  else       { room.scores.d2 += argScore; room.scores.d2Count++; }

  let comment;
  if (argScore <= 2)   comment = pickRandom(COMMENTS_WEAK);
  else if (isD1)       comment = pickRandom(COMMENTS_FOR);
  else                 comment = pickRandom(COMMENTS_AGAINST);

  const bar = '█'.repeat(argScore) + '░'.repeat(10 - argScore);
  return `⚖️ Judge: ${comment}\n\nArgument Strength: [${bar}] ${argScore}/10`;
}

function generateFinalVerdict(room) {
  const s = room.scores || { d1: 0, d2: 0, d1Count: 0, d2Count: 0 };
  const d1 = room.debaters[0];
  const d2 = room.debaters[1];

  const d1Avg = s.d1Count > 0 ? (s.d1 / s.d1Count).toFixed(1) : '0.0';
  const d2Avg = s.d2Count > 0 ? (s.d2 / s.d2Count).toFixed(1) : '0.0';

  const logic1    = Math.min(10, Math.round(s.d1 * 0.35 + (s.d1Count > 3 ? 2 : 0)));
  const evidence1 = Math.min(10, Math.round(s.d1 * 0.28));
  const rhetoric1 = Math.min(10, Math.round(s.d1 * 0.22 + 1));
  const persuade1 = Math.min(10, Math.round(s.d1 * 0.25 + (parseFloat(d1Avg) > 5 ? 1 : 0)));

  const logic2    = Math.min(10, Math.round(s.d2 * 0.35 + (s.d2Count > 3 ? 2 : 0)));
  const evidence2 = Math.min(10, Math.round(s.d2 * 0.28));
  const rhetoric2 = Math.min(10, Math.round(s.d2 * 0.22 + 1));
  const persuade2 = Math.min(10, Math.round(s.d2 * 0.25 + (parseFloat(d2Avg) > 5 ? 1 : 0)));

  const totalMsgs = room.messages.filter(m => m.type === 'message').length;
  const tied = s.d1 === s.d2;
  const d1Wins = s.d1 >= s.d2;

  const winnerName = tied ? null : (d1Wins ? d1?.username : d2?.username);
  const loserName  = tied ? null : (d1Wins ? d2?.username : d1?.username);
  const diff = Math.abs(s.d1 - s.d2);

  let closing;
  if (tied)        closing = "An exceptionally balanced debate. Both debaters showed equal conviction. The Judge declares a DRAW — a rare and honourable outcome.";
  else if (diff > 8) closing = `${winnerName} dominated this debate from the very first argument. The opposition barely had a chance.`;
  else if (diff > 3) closing = `${winnerName} pulled ahead consistently with better-structured arguments throughout.`;
  else               closing = `A nail-biting finish! ${winnerName} edged the victory by a slim margin. ${loserName} should be proud of a fierce contest.`;

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️  FINAL VERDICT  ⚖️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Topic: "${room.topic}"
💬 Total Arguments: ${totalMsgs}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SCORECARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔵 ${d1?.username} (FOR)
   Logic & Reasoning ......... ${logic1}/10
   Evidence Quality .......... ${evidence1}/10
   Rhetoric & Style .......... ${rhetoric1}/10
   Persuasiveness ............ ${persuade1}/10
   Arguments Made ............ ${s.d1Count}
   Average Score ............. ${d1Avg}/10
   Total Points .............. ${s.d1}

🔴 ${d2?.username} (AGAINST)
   Logic & Reasoning ......... ${logic2}/10
   Evidence Quality .......... ${evidence2}/10
   Rhetoric & Style .......... ${rhetoric2}/10
   Persuasiveness ............ ${persuade2}/10
   Arguments Made ............ ${s.d2Count}
   Average Score ............. ${d2Avg}/10
   Total Points .............. ${s.d2}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 WINNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${tied ? '🤝 DRAW — Both debaters are equally matched!' : `🥇 ${winnerName.toUpperCase()} wins the debate!`}

${closing}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Thank you for debating on DebateX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/lobby');
  res.render('index');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'All fields required' });
  if (findUserByUsername(username)) return res.json({ success: false, error: 'Username taken' });
  const id = uuidv4();
  const hashed = await bcrypt.hash(password, 10);
  users[id] = { id, username, password: hashed };
  req.session.userId = id;
  req.session.username = username;
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);
  if (!user) return res.json({ success: false, error: 'User not found' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.json({ success: false, error: 'Invalid password' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true });
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/lobby', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  res.render('lobby', { username: req.session.username, rooms });
});

app.post('/create-room', (req, res) => {
  if (!req.session.userId) return res.json({ success: false });
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms[roomId] = {
    id: roomId,
    debaters: [],
    spectators: [],
    messages: [],
    topic: null,
    scores: { d1: 0, d2: 0, d1Count: 0, d2Count: 0 },
    status: 'waiting',
    createdAt: Date.now()
  };
  res.json({ success: true, roomId });
});

app.get('/room/:id', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  const room = rooms[req.params.id];
  if (!room) return res.redirect('/lobby');
  res.render('room', { username: req.session.username, roomId: req.params.id, room });
});

app.get('/api/rooms', (req, res) => {
  res.json(Object.values(rooms).map(r => ({
    id: r.id,
    status: r.status,
    debaters: r.debaters.map(d => d.username),
    topic: r.topic,
    messageCount: r.messages.length
  })));
});

// ─────────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────────

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.userId) { socket.disconnect(); return; }

  const username = sess.username;
  const userId = sess.userId;

  socket.on('join-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'Room not found');

    socket.join(roomId);
    socket.roomId = roomId;

    const isExisting = room.debaters.find(d => d.id === userId);
    const canJoin = room.debaters.length < 2 && !isExisting;

    if (!isExisting && canJoin) {
      room.debaters.push({ id: userId, username, socketId: socket.id });
    } else if (!isExisting) {
      if (!room.spectators.find(s => s.id === userId))
        room.spectators.push({ id: userId, username, socketId: socket.id });
    } else {
      const d = room.debaters.find(d => d.id === userId);
      if (d) d.socketId = socket.id;
    }

    socket.emit('room-state', {
      room: {
        id: room.id,
        debaters: room.debaters.map(d => d.username),
        status: room.status,
        topic: room.topic,
        messages: room.messages,
        scores: room.scores
      },
      role: room.debaters.find(d => d.id === userId) ? 'debater' : 'spectator'
    });

    io.to(roomId).emit('user-joined', {
      username,
      debaters: room.debaters.map(d => d.username),
      spectatorCount: room.spectators.length
    });

    if (room.debaters.length === 2 && room.status === 'waiting') {
      room.status = 'starting';
      io.to(roomId).emit('debate-starting', { debaters: room.debaters.map(d => d.username) });

      setTimeout(() => {
        const topic = generateDebateTopic();
        room.topic = topic;
        room.status = 'active';

        const intro = {
          id: uuidv4(),
          type: 'judge',
          username: '⚖️ Judge',
          text: `Welcome to DebateX!\n\nToday's debate topic:\n\n"${topic}"\n\n🔵 ${room.debaters[0].username} will argue FOR this position.\n🔴 ${room.debaters[1].username} will argue AGAINST.\n\nMake your opening statements. The Judge is watching every word. The debate begins NOW!`,
          timestamp: Date.now()
        };
        room.messages.push(intro);
        io.to(roomId).emit('debate-started', { topic, judgeMessage: intro });
      }, 2000);
    }
  });

  socket.on('send-message', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'active') return;
    if (!room.debaters.find(d => d.id === userId))
      return socket.emit('error', 'Only debaters can send messages');

    const msg = { id: uuidv4(), type: 'message', username, text, timestamp: Date.now() };
    room.messages.push(msg);
    io.to(roomId).emit('new-message', msg);

    const debateMsgs = room.messages.filter(m => m.type === 'message');
    if (debateMsgs.length % 2 === 0 || Math.random() < 0.4) {
      setTimeout(() => {
        const judgment = judgeArgument(room, username, text);
        const jMsg = {
          id: uuidv4(), type: 'judge', username: '⚖️ Judge',
          text: judgment, timestamp: Date.now(), scores: { ...room.scores }
        };
        room.messages.push(jMsg);
        io.to(roomId).emit('new-message', jMsg);
        io.to(roomId).emit('score-update', {
          scores: room.scores,
          debaters: room.debaters.map(d => d.username)
        });
      }, 1200);
    }
  });

  socket.on('end-debate', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'active') return;
    if (!room.debaters.find(d => d.id === userId)) return;

    room.status = 'judging';
    io.to(roomId).emit('debate-ending');

    setTimeout(() => {
      const verdict = generateFinalVerdict(room);
      room.status = 'finished';
      const vMsg = {
        id: uuidv4(), type: 'verdict',
        username: '⚖️ Judge — FINAL VERDICT',
        text: verdict, timestamp: Date.now()
      };
      room.messages.push(vMsg);
      io.to(roomId).emit('final-verdict', vMsg);
    }, 1500);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.debaters = room.debaters.filter(d => d.id !== userId);
    room.spectators = room.spectators.filter(s => s.id !== userId);
    io.to(roomId).emit('user-left', { username, debaters: room.debaters.map(d => d.username) });
    if (room.debaters.length === 0 && room.spectators.length === 0) {
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].debaters.length === 0) delete rooms[roomId];
      }, 600000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DebateX running on port ${PORT}`));
