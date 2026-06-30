// ═══════════════════════════════════════════════════════════
//  TRIPLE ACE — Node.js + Socket.io Multiplayer Server
// ═══════════════════════════════════════════════════════════
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET','POST'],
    credentials: false
  },
  // Allow both WebSocket and long-polling (fallback)
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Health check endpoint ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────
const SUITS  = ['♠','♣','♥','♦'];
const SRANK  = {'♠':4,'♣':3,'♥':2,'♦':1};
const SNAME  = {'♠':'Spades','♣':'Clubs','♥':'Hearts','♦':'Diamonds'};
const VALS   = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VRANK  = {};
VALS.forEach((v,i) => VRANK[v] = i+2);

function mkDeck() {
  const d = [];
  for (const s of SUITS) for (const v of VALS) d.push({s,v});
  return d;
}
function shuffle(a) {
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function cs(c)  { return c.v + c.s; }
function cmp(a,b) {
  const vd = VRANK[a.v] - VRANK[b.v];
  return vd !== 0 ? vd : SRANK[a.s] - SRANK[b.s];
}
function bestOfHand(hand) {
  return hand.reduce((b,c) => cmp(c,b)>0 ? c : b);
}
function genCode() {
  return Math.floor(100000 + Math.random()*900000).toString();
}

// ─────────────────────────────────────────
//  ROOMS  Map<code, RoomState>
// ─────────────────────────────────────────
const rooms = new Map();

function createRoom(hostSocketId, hostName) {
  let code;
  do { code = genCode(); } while (rooms.has(code));

  const room = {
    code,
    hostId: hostSocketId,
    phase: 'lobby',   // lobby → reveal → playing → ended
    players: [],      // [{socketId, name, hand, eliminated, finishRank}]
    drawPile: [],
    roundCards: [],   // [{pid, card, isVettu}]
    leadSuit: null,
    leadPid:  null,
    currentPlayer: 0,
    roundNum: 1,
    totalDead: 0,
    finishedCount: 0,
    roundEnded: false,
    log: []
  };

  rooms.set(code, room);
  return room;
}

function addPlayer(room, socketId, name) {
  room.players.push({
    socketId,
    name,
    hand: [],
    eliminated: false,
    finishRank: null,
    revealVal: null
  });
}

function roomBroadcast(room, event, data) {
  io.to(room.code).emit(event, data);
}

function addLog(room, msg, cls='') {
  const entry = { msg, cls, t: Date.now() };
  room.log.push(entry);
  if (room.log.length > 200) room.log.shift();
  roomBroadcast(room, 'log', entry);
}

// ─────────────────────────────────────────
//  GAME LOGIC (server-authoritative)
// ─────────────────────────────────────────
function startGame(room) {
  const deck = shuffle(mkDeck());
  room.drawPile = deck;
  room.roundCards = [];
  room.leadSuit = null;
  room.leadPid  = null;
  room.roundNum = 1;
  room.totalDead = 0;
  room.finishedCount = 0;
  room.roundEnded = false;
  room.log = [];

  // Reset hands
  for (const p of room.players) {
    p.hand = [];
    p.eliminated = false;
    p.finishRank = null;
    p.revealVal = null;
  }

  // Deal 3 each
  for (let i=0;i<3;i++)
    for (const p of room.players)
      if (room.drawPile.length) p.hand.push(room.drawPile.pop());

  // First player = highest card
  let first = 0, bc = bestOfHand(room.players[0].hand);
  for (let i=1;i<room.players.length;i++) {
    const b = bestOfHand(room.players[i].hand);
    if (cmp(b,bc)>0) { bc=b; first=i; }
  }
  room.currentPlayer = first;

  // Build reveal data (value only, no suit)
  const reveals = room.players.map((p,i) => {
    const hc = bestOfHand(p.hand);
    p.revealVal = hc.v;
    return { name: p.name, val: hc.v, isFirst: i===first };
  });

  room.phase = 'reveal';
  addLog(room, `Game started! ${room.players[first].name} leads first (best card: ${cs(bc)}).`, 'le-r');

  // Send each player their own hand privately
  room.players.forEach((p,i) => {
    io.to(p.socketId).emit('deal', {
      hand: p.hand,
      reveals,
      firstPlayer: room.players[first].name,
      firstCard: cs(bc),
      playerIndex: i
    });
  });

  // Send full public state
  sendState(room);
}

function getCurrentHighestPid(room) {
  if (!room.leadSuit || room.roundCards.length===0) return room.leadPid;
  const lc = room.roundCards.filter(rc => !rc.isVettu && rc.card.s===room.leadSuit);
  if (!lc.length) return room.leadPid;
  let best = lc[0];
  for (const rc of lc) if (cmp(rc.card,best.card)>0) best=rc;
  return best.pid;
}

function playCard(room, pid, cardIndex) {
  if (room.phase !== 'playing') return { err: 'Game not in play phase' };
  if (room.roundEnded)          return { err: 'Round already ended' };
  if (room.currentPlayer !== pid) return { err: 'Not your turn' };

  const player = room.players[pid];
  const card   = player.hand[cardIndex];
  if (!card) return { err: 'Card not found' };

  if (room.leadSuit) {
    const hasSuit = player.hand.some(c => c.s===room.leadSuit);
    if (hasSuit && card.s!==room.leadSuit) return { err: `Must follow ${SNAME[room.leadSuit]}` };
    if (!hasSuit) return { err: 'VETTU_REQUIRED' };
  }

  player.hand.splice(cardIndex, 1);
  if (room.roundCards.length===0) { room.leadSuit=card.s; room.leadPid=pid; }
  room.roundCards.push({pid, card, isVettu:false});
  addLog(room, `${player.name} plays ${cs(card)}`);

  sendState(room);

  const active = room.players.filter(p=>!p.eliminated);
  const played = new Set(room.roundCards.map(rc=>rc.pid));
  if (played.size >= active.length) {
    setTimeout(() => resolveRound(room), 1200);
  } else {
    nextActive(room);
    sendState(room);
  }
  return { ok: true };
}

function playVettu(room, pid, suit) {
  if (room.phase !== 'playing') return { err: 'Game not in play phase' };
  if (room.roundEnded)          return { err: 'Round already ended' };
  if (room.currentPlayer !== pid) return { err: 'Not your turn' };
  if (!room.leadSuit)           return { err: 'No lead suit yet' };

  const player = room.players[pid];
  const hasSuit = player.hand.some(c => c.s===room.leadSuit);
  if (hasSuit) return { err: `Must follow ${SNAME[room.leadSuit]}, not vettu` };

  const vc = player.hand.filter(c => c.s===suit);
  if (!vc.length) return { err: 'No cards of that suit' };

  player.hand = player.hand.filter(c => c.s!==suit);
  for (const c of vc) room.roundCards.push({pid, card:c, isVettu:true});

  addLog(room, `${player.name} throws ${vc.length} ${SNAME[suit]} as VETTU → [${vc.map(cs).join(', ')}]`, 'le-v');
  room.roundEnded = true;

  sendState(room);
  setTimeout(() => resolveRound(room), 1200);
  return { ok: true };
}

function resolveRound(room) {
  if (!room || room.phase==='ended') return;

  const hadVettu = room.roundCards.some(rc=>rc.isVettu);
  const highestPid = getCurrentHighestPid(room);
  const highestPlayer = room.players[highestPid];
  const playedPids = new Set(room.roundCards.map(rc=>rc.pid));
  const skipped = room.players.filter(p=>!p.eliminated&&!playedPids.has(room.players.indexOf(p)));

  if (hadVettu) {
    // ALL cards → highest player's hand
    const allCards = room.roundCards.map(rc=>rc.card);
    for (const c of allCards) highestPlayer.hand.push(c);
    addLog(room, `🔴 VETTU! ALL ${allCards.length} card(s) → ${highestPlayer.name}'s hand (punishment).`, 'le-v');
  } else {
    // Clean round → dead pile
    room.totalDead += room.roundCards.length;
    addLog(room, `✅ Clean round. ${room.roundCards.length} card(s) → 💀 dead pile.`, 'le-d');
  }

  addLog(room, `${highestPlayer.name} leads next round.`, 'le-r');

  room.roundCards = [];
  room.leadSuit   = null;
  room.leadPid    = null;
  room.roundEnded = false;
  room.currentPlayer = highestPid;
  room.roundNum++;

  // Refill hands
  for (const p of room.players) {
    if (!p.eliminated && p.hand.length===0 && room.drawPile.length>0) {
      const n = Math.min(3, room.drawPile.length);
      p.hand.push(...room.drawPile.splice(0,n));
      addLog(room, `${p.name} draws ${n} card(s). (${room.drawPile.length} left)`);
    }
  }

  // Check win
  for (const p of room.players) {
    if (!p.eliminated && p.hand.length===0 && room.drawPile.length===0 && p.finishRank===null) {
      p.eliminated = true;
      p.finishRank = ++room.finishedCount;
      if (room.finishedCount===1) {
        addLog(room, `🏆 ${p.name} WINS!`, 'le-w');
        room.phase = 'ended';
        sendState(room);
        roomBroadcast(room, 'gameOver', {
          winner: p.name,
          ranks: [...room.players].sort((a,b)=>(a.finishRank||99)-(b.finishRank||99))
            .map(pl=>({name:pl.name,rank:pl.finishRank||null,handLeft:pl.hand.length}))
        });
        return;
      }
      addLog(room, `${p.name} finishes at rank #${p.finishRank}.`);
    }
  }

  const still = room.players.filter(p=>!p.eliminated);
  if (still.length<=1) {
    if (still.length===1 && still[0].finishRank===null) {
      still[0].eliminated=true; still[0].finishRank=++room.finishedCount;
    }
    const winner = room.players.find(p=>p.finishRank===1)||room.players[0];
    room.phase = 'ended';
    sendState(room);
    roomBroadcast(room, 'gameOver', {
      winner: winner.name,
      ranks: [...room.players].sort((a,b)=>(a.finishRank||99)-(b.finishRank||99))
        .map(pl=>({name:pl.name,rank:pl.finishRank||null,handLeft:pl.hand.length}))
    });
    return;
  }

  if (room.players[room.currentPlayer].eliminated) {
    const n = room.players.length;
    let next = (room.currentPlayer+1)%n;
    while (room.players[next].eliminated) next=(next+1)%n;
    room.currentPlayer = next;
  }

  addLog(room, `─── Round ${room.roundNum} ─── ${room.players[room.currentPlayer].name} leads.`, 'le-r');
  sendState(room);

  // Re-send hands (cards may have changed)
  room.players.forEach(p => {
    io.to(p.socketId).emit('handUpdate', { hand: p.hand });
  });
}

function nextActive(room) {
  const n = room.players.length;
  let next = (room.currentPlayer+1)%n;
  while (room.players[next].eliminated) next=(next+1)%n;
  room.currentPlayer = next;
}

// Public state = everything EXCEPT private hands
function getPublicState(room) {
  return {
    code:          room.code,
    phase:         room.phase,
    players:       room.players.map((p,i)=>({
      index:       i,
      name:        p.name,
      handCount:   p.hand.length,
      eliminated:  p.eliminated,
      finishRank:  p.finishRank,
      revealVal:   p.revealVal
    })),
    drawPileCount: room.drawPile.length,
    roundCards:    room.roundCards,
    leadSuit:      room.leadSuit,
    leadPid:       room.leadPid,
    currentPlayer: room.currentPlayer,
    roundNum:      room.roundNum,
    totalDead:     room.totalDead,
    roundEnded:    room.roundEnded,
    highestPid:    room.roundCards.length>0 ? getCurrentHighestPid(room) : null
  };
}

function sendState(room) {
  roomBroadcast(room, 'state', getPublicState(room));
}

// ─────────────────────────────────────────
//  SOCKET EVENTS
// ─────────────────────────────────────────
io.on('connection', socket => {
  console.log('connected:', socket.id);

  // ── CREATE ROOM ──
  socket.on('createRoom', ({name}, cb) => {
    const room = createRoom(socket.id, name);
    addPlayer(room, socket.id, name);
    socket.join(room.code);
    console.log(`Room ${room.code} created by ${name}`);
    cb({ ok:true, code:room.code, playerIndex:0 });
    sendState(room);
  });

  // ── JOIN ROOM ──
  socket.on('joinRoom', ({code, name}, cb) => {
    const room = rooms.get(code);
    if (!room)              return cb({ err:'Room not found. Check the code.' });
    if (room.phase!=='lobby') return cb({ err:'Game already started.' });
    if (room.players.length>=10) return cb({ err:'Room is full (max 10).' });

    const idx = room.players.length;
    addPlayer(room, socket.id, name);
    socket.join(code);
    console.log(`${name} joined room ${code}`);
    cb({ ok:true, code, playerIndex:idx });
    addLog(room, `${name} joined the room.`);
    sendState(room);
  });

  // ── START GAME (host only) ──
  socket.on('startGame', ({code}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({err:'Room not found.'});
    if (room.hostId!==socket.id) return cb({err:'Only the host can start.'});
    if (room.players.length<2)  return cb({err:'Need at least 2 players.'});
    if (room.phase!=='lobby')   return cb({err:'Game already started.'});
    startGame(room);
    cb({ok:true});
  });

  // ── CONFIRM REVEAL & START ROUND 1 ──
  socket.on('confirmReveal', ({code}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({err:'Room not found.'});
    if (room.hostId!==socket.id) return cb({err:'Only host can proceed.'});
    room.phase = 'playing';
    addLog(room, `─── Round 1 ─── ${room.players[room.currentPlayer].name} leads.`, 'le-r');
    sendState(room);
    // Re-send hands
    room.players.forEach(p => io.to(p.socketId).emit('handUpdate',{hand:p.hand}));
    cb({ok:true});
  });

  // ── PLAY CARD ──
  socket.on('playCard', ({code, cardIndex}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({err:'Room not found.'});
    const pid = room.players.findIndex(p=>p.socketId===socket.id);
    if (pid===-1) return cb({err:'Player not in room.'});
    const result = playCard(room, pid, cardIndex);
    cb(result);
    if (result.ok) {
      room.players.forEach(p => io.to(p.socketId).emit('handUpdate',{hand:p.hand}));
    }
  });

  // ── PLAY VETTU ──
  socket.on('playVettu', ({code, suit}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({err:'Room not found.'});
    const pid = room.players.findIndex(p=>p.socketId===socket.id);
    if (pid===-1) return cb({err:'Player not in room.'});
    const result = playVettu(room, pid, suit);
    cb(result);
    if (result.ok) {
      room.players.forEach(p => io.to(p.socketId).emit('handUpdate',{hand:p.hand}));
    }
  });

  // ── PLAY AGAIN ──
  socket.on('playAgain', ({code}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({err:'Room not found.'});
    if (room.hostId!==socket.id) return cb({err:'Only host can restart.'});
    room.phase='lobby';
    addLog(room,'Host reset the room. Starting new game…','le-r');
    sendState(room);
    cb({ok:true});
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      const p = room.players.find(p=>p.socketId===socket.id);
      if (p) {
        addLog(room, `${p.name} disconnected.`, 'le-v');
        sendState(room);
        // Clean up empty rooms
        if (room.players.every(pl=>!io.sockets.sockets.get(pl.socketId))) {
          rooms.delete(code);
          console.log(`Room ${code} deleted (all disconnected)`);
        }
        break;
      }
    }
    console.log('disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏 Triple Ace server running on port ${PORT}`);
  console.log(`🌐 Platform: ${process.env.RAILWAY_ENVIRONMENT || 'local'}`);
  console.log(`📡 Socket.io ready for WebSocket connections\n`);
});
