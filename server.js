const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// Room state. Nothing here ever touches the movie file itself - the server
// only ever sees room codes and tiny {action, time} sync events.
// ---------------------------------------------------------------------------
const rooms = new Map(); // code -> { users: Set<userId>, activeSockets: Set<socket.id>, destroyTimer: null }
const MAX_ROOM_SIZE = 2; // this app is built for a couple, not a crowd

// Ambiguous-looking characters (0/O, 1/I) are excluded so a whispered stub
// code over the phone is never misheard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 5) {
  let code;
  do {
    code = Array.from(
      { length },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  socket.data.room = null;

  socket.on('create-room', (userId, ack) => {
    console.log(`[DEBUG] create-room called by socket ${socket.id}, userId:`, userId);
    // If old client, userId might be the ack callback
    if (typeof userId === 'function') {
      ack = userId;
      userId = socket.id;
    }

    const code = generateRoomCode();
    rooms.set(code, {
      users: new Set([userId]),
      activeSockets: new Set([socket.id]),
      destroyTimer: null
    });
    socket.join(code);
    socket.data.room = code;
    socket.data.userId = userId;
    ack?.({ ok: true, code, size: 1 });
  });

  socket.on('join-room', (payload, ack) => {
    console.log(`[DEBUG] join-room called by socket ${socket.id} with payload:`, payload);
    let rawCode, userId;
    if (typeof payload === 'object') {
      rawCode = payload.code;
      userId = payload.userId;
    } else {
      rawCode = payload;
      userId = socket.id;
    }

    const code = String(rawCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      ack?.({ ok: false, error: "That stub code doesn't match a screening." });
      return;
    }

    if (room.destroyTimer) {
      clearTimeout(room.destroyTimer);
      room.destroyTimer = null;
    }

    const isReconnect = room.users.has(userId);

    if (!isReconnect && room.users.size >= MAX_ROOM_SIZE) {
      ack?.({ ok: false, error: 'Both seats in that screening are already taken (Room Locked).' });
      return;
    }

    room.users.add(userId);
    room.activeSockets.add(socket.id);
    socket.join(code);
    socket.data.room = code;
    socket.data.userId = userId;

    ack?.({ ok: true, code, size: room.activeSockets.size });
    socket.to(code).emit('partner-joined', room.activeSockets.size);
  });

  // -------------------------------------------------------------------------
  // LOOP-PREVENTION, LAYER 1 (server-side):
  // socket.to(room) broadcasts to everyone in the room EXCEPT the sender.
  // The sender's own action can never bounce back to itself from here,
  // no matter what the client does. This alone stops server-side echo;
  // the client-side suppression flag (see app.js) stops the DOM-event echo
  // that would otherwise happen when the *other* browser applies the change.
  // -------------------------------------------------------------------------
  socket.on('sync-event', (payload) => {
    const room = socket.data.room;
    if (!room) return;
    if (!payload || typeof payload.time !== 'number') return;
    socket.to(room).emit('sync-event', payload);
  });

  socket.on('movie-info', (info) => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('movie-info', info);
  });

  socket.on('leave-room', () => {
    const code = socket.data.room;
    const userId = socket.data.userId;
    console.log(`[DEBUG] leave-room called by socket ${socket.id}, room: ${code}, userId: ${userId}`);
    if (code && rooms.has(code)) {
      const room = rooms.get(code);
      room.users.delete(userId);
      room.activeSockets.delete(socket.id);
      socket.leave(code);
      socket.data.room = null;
      socket.data.userId = null;
      socket.to(code).emit('partner-left', room.activeSockets.size);
      
      if (room.activeSockets.size === 0) {
        if (room.destroyTimer) clearTimeout(room.destroyTimer);
        rooms.delete(code);
      }
    }
  });

  socket.on('chat-message', (text) => {
    const code = socket.data.room;
    if (code) socket.to(code).emit('chat-message', text);
  });

  socket.on('reaction', (emoji) => {
    const code = socket.data.room;
    if (code) socket.to(code).emit('reaction', emoji);
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    const userId = socket.data.userId;
    console.log(`[DEBUG] disconnect called by socket ${socket.id}, room: ${code}, userId: ${userId}`);
    if (code && rooms.has(code)) {
      const room = rooms.get(code);
      room.activeSockets.delete(socket.id);
      socket.to(code).emit('partner-left', room.activeSockets.size);
      
      if (room.activeSockets.size === 0) {
        room.destroyTimer = setTimeout(() => {
          rooms.delete(code);
        }, 1000 * 60 * 5); // Keep empty rooms alive for 5 minutes for reconnection
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Two Seats, One Screen — listening on port ${PORT}`);
});
