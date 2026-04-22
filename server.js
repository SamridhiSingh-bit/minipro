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
  cors: { origin: '*' }
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

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// In-memory storage
const users = {};
const rooms = {};

// Helper: get or create user
function findUserByUsername(username) {
  return Object.values(users).find(u => u.username === username);
}



// Random topic generator for new debates
async function generateDebateTopic() {
  const topics = [
    "AI will replace most jobs in 10 years",
    "Social media harms society more than helps",
    "Remote work is better than office work",
    "Animal testing should be completely banned", 
    "College degrees are worth the cost",
    "Nuclear energy is the solution to climate change",
    "Censorship is justified in extreme cases",
    "Minimum wage should be $25/hour",
    "Electric cars will dominate by 2030",
    "Video games cause real-world violence"
  ];
  return topics[Math.floor(Math.random() * topics.length)];
}

// Judge a message
async function judgeArgument(room, speaker, message) {
  const history = room.messages.slice(-10).map(m => `${m.username}: ${m.text}`).join('\n');
  
  const system = `You are the AI Judge for DebateX. The debate topic is: "${room.topic}"
The two debaters are: ${room.debaters.map(d => d.username).join(' vs ')}.
You are observing a live debate. When a debater makes an argument, provide brief, sharp judging feedback (2-3 sentences max).
Comment on logic, evidence quality, rhetoric, and persuasiveness. Be direct, fair, and occasionally witty.
Format: Start with "⚖️ Judge:" then your verdict on this specific argument.`;

  const prompt = `Recent debate:\n${history}\n\nLatest argument from ${speaker}:\n"${message}"\n\nJudge this argument briefly.`;
  return callClaude([{ role: 'user', content: prompt }], system);
}

// Final verdict
async function generateFinalVerdict(room) {
  const history = room.messages.filter(m => m.type === 'message').map(m => `${m.username}: ${m.text}`).join('\n');
  
  const system = `You are the AI Judge for DebateX. The debate topic was: "${room.topic}"
The two debaters were: ${room.debaters.map(d => d.username).join(' and ')}.
Analyze the entire debate and deliver a comprehensive final verdict.`;

  const prompt = `Full debate transcript:\n${history}\n\nDeliver a final verdict. Include:
1. 🏆 Winner announcement (pick one, be decisive)
2. 📊 Score breakdown for each debater (Logic, Evidence, Rhetoric, Persuasiveness — out of 10)
3. 💡 Key strengths and weaknesses for each
4. 🎯 What decided the winner
Be authoritative, fair, and detailed.`;

  return callClaude([{ role: 'user', content: prompt }], system);
}

// Routes
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
    status: 'waiting', // waiting, active, finished
    createdAt: Date.now()
  };
  res.json({ success: true, roomId });
});

app.get('/room/:id', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  const room = rooms[req.params.id];
  if (!room) return res.redirect('/lobby');
  res.render('room', { 
    username: req.session.username, 
    roomId: req.params.id,
    room 
  });
});

app.get('/api/rooms', (req, res) => {
  const publicRooms = Object.values(rooms).map(r => ({
    id: r.id,
    status: r.status,
    debaters: r.debaters.map(d => d.username),
    topic: r.topic,
    messageCount: r.messages.length
  }));
  res.json(publicRooms);
});

// Socket.IO
io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session || !session.userId) {
    socket.disconnect();
    return;
  }

  const username = session.username;
  const userId = session.userId;

  socket.on('join-room', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'Room not found');

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    // Add as debater if slot available, else spectator
    const isDebater = room.debaters.length < 2 && !room.debaters.find(d => d.id === userId);
    const isExisting = room.debaters.find(d => d.id === userId);

    if (!isExisting && isDebater) {
      room.debaters.push({ id: userId, username, socketId: socket.id });
    } else if (!isExisting) {
      if (!room.spectators.find(s => s.id === userId)) {
        room.spectators.push({ id: userId, username, socketId: socket.id });
      }
    } else {
      // Update socket id for reconnect
      const debater = room.debaters.find(d => d.id === userId);
      if (debater) debater.socketId = socket.id;
    }

    // Send current room state
    socket.emit('room-state', {
      room: {
        id: room.id,
        debaters: room.debaters.map(d => d.username),
        status: room.status,
        topic: room.topic,
        messages: room.messages
      },
      role: room.debaters.find(d => d.id === userId) ? 'debater' : 'spectator'
    });

    // Notify room
    io.to(roomId).emit('user-joined', { 
      username,
      debaters: room.debaters.map(d => d.username),
      spectatorCount: room.spectators.length
    });

    // Start debate when 2 debaters join
    if (room.debaters.length === 2 && room.status === 'waiting') {
      room.status = 'starting';
      io.to(roomId).emit('debate-starting', { debaters: room.debaters.map(d => d.username) });
      
      // Generate topic
      setTimeout(async () => {
        const topic = await generateDebateTopic();
        room.topic = topic;
        room.status = 'active';
        
        const judgeIntro = {
          id: uuidv4(),
          type: 'judge',
          username: '⚖️ AI Judge',
          text: `Welcome to DebateX! Today's debate topic:\n\n"${topic}"\n\n${room.debaters[0].username} will argue FOR this position. ${room.debaters[1].username} will argue AGAINST. Each debater should make their opening statement. The debate begins now!`,
          timestamp: Date.now()
        };
        room.messages.push(judgeIntro);
        io.to(roomId).emit('debate-started', { topic, judgeMessage: judgeIntro });
      }, 2000);
    }
  });

  socket.on('send-message', async ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'active') return;
    
    const isDebater = room.debaters.find(d => d.id === userId);
    if (!isDebater) return socket.emit('error', 'Only debaters can send messages');

    const msg = {
      id: uuidv4(),
      type: 'message',
      username,
      text,
      timestamp: Date.now()
    };
    room.messages.push(msg);
    io.to(roomId).emit('new-message', msg);

    // AI Judge comments every 2 messages
    const debateMessages = room.messages.filter(m => m.type === 'message');
    if (debateMessages.length % 2 === 0 || Math.random() < 0.4) {
      setTimeout(async () => {
        const judgment = await judgeArgument(room, username, text);
        const judgeMsg = {
          id: uuidv4(),
          type: 'judge',
          username: '⚖️ AI Judge',
          text: judgment,
          timestamp: Date.now()
        };
        room.messages.push(judgeMsg);
        io.to(roomId).emit('new-message', judgeMsg);
      }, 1500);
    }
  });

  socket.on('end-debate', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'active') return;
    if (!room.debaters.find(d => d.id === userId)) return;

    room.status = 'judging';
    io.to(roomId).emit('debate-ending');

    const verdict = await generateFinalVerdict(room);
    room.status = 'finished';

    const verdictMsg = {
      id: uuidv4(),
      type: 'verdict',
      username: '⚖️ AI Judge — FINAL VERDICT',
      text: verdict,
      timestamp: Date.now()
    };
    room.messages.push(verdictMsg);
    io.to(roomId).emit('final-verdict', verdictMsg);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    // Remove from lists
    room.debaters = room.debaters.filter(d => d.id !== userId);
    room.spectators = room.spectators.filter(s => s.id !== userId);

    io.to(roomId).emit('user-left', {
      username,
      debaters: room.debaters.map(d => d.username)
    });

    // Clean up empty rooms after 10 mins
    if (room.debaters.length === 0 && room.spectators.length === 0) {
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].debaters.length === 0) {
          delete rooms[roomId];
        }
      }, 600000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DebateX running on port ${PORT}`);
});
