const socket = io();

let currentRoomCode = sessionStorage.getItem('tsos-room-code') || null;
let myUserId = sessionStorage.getItem('tsos-user-id');
if (!myUserId) {
  myUserId = Math.random().toString(36).substring(2, 10);
  sessionStorage.setItem('tsos-user-id', myUserId);
}
// ---- DOM refs ----
const setupScreen = document.getElementById('setup-screen');
const theaterScreen = document.getElementById('theater-screen');
const createBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const joinError = document.getElementById('join-error');
const stubCodeEl = document.getElementById('stub-code');
const statusDot = document.getElementById('status-dot');
const statusEl = document.getElementById('status');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const video = document.getElementById('video');
const fileBtn = document.getElementById('file-btn');
const fallbackFileInput = document.getElementById('fallback-file-input');
const resumeFileBtn = document.getElementById('resume-file-btn');
const subBtn = document.getElementById('sub-btn');
const subInput = document.getElementById('sub-input');
const fileNameEl = document.getElementById('file-name');
const noFilePlaceholder = document.getElementById('no-file-placeholder');
const screenFrame = document.querySelector('.screen-frame');

// Interaction Overlay Elements
const interactionOverlay = document.getElementById('interaction-overlay');
const chatPanel = document.getElementById('chat-panel');
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatEphemeral = document.getElementById('chat-ephemeral');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const reactionBtns = {
  '❤️': document.getElementById('reaction-heart-btn'),
  '😂': document.getElementById('reaction-laugh-btn'),
  '🍿': document.getElementById('reaction-popcorn-btn')
};

const reactionsLayer = document.getElementById('reactions-layer');

// Initialize Plyr
const player = new Plyr('#video', {
  captions: { active: true, update: true, language: 'en' },
  controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
  settings: ['captions', 'quality', 'speed'],
});

player.on('ready', () => {
  // Move our custom overlays inside the Plyr wrapper so they stay visible in Fullscreen!
  const plyrContainer = document.querySelector('.plyr');
  const reactionsLayer = document.getElementById('reactions-layer');
  const chatEphemeral = document.getElementById('chat-ephemeral');
  const interactionOverlay = document.getElementById('interaction-overlay');
  
  if (plyrContainer) {
    if (reactionsLayer) plyrContainer.appendChild(reactionsLayer);
    if (chatEphemeral) plyrContainer.appendChild(chatEphemeral);
    if (interactionOverlay) plyrContainer.appendChild(interactionOverlay);
  }
});

// Periodically save the current time to sessionStorage so it survives refreshes
setInterval(() => {
  if (video.readyState > 0) {
    sessionStorage.setItem('tsos-video-time', video.currentTime);
  }
}, 1000);

// ---- IndexedDB Helper for File Handle ----
const dbName = 'tsos-db';
const storeName = 'file-handles';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject('IDB Error');
  });
}

async function saveFileHandle(handle) {
  const db = await getDB();
  db.transaction(storeName, 'readwrite').objectStore(storeName).put(handle, 'movie');
}

async function getFileHandle() {
  const db = await getDB();
  return new Promise(resolve => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get('movie');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// ---------------------------------------------------------------------------
// LOOP-PREVENTION, LAYER 2 (client-side):
// When a sync-event arrives from the other browser, we apply it by calling
// video.play()/pause()/currentTime=. Those calls fire the *exact same*
// 'play'/'pause'/'seeked' DOM events that a real human click would fire.
// Without a guard, applying a remote command would immediately re-emit it
// right back to the sender, which echoes back again, forever.
//
// `suppressEmit` is raised right before we touch the <video> element
// programmatically, and lowered again a short moment later (long enough to
// cover the async gap between calling .play() and the 'play' event actually
// firing). While it's raised, our own outgoing listeners go silent.
// ---------------------------------------------------------------------------
let suppressEmit = false;
let suppressTimer = null;
const SUPPRESS_WINDOW_MS = 400;

function applyRemote(fn) {
  suppressEmit = true;
  fn();
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => { suppressEmit = false; }, SUPPRESS_WINDOW_MS);
}

// Small corrections (a few hundred ms of natural network/decoder jitter)
// aren't worth acting on and would just cause both sides to keep nudging
// each other. Only resync if the drift is actually noticeable.
const SEEK_THRESHOLD_SEC = 0.75;
let lastEmittedTime = 0;

// ---- Room setup ----
createBtn.addEventListener('click', () => {
  console.log('[DEBUG] Start screening clicked. UserId:', myUserId);
  createBtn.disabled = true;
  socket.emit('create-room', myUserId, (res) => {
    createBtn.disabled = false;
    if (res?.ok) {
      currentRoomCode = res.code;
      sessionStorage.setItem('tsos-room-code', res.code);
      enterTheater(res.code);
    }
  });
});

joinBtn.addEventListener('click', attemptJoin);
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

function attemptJoin() {
  const code = roomCodeInput.value.trim();
  if (!code) return;
  console.log('[DEBUG] Attempting to join code:', code, 'UserId:', myUserId);
  joinError.textContent = '';
  joinBtn.disabled = true;
  socket.emit('join-room', { code, userId: myUserId }, (res) => {
    joinBtn.disabled = false;
    if (res?.ok) {
      currentRoomCode = res.code;
      sessionStorage.setItem('tsos-room-code', res.code);
      enterTheater(res.code);
      if (res.size === 2) {
        setStatus('Both seats filled. Enjoy the show.', true);
      } else {
        setStatus("Waiting for your date to take their seat…", false);
      }
    } else {
      joinError.textContent = res?.error || 'Something went wrong.';
    }
  });
}

function enterTheater(code) {
  stubCodeEl.textContent = code;
  setupScreen.classList.add('hidden');
  theaterScreen.classList.remove('hidden');
  // Default status — will be overridden by caller if needed
  setStatus('Waiting for your date to take their seat…', false);
}

leaveRoomBtn.addEventListener('click', () => {
  socket.emit('leave-room');
  currentRoomCode = null;
  sessionStorage.removeItem('tsos-room-code');
  theaterScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  video.pause();
});

socket.on('partner-joined', (activeSeats) => {
  if (activeSeats === 2) setStatus('Both seats filled. Enjoy the show.', true);
});
socket.on('partner-left', () => {
  setStatus("Your date's stepped into the lobby…", false);
  if (!video.paused) {
    video.pause();
    setStatus("Partner left. Pausing movie...", false);
  }
});

socket.on('disconnect', () => {
  console.log('[DEBUG] Socket disconnected. currentRoomCode:', currentRoomCode);
  if (currentRoomCode) {
    setStatus('Connection lost. Attempting to reconnect...', false);
  } else {
    setStatus('Lost connection to the theater.', false);
  }
});

socket.on('connect', () => {
  console.log('[DEBUG] Socket connected. currentRoomCode:', currentRoomCode, 'UserId:', myUserId);
  if (currentRoomCode) {
    // We were in a room, let's rejoin automatically
    socket.emit('join-room', { code: currentRoomCode, userId: myUserId }, (res) => {
      if (res?.ok) {
        enterTheater(currentRoomCode); // Ensure UI jumps straight to theater
        if (res.size === 2) {
          setStatus('Both seats filled. Enjoy the show.', true);
        } else {
          setStatus("Your date's stepped into the lobby…", false);
        }
      } else {
        setStatus('Screening closed or locked. Please refresh.', false);
        currentRoomCode = null;
        sessionStorage.removeItem('tsos-room-code');
      }
    });
  }
});

function setStatus(text, connected) {
  statusEl.textContent = text;
  statusDot.classList.toggle('connected', !!connected);
}

// ---------------------------------------------------------------------------
// Local file loading using File System Access API (persists across refresh)
// ---------------------------------------------------------------------------

async function loadVideoFromHandle(handle) {
  try {
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
    
    // Restore time if we have it
    const savedTime = sessionStorage.getItem('tsos-video-time');
    if (savedTime) {
      video.currentTime = parseFloat(savedTime);
    }
    
    noFilePlaceholder.classList.add('hidden');
    fileNameEl.textContent = file.name;
    resumeFileBtn.classList.add('hidden');
    fileBtn.classList.remove('hidden');
    socket.emit('movie-info', { name: file.name });
  } catch (error) {
    // Usually means permission was not granted (e.g., page refresh)
    fileBtn.classList.add('hidden');
    resumeFileBtn.classList.remove('hidden');
    fileNameEl.textContent = `Movie saved. Click resume to watch.`;
  }
}

fileBtn.addEventListener('click', async () => {
  // If the modern file system API is available (only works on localhost or HTTPS)
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Video Files', accept: { 'video/*': ['.mp4', '.mkv', '.webm'] } }]
      });
      await saveFileHandle(handle);
      await loadVideoFromHandle(handle);
    } catch (err) {
      // User cancelled picking
    }
  } else {
    // Fallback for non-secure contexts (like IP address sharing over HTTP)
    fallbackFileInput.click();
  }
});

fallbackFileInput.addEventListener('change', () => {
  const file = fallbackFileInput.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();
  
  // Restore time if we have it
  const savedTime = sessionStorage.getItem('tsos-video-time');
  if (savedTime) {
    video.currentTime = parseFloat(savedTime);
  }
  
  noFilePlaceholder.classList.add('hidden');
  fileNameEl.textContent = file.name;
  resumeFileBtn.classList.add('hidden'); // Cannot persist without File System API
  socket.emit('movie-info', { name: file.name });
});

resumeFileBtn.addEventListener('click', async () => {
  const handle = await getFileHandle();
  if (handle) {
    await handle.requestPermission({ mode: 'read' });
    await loadVideoFromHandle(handle);
  }
});

// Check for saved file handle on load
if (window.showOpenFilePicker) {
  getFileHandle().then(handle => {
    if (handle) {
      loadVideoFromHandle(handle);
    }
  });
}

socket.on('movie-info', (info) => {
  setStatus(`Your date loaded "${info.name}" — make sure yours matches.`, true);
});

// ---------------------------------------------------------------------------
// Subtitle loading
// ---------------------------------------------------------------------------
subBtn.addEventListener('click', () => subInput.click());

subInput.addEventListener('change', async () => {
  const file = subInput.files[0];
  if (!file) return;

  const text = await file.text();
  let vttText = text;
  
  // Basic SRT to VTT converter (HTML5 video requires VTT format)
  if (file.name.toLowerCase().endsWith('.srt')) {
    vttText = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }

  const blob = new Blob([vttText], { type: 'text/vtt' });
  const url = URL.createObjectURL(blob);

  // Remove existing track if any
  const oldTrack = video.querySelector('track');
  if (oldTrack) {
    oldTrack.remove();
  }

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'Custom Subtitles';
  track.srclang = 'en';
  track.src = url;
  track.default = true;
  video.appendChild(track);
  
  // Update filename display
  const currentText = fileNameEl.textContent;
  if (!currentText.includes('| Subs:')) {
    fileNameEl.textContent = `${currentText} | Subs: ${file.name}`;
  } else {
    fileNameEl.textContent = currentText.replace(/\| Subs:.*$/, `| Subs: ${file.name}`);
  }
});

// ---------------------------------------------------------------------------
// Auto-Hiding Overlay Logic (Netflix Style)
// ---------------------------------------------------------------------------
let interactionTimer = null;

function wakeUpOverlay() {
  interactionOverlay.classList.remove('hide-ui');
  if (interactionTimer) clearTimeout(interactionTimer);
  
  // If the chat panel is currently OPEN, do not hide the UI!
  if (!chatPanel.classList.contains('hidden')) return;

  interactionTimer = setTimeout(() => {
    interactionOverlay.classList.add('hide-ui');
  }, 3000); // Hide after 3 seconds of inactivity
}

screenFrame.addEventListener('mousemove', wakeUpOverlay);
screenFrame.addEventListener('touchstart', wakeUpOverlay, {passive: true});

// ---------------------------------------------------------------------------
// Chat Logic & History
// ---------------------------------------------------------------------------
chatToggleBtn.addEventListener('click', () => {
  chatPanel.classList.toggle('hidden');
  if (!chatPanel.classList.contains('hidden')) {
    chatInput.focus();
    wakeUpOverlay(); // Keep UI awake when chat is open
  }
});

function showMessage(text, isMine) {
  // 1. Add to permanent Chat History Panel
  const histEl = document.createElement('div');
  histEl.className = `chat-msg-bubble ${isMine ? 'chat-msg-mine' : 'chat-msg-theirs'}`;
  histEl.textContent = text;
  chatHistory.appendChild(histEl);
  chatHistory.scrollTop = chatHistory.scrollHeight; // auto-scroll to bottom

  // 2. Show Ephemeral Floating Message (only for received messages, and ONLY if chat is closed)
  if (!isMine && chatPanel.classList.contains('hidden')) {
    const ephemEl = document.createElement('div');
    ephemEl.className = `chat-message`;
    ephemEl.textContent = text;
    chatEphemeral.appendChild(ephemEl);
    
    // Auto fade out
    setTimeout(() => {
      ephemEl.style.opacity = '0';
      setTimeout(() => ephemEl.remove(), 1000);
    }, 4000);
  }
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  
  showMessage(text, true);
  socket.emit('chat-message', text);
  chatInput.value = '';
}

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChat();
});
chatSendBtn.addEventListener('click', sendChat);

socket.on('chat-message', (text) => {
  showMessage(text, false);
});

// ---------------------------------------------------------------------------
// Visible Reactions
// ---------------------------------------------------------------------------
// Prevent Plyr from entering fullscreen when double-clicking reaction buttons
document.querySelector('.interaction-controls').addEventListener('dblclick', (e) => {
  e.stopPropagation();
});
document.querySelector('.interaction-controls').addEventListener('click', (e) => {
  e.stopPropagation(); // Also stop single click from pausing the video via Plyr
});

Object.entries(reactionBtns).forEach(([emoji, btn]) => {
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentRoomCode) return;
    socket.emit('reaction', emoji);
    spawnReaction(emoji);
  });
});

function spawnReaction(emoji, xPos = null) {
  const el = document.createElement('div');
  el.className = 'reaction-bubble';
  el.textContent = emoji;
  
  if (xPos === null) {
    xPos = Math.random() > 0.5 ? Math.random() * 20 + 5 : Math.random() * 20 + 75;
    el.style.left = `${xPos}%`;
  } else {
    const rect = screenFrame.getBoundingClientRect();
    let left = xPos - rect.left - 20;
    if (left < 10) left = 10;
    if (left > rect.width - 50) left = rect.width - 50;
    el.style.left = `${left}px`;
  }
  
  reactionsLayer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function triggerReaction(emoji) {
  // Spawn locally
  spawnReaction(emoji); 
  socket.emit('reaction', emoji);
}

socket.on('reaction', (emoji) => {
  spawnReaction(emoji);
});

// Removed broken fullscreen block.
// ---- Outgoing: user-driven playback events ----
video.addEventListener('play', () => {
  if (suppressEmit) return;
  socket.emit('sync-event', { action: 'play', time: video.currentTime });
});

video.addEventListener('pause', () => {
  if (suppressEmit) return;
  socket.emit('sync-event', { action: 'pause', time: video.currentTime });
});

video.addEventListener('seeked', () => {
  if (suppressEmit) return;
  if (Math.abs(video.currentTime - lastEmittedTime) < 0.05) return; // ignore no-op seeks
  lastEmittedTime = video.currentTime;
  socket.emit('sync-event', { action: 'seek', time: video.currentTime });
});

// ---- Incoming: apply the partner's action without echoing it back ----
socket.on('sync-event', ({ action, time }) => {
  if (typeof time !== 'number') return;

  applyRemote(() => {
    switch (action) {
      case 'play':
        if (Math.abs(video.currentTime - time) > SEEK_THRESHOLD_SEC) {
          video.currentTime = time;
        }
        video.play().catch(() => {
          // Autoplay can be blocked before the first user gesture on this
          // tab; the next local play/pause click will naturally resync.
        });
        break;

      case 'pause':
        if (Math.abs(video.currentTime - time) > SEEK_THRESHOLD_SEC) {
          video.currentTime = time;
        }
        video.pause();
        break;

      case 'seek':
        video.currentTime = time;
        lastEmittedTime = time;
        break;
    }
  });
});
