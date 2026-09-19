const socket = io();

let currentRoomCode = sessionStorage.getItem('tsos-room-code') || null;
let myUserId = sessionStorage.getItem('tsos-user-id');
if (!myUserId) {
  myUserId = Math.random().toString(36).substring(2, 10);
  sessionStorage.setItem('tsos-user-id', myUserId);
}
let myMovieName = null;
let partnerMovieName = null;

function normalizeName(filename) {
  if (!filename) return '';
  return filename.toLowerCase().replace(/\.[a-z0-9]+$/i, '');
}

// ---- DOM refs ----
const setupScreen = document.getElementById('setup-screen');
const theaterScreen = document.getElementById('theater-screen');
const createBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('ticket-token-input');
const joinError = document.getElementById('join-error');
const stubCodeEl = document.getElementById('stub-code');
const statusDot = document.getElementById('status-dot');
const statusEl = document.getElementById('status');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const video = document.getElementById('video');
const fileBtn = document.getElementById('file-btn');
const removeFileBtn = document.getElementById('remove-file-btn');
const fallbackFileInput = document.getElementById('fallback-file-input');
const resumeFileBtn = document.getElementById('resume-file-btn');
const subBtn = document.getElementById('sub-btn');
const subInput = document.getElementById('sub-input');
const removeSubBtn = document.getElementById('remove-sub-btn');
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
const forceSyncBtn = document.getElementById('force-sync-btn');
const syncDriftIndicator = document.getElementById('sync-drift-indicator');
const drawBtn = document.getElementById('draw-btn');
const drawingCanvas = document.getElementById('drawing-canvas');
const ctx = drawingCanvas.getContext('2d');
const reactionBtns = {
  '❤️': document.getElementById('reaction-heart-btn'),
  '😂': document.getElementById('reaction-laugh-btn'),
  '🍿': document.getElementById('reaction-popcorn-btn')
};

const reactionsLayer = document.getElementById('reactions-layer');
const orientationLockBtn = document.getElementById('orientation-lock-btn');
const orientationHud = document.getElementById('orientation-hud');
const orientationHudText = document.getElementById('orientation-hud-text');
const mobilePlayPauseBtn = document.getElementById('mobile-play-pause-btn');
const mobilePlayIcon = document.getElementById('mobile-play-icon');
const mobilePauseIcon = document.getElementById('mobile-pause-icon');

// Vertical Cinema Volume HUD elements
const volumeHud = document.getElementById('volume-hud');
const volumeHudLevel = document.getElementById('volume-hud-level');
const volumeHudTrack = document.getElementById('volume-hud-track');
const volumeHudFill = document.getElementById('volume-hud-fill');
const volumeHudIconBtn = document.getElementById('volume-hud-icon-btn');
const volumeHudIconHigh = document.getElementById('volume-hud-icon-high');
const volumeHudIconLow = document.getElementById('volume-hud-icon-low');
const volumeHudIconMute = document.getElementById('volume-hud-icon-mute');

// YouTube-style Double-Tap Seek elements
const seekOverlayLeft = document.getElementById('seek-overlay-left');
const seekOverlayRight = document.getElementById('seek-overlay-right');
const seekOverlayLeftText = document.getElementById('seek-overlay-left-text');
const seekOverlayRightText = document.getElementById('seek-overlay-right-text');

// Initialize Plyr
const player = new Plyr('#video', {
  captions: { active: true, update: true, language: 'en' },
  controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
  settings: ['captions', 'quality', 'speed'],
  keyboard: { focused: false, global: false },
});

player.on('ready', () => {
  // Move our custom overlays inside the Plyr wrapper so they stay visible in Fullscreen!
  const plyrContainer = document.querySelector('.plyr');
  const reactionsLayer = document.getElementById('reactions-layer');
  const chatEphemeral = document.getElementById('chat-ephemeral');
  const interactionOverlay = document.getElementById('interaction-overlay');
  const orientationHudEl = document.getElementById('orientation-hud');
  const mobileBtnEl = document.getElementById('mobile-play-pause-btn');
  const volumeHudEl = document.getElementById('volume-hud');
  const seekLeftEl = document.getElementById('seek-overlay-left');
  const seekRightEl = document.getElementById('seek-overlay-right');

  if (plyrContainer) {
    if (drawingCanvas) plyrContainer.appendChild(drawingCanvas); // Ensure canvas scales with player
    if (reactionsLayer) plyrContainer.appendChild(reactionsLayer);
    if (chatEphemeral) plyrContainer.appendChild(chatEphemeral);
    if (orientationHudEl) plyrContainer.appendChild(orientationHudEl);
    if (mobileBtnEl) plyrContainer.appendChild(mobileBtnEl);
    if (volumeHudEl) plyrContainer.appendChild(volumeHudEl);
    if (seekLeftEl) plyrContainer.appendChild(seekLeftEl);
    if (seekRightEl) plyrContainer.appendChild(seekRightEl);
    if (interactionOverlay) plyrContainer.appendChild(interactionOverlay);
  }
});

// Periodically save the current time to sessionStorage so it survives refreshes, and ping partner
setInterval(() => {
  if (video.readyState > 0) {
    sessionStorage.setItem('tsos-video-time', video.currentTime);
    if (currentRoomCode) {
      socket.emit('time-ping', video.currentTime);
    }
  }
}, 1000);

let driftTimer = null;
socket.on('time-ping', (partnerTime) => {
  if (video.readyState > 0) {
    const drift = Math.abs(video.currentTime - partnerTime);
    if (drift > 0.5) {
      document.getElementById('sync-drift-text').textContent = `Drift: ${drift.toFixed(1)}s`;
      syncDriftIndicator.classList.remove('hidden');

      clearTimeout(driftTimer);
      driftTimer = setTimeout(() => {
        syncDriftIndicator.classList.add('hidden');
      }, 3000);
    } else {
      syncDriftIndicator.classList.add('hidden');
    }
  }
});

if (forceSyncBtn) {
  forceSyncBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentRoomCode && video.readyState > 0) {
      socket.emit('sync-event', { action: 'seek', time: video.currentTime });
      if (!video.paused) {
        socket.emit('sync-event', { action: 'play', time: video.currentTime });
      } else {
        socket.emit('sync-event', { action: 'pause', time: video.currentTime });
      }
      syncDriftIndicator.classList.add('hidden');
      spawnReaction('🔄');
    }
  });
}

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

async function saveSubtitles(text, name) {
  const db = await getDB();
  db.transaction(storeName, 'readwrite').objectStore(storeName).put({ text, name }, 'subs');
}

async function getSubtitles() {
  const db = await getDB();
  return new Promise(resolve => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get('subs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function removeSavedFiles() {
  const db = await getDB();
  db.transaction(storeName, 'readwrite').objectStore(storeName).delete('movie');
  db.transaction(storeName, 'readwrite').objectStore(storeName).delete('subs');
}

async function removeSavedSubtitles() {
  const db = await getDB();
  db.transaction(storeName, 'readwrite').objectStore(storeName).delete('subs');
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

  // Request mic permission for Walkie-Talkie in background
  initWebRTC();
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
  if (activeSeats === 2) {
    setStatus('Both seats filled. Enjoy the show.', true);
    playSound('join');
  }
});
socket.on('partner-left', () => {
  setStatus("Your date's stepped into the lobby…", false);
  playSound('leave');
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
// Local file loading & Queue Management
// ---------------------------------------------------------------------------
let movieQueue = []; // Array of file handles or file objects
let currentQueueIndex = 0;

const queueToggleBtn = document.getElementById('queue-toggle-btn');
const queuePanel = document.getElementById('queue-panel');
const queueCloseBtn = document.getElementById('queue-close-btn');
const queueList = document.getElementById('queue-list');

if (queueToggleBtn) queueToggleBtn.addEventListener('click', () => queuePanel.classList.toggle('hidden'));
if (queueCloseBtn) queueCloseBtn.addEventListener('click', () => queuePanel.classList.add('hidden'));

async function saveQueueState() {
  const db = await getDB();
  db.transaction(storeName, 'readwrite').objectStore(storeName).put({ queue: movieQueue, index: currentQueueIndex }, 'movie');
}

function renderQueueUI() {
  if (!queueList) return;
  queueList.innerHTML = '';
  movieQueue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'queue-item' + (index === currentQueueIndex ? ' active-item' : '');
    li.draggable = true;
    li.dataset.index = index;

    const nameEl = document.createElement('span');
    nameEl.className = 'queue-item-name';
    nameEl.textContent = item.name;
    nameEl.title = 'Click to play';
    nameEl.onclick = async () => {
      if (currentQueueIndex !== index) {
        currentQueueIndex = index;
        await saveQueueState();
        renderQueueUI();
        await loadVideoFromQueue();
      }
    };

    const handleEl = document.createElement('span');
    handleEl.className = 'queue-item-drag-handle';
    handleEl.textContent = '☰';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'queue-item-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove movie';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeQueueItem(index);
    };

    li.appendChild(nameEl);
    li.appendChild(removeBtn);
    li.appendChild(handleEl);

    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragenter', handleDragEnter);
    li.addEventListener('dragleave', handleDragLeave);

    queueList.appendChild(li);
  });

  if (movieQueue.length > 1 && queueToggleBtn) {
    queueToggleBtn.classList.remove('hidden');
    queueToggleBtn.textContent = `Queue (${currentQueueIndex + 1}/${movieQueue.length})`;
  } else if (movieQueue.length <= 1 && queueToggleBtn) {
    queueToggleBtn.classList.add('hidden');
  }
}

async function removeQueueItem(index) {
  movieQueue.splice(index, 1);

  if (movieQueue.length === 0) {
    // Queue is empty, reset player
    video.pause();
    video.removeAttribute('src');
    video.load();
    await removeSavedFiles();
    sessionStorage.removeItem('tsos-video-time');

    const oldTrack = video.querySelector('track');
    if (oldTrack) oldTrack.remove();

    currentQueueIndex = 0;
    myMovieName = null;
    if (queuePanel) queuePanel.classList.add('hidden');
    if (queueToggleBtn) queueToggleBtn.classList.add('hidden');

    noFilePlaceholder.classList.remove('hidden');
    fileNameEl.textContent = "No file selected on this laptop yet.";
    resumeFileBtn.classList.add('hidden');

    socket.emit('movie-info', { name: "No file selected" });
  } else {
    // If we removed the currently playing item
    if (index === currentQueueIndex) {
      if (currentQueueIndex >= movieQueue.length) {
        currentQueueIndex = Math.max(0, movieQueue.length - 1);
      }
      await loadVideoFromQueue(false);
    }
    // If we removed an item before the currently playing item
    else if (index < currentQueueIndex) {
      currentQueueIndex--;
    }
    await saveQueueState();

    if (movieQueue.length > 1 && queueToggleBtn) {
      queueToggleBtn.textContent = `Queue (${currentQueueIndex + 1}/${movieQueue.length})`;
    } else if (movieQueue.length <= 1 && queueToggleBtn) {
      queueToggleBtn.classList.add('hidden');
    }
  }
  renderQueueUI();
}

function updateQueueUIAfterLoad() {
  if (!queueList) return;
  const items = queueList.querySelectorAll('.queue-item');
  items.forEach((item, index) => {
    if (index === currentQueueIndex) {
      item.classList.add('active-item');
    } else {
      item.classList.remove('active-item');
    }
  });
}

let draggedItemIndex = null;
function handleDragStart(e) {
  draggedItemIndex = parseInt(e.currentTarget.dataset.index);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget.classList.add('dragging'), 0);
}
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function handleDragEnter(e) {
  e.preventDefault();
  const li = e.currentTarget;
  if (parseInt(li.dataset.index) !== draggedItemIndex) {
    li.classList.add('drag-over');
  }
}
function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function handleDrop(e) {
  e.stopPropagation();
  const li = e.currentTarget;
  li.classList.remove('drag-over');
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging'));

  const targetIndex = parseInt(li.dataset.index);
  if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
    const draggedItem = movieQueue.splice(draggedItemIndex, 1)[0];
    movieQueue.splice(targetIndex, 0, draggedItem);

    if (currentQueueIndex === draggedItemIndex) {
      currentQueueIndex = targetIndex;
    } else if (draggedItemIndex < currentQueueIndex && targetIndex >= currentQueueIndex) {
      currentQueueIndex--;
    } else if (draggedItemIndex > currentQueueIndex && targetIndex <= currentQueueIndex) {
      currentQueueIndex++;
    }

    saveQueueState();
    renderQueueUI();

    if (movieQueue.length > 1 && queueToggleBtn) {
      queueToggleBtn.textContent = `Queue (${currentQueueIndex + 1}/${movieQueue.length})`;
    }
  }
}

async function loadVideoFromQueue(isResume = false) {
  if (movieQueue.length === 0 || currentQueueIndex >= movieQueue.length) return;

  const item = movieQueue[currentQueueIndex];
  let file;
  try {
    if (item.getFile) {
      file = await item.getFile();
    } else {
      file = item;
    }

    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();

    if (isResume) {
      const savedTime = sessionStorage.getItem('tsos-video-time');
      if (savedTime) {
        video.currentTime = parseFloat(savedTime);
      }
    } else {
      sessionStorage.setItem('tsos-video-time', '0');
    }

    noFilePlaceholder.classList.add('hidden');
    fileNameEl.textContent = file.name;
    resumeFileBtn.classList.add('hidden');
    // We intentionally do NOT hide fileBtn anymore, so users can keep appending to queue

    if (movieQueue.length > 1 && queueToggleBtn) {
      queueToggleBtn.classList.remove('hidden');
      queueToggleBtn.textContent = `Queue (${currentQueueIndex + 1}/${movieQueue.length})`;
    } else if (queueToggleBtn) {
      queueToggleBtn.classList.add('hidden');
    }

    myMovieName = file.name;
    socket.emit('movie-info', { name: file.name });
    updateQueueUIAfterLoad();

    if (!isResume && currentQueueIndex > 0) {
      video.play().catch(() => { });
    }
  } catch (error) {
    resumeFileBtn.classList.remove('hidden');
    fileNameEl.textContent = `Movie saved. Click resume to watch.`;
    if (queueToggleBtn) queueToggleBtn.classList.add('hidden');
  }
}

fileBtn.addEventListener('click', async () => {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Video Files', accept: { 'video/*': ['.mp4', '.mkv', '.webm'] } }]
      });
      movieQueue.push(...handles);
      // We do not reset currentQueueIndex to 0 here unless queue was empty
      if (movieQueue.length === handles.length) {
        currentQueueIndex = 0;
        await loadVideoFromQueue();
      }
      await saveQueueState();
      renderQueueUI();
    } catch (err) {
      // User cancelled picking
    }
  } else {
    fallbackFileInput.click();
  }
});

fallbackFileInput.addEventListener('change', () => {
  const files = Array.from(fallbackFileInput.files);
  if (files.length > 0) {
    const wasEmpty = (movieQueue.length === 0);
    movieQueue.push(...files);
    if (wasEmpty) {
      currentQueueIndex = 0;
      loadVideoFromQueue();
    }
    renderQueueUI();
  }
});

video.addEventListener('ended', () => {
  if (currentQueueIndex < movieQueue.length - 1) {
    currentQueueIndex++;
    saveQueueState();
    loadVideoFromQueue(false);
  }
});

// Old removeFileBtn listener deleted

resumeFileBtn.addEventListener('click', async () => {
  if (movieQueue.length > 0 && movieQueue[currentQueueIndex].requestPermission) {
    await movieQueue[currentQueueIndex].requestPermission({ mode: 'read' });
    await loadVideoFromQueue(true);
  }
});

async function initSessionPersistence() {
  if (!sessionStorage.getItem('tsos-active-session')) {
    await removeSavedFiles();
    sessionStorage.setItem('tsos-active-session', 'true');
  }

  if (window.showOpenFilePicker) {
    getFileHandle().then(state => {
      if (state) {
        if (state.queue) {
          movieQueue = state.queue;
          currentQueueIndex = state.index || 0;
        } else {
          movieQueue = [state]; // Legacy fallback
          currentQueueIndex = 0;
        }
        renderQueueUI();
        loadVideoFromQueue(true);
      }
    });
  }

  // Check for saved subtitles on load (survives refresh)
  getSubtitles().then(subs => {
    if (subs) {
      applySubtitleTrack(subs.text, subs.name);
    }
  });
}

initSessionPersistence();

socket.on('movie-info', async (info) => {
  if (info.name === "No file selected") {
    partnerMovieName = null;
    setStatus("Your date removed their movie.", false);
    return;
  }

  partnerMovieName = info.name;

  if (myMovieName && normalizeName(myMovieName) !== normalizeName(partnerMovieName)) {
    const matchIndex = movieQueue.findIndex(item => normalizeName(item.name) === normalizeName(partnerMovieName));
    if (matchIndex !== -1 && matchIndex !== currentQueueIndex) {
      currentQueueIndex = matchIndex;
      await saveQueueState();
      renderQueueUI();
      await loadVideoFromQueue(false);
      setStatus("Auto-switched to match your date.", true);
    } else {
      video.pause();
      setStatus(`Your date selected "${info.name}". Please load this file to continue.`, false);
    }
  } else {
    setStatus(`Your date loaded "${info.name}".`, true);
  }
});

// ---------------------------------------------------------------------------
// Subtitle loading
// ---------------------------------------------------------------------------
subBtn.addEventListener('click', () => subInput.click());

function applySubtitleTrack(vttText, fileName) {
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
    fileNameEl.textContent = `${currentText} | Subs: ${fileName}`;
  } else {
    fileNameEl.textContent = currentText.replace(/\| Subs:.*$/, `| Subs: ${fileName}`);
  }

  removeSubBtn.classList.remove('hidden');
}

subInput.addEventListener('change', async () => {
  const file = subInput.files[0];
  if (!file) return;

  const text = await file.text();
  let vttText = text;

  // Basic SRT to VTT converter (HTML5 video requires VTT format)
  if (file.name.toLowerCase().endsWith('.srt')) {
    vttText = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }

  applySubtitleTrack(vttText, file.name);
  saveSubtitles(vttText, file.name); // Persist to IndexedDB
});

removeSubBtn.addEventListener('click', async () => {
  const oldTrack = video.querySelector('track');
  if (oldTrack) oldTrack.remove();

  await removeSavedSubtitles();

  // Clean up filename display
  const currentText = fileNameEl.textContent;
  fileNameEl.textContent = currentText.replace(/ \| Subs:.*$/, '');

  removeSubBtn.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Auto-Hiding Overlay Logic (Netflix Style)
// ---------------------------------------------------------------------------
let interactionTimer = null;

function wakeUpOverlay() {
  interactionOverlay.classList.remove('hide-ui');
  if (mobilePlayPauseBtn) mobilePlayPauseBtn.classList.remove('hidden');
  if (interactionTimer) clearTimeout(interactionTimer);

  // If the chat panel is currently OPEN, or video is paused, do not hide the UI!
  if (!chatPanel.classList.contains('hidden') || !video || video.paused) return;

  interactionTimer = setTimeout(() => {
    interactionOverlay.classList.add('hide-ui');
    if (mobilePlayPauseBtn && !video.paused) {
      mobilePlayPauseBtn.classList.add('hidden');
    }
  }, 3000); // Hide after 3 seconds of inactivity
}

screenFrame.addEventListener('mousemove', wakeUpOverlay);
screenFrame.addEventListener('touchstart', wakeUpOverlay, { passive: true });

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
  if (myMovieName && partnerMovieName && normalizeName(myMovieName) !== normalizeName(partnerMovieName)) {
    video.pause();
    setStatus('Cannot play: Mismatched files. Please load the correct file.', false);
    return;
  }
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
        if (myMovieName && partnerMovieName && normalizeName(myMovieName) !== normalizeName(partnerMovieName)) {
          return; // Ignore incoming play if mismatched
        }
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

// ---------------------------------------------------------------------------
// REAL-TIME WEBRTC WALKIE-TALKIE
// ---------------------------------------------------------------------------
let peerConnection;
let localStream;
let localAudioTrack;

const walkieBtn = document.getElementById('walkie-btn');
const walkieAudio = document.getElementById('walkie-audio');

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function initWebRTC() {
  if (peerConnection) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localAudioTrack = localStream.getAudioTracks()[0];
    localAudioTrack.enabled = false; // MUTED BY DEFAULT

    peerConnection = new RTCPeerConnection(iceServers);

    // Add local track
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Handle incoming track
    peerConnection.ontrack = event => {
      walkieAudio.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', event.candidate);
      }
    };
  } catch (err) {
    console.error("Microphone access denied or error:", err);
  }
}

async function createOffer() {
  if (!peerConnection) await initWebRTC();
  if (peerConnection.signalingState !== 'stable') return;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('webrtc-offer', offer);
}

socket.on('partner-joined', async () => {
  // We are the host, start the call
  await createOffer();
});

socket.on('webrtc-offer', async (offer) => {
  if (!peerConnection) await initWebRTC();
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('webrtc-answer', answer);
});

socket.on('webrtc-answer', async (answer) => {
  if (peerConnection) {
    await peerConnection.setRemoteDescription(answer);
  }
});

socket.on('webrtc-ice-candidate', async (candidate) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(candidate);
  }
});

// Mic Toggle bindings
let isMicOn = false;

function toggleMic(e) {
  e.preventDefault(); // Prevent touch text selection

  if (!localAudioTrack) {
    // If permission wasn't granted yet, try again
    initWebRTC().then(() => {
      if (localAudioTrack) {
        createOffer(); // Re-sync if late
        setMicState(true);
      }
    });
    return;
  }

  setMicState(!isMicOn);
}

function setMicState(state) {
  isMicOn = state;
  if (localAudioTrack) {
    localAudioTrack.enabled = isMicOn;
  }

  if (isMicOn) {
    walkieBtn.classList.add('recording');
    walkieBtn.classList.remove('mic-off');
  } else {
    walkieBtn.classList.remove('recording');
    walkieBtn.classList.add('mic-off');
  }
}

// Initial state
walkieBtn.classList.add('mic-off');
walkieBtn.addEventListener('click', toggleMic);

// ---------------------------------------------------------------------------
// AUDIO EFFECTS
// ---------------------------------------------------------------------------
let audioCtx = null;
function playSound(type) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'join') {
      // Pleasant ascending chime
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } else if (type === 'leave') {
      // Soft descending tone
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(329.63, audioCtx.currentTime); // E4
      oscillator.frequency.exponentialRampToValueAtTime(261.63, audioCtx.currentTime + 0.2); // C4
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    }
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

// ---------------------------------------------------------------------------
// EPHEMERAL DRAWING OVERLAY
// ---------------------------------------------------------------------------
let isDrawingMode = false;
let isDrawing = false;
let lastDrawPos = null;
let drawnSegments = [];
let lastDrawActivity = Date.now();

const DRAW_COLOR = '#F43F5E'; // Glowing Red
const IDLE_TIMEOUT = 3000; // 3 seconds of idle time before fading starts
const FADE_OUT_TIME = 1000; // 1 second to actually fade out completely

function pokeDrawing() {
  lastDrawActivity = Date.now();
}

// Auto-resize canvas to always match player size (crucial for fullscreen)
const resizeObserver = new ResizeObserver(entries => {
  for (let entry of entries) {
    if (drawingCanvas) {
      drawingCanvas.width = entry.contentRect.width;
      drawingCanvas.height = entry.contentRect.height;
    }
  }
});
if (drawingCanvas) resizeObserver.observe(drawingCanvas);

if (drawBtn) {
  drawBtn.addEventListener('click', () => {
    isDrawingMode = !isDrawingMode;
    if (isDrawingMode) {
      drawBtn.classList.add('draw-active');
      drawingCanvas.classList.add('active');
    } else {
      drawBtn.classList.remove('draw-active');
      drawingCanvas.classList.remove('active');
    }
  });
}

function getCanvasPos(e) {
  const rect = drawingCanvas.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  // Return normalized coordinates (0 to 1) so it works across different screen sizes
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height
  };
}

function handleDrawStart(e) {
  if (!isDrawingMode) return;
  e.preventDefault(); // Stop text selection/scrolling
  isDrawing = true;
  lastDrawPos = getCanvasPos(e);
  pokeDrawing();
}

function handleDrawMove(e) {
  if (!isDrawing || !isDrawingMode) return;
  e.preventDefault();
  const currentPos = getCanvasPos(e);

  if (lastDrawPos) {
    const segment = { p1: lastDrawPos, p2: currentPos, color: DRAW_COLOR };
    drawnSegments.push(segment);
    socket.emit('draw-segment', segment);
    pokeDrawing();
  }
  lastDrawPos = currentPos;
}

function handleDrawEnd(e) {
  if (!isDrawingMode || !isDrawing) return;
  isDrawing = false;
  lastDrawPos = null;
  pokeDrawing();
}

if (drawingCanvas) {
  drawingCanvas.addEventListener('mousedown', handleDrawStart);
  drawingCanvas.addEventListener('mousemove', handleDrawMove);
  drawingCanvas.addEventListener('mouseup', handleDrawEnd);
  drawingCanvas.addEventListener('mouseleave', handleDrawEnd);
  drawingCanvas.addEventListener('touchstart', handleDrawStart, { passive: false });
  drawingCanvas.addEventListener('touchmove', handleDrawMove, { passive: false });
  drawingCanvas.addEventListener('touchend', handleDrawEnd);
}

socket.on('draw-segment', (segment) => {
  drawnSegments.push(segment);
  pokeDrawing();
});

// Render Loop for Ephemeral Fading
function renderDrawings() {
  if (!ctx || !drawingCanvas) return;
  const now = Date.now();
  ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

  const idleTime = now - lastDrawActivity;

  if (idleTime > IDLE_TIMEOUT + FADE_OUT_TIME) {
    drawnSegments = [];
    requestAnimationFrame(renderDrawings);
    return;
  }

  let alpha = 1.0;
  if (idleTime > IDLE_TIMEOUT) {
    alpha = Math.max(0, 1.0 - ((idleTime - IDLE_TIMEOUT) / FADE_OUT_TIME));
  }

  if (drawnSegments.length > 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;

    ctx.shadowColor = DRAW_COLOR;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = alpha;

    drawnSegments.forEach(seg => {
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.moveTo(seg.p1.x * drawingCanvas.width, seg.p1.y * drawingCanvas.height);
      ctx.lineTo(seg.p2.x * drawingCanvas.width, seg.p2.y * drawingCanvas.height);
      ctx.stroke();
    });

    // Reset context states
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
  }

  requestAnimationFrame(renderDrawings);
}

if (drawingCanvas) {
  requestAnimationFrame(renderDrawings);
}

// ---------------------------------------------------------------------------
// MOBILE ORIENTATION LOCK & MOBILE TOUCH PLAY/PAUSE
// ---------------------------------------------------------------------------
let isOrientationLocked = false;
let orientationToastTimer = null;

function showOrientationToast(message) {
  if (!orientationHud || !orientationHudText) return;
  orientationHudText.textContent = message;
  orientationHud.classList.remove('hidden');
  clearTimeout(orientationToastTimer);
  orientationToastTimer = setTimeout(() => {
    orientationHud.classList.add('hidden');
  }, 2500);
}

async function setOrientationLock(locked) {
  isOrientationLocked = locked;

  if (orientationLockBtn) {
    if (locked) {
      orientationLockBtn.classList.add('lock-active');
      orientationLockBtn.setAttribute('title', 'Unlock Orientation (Auto)');
    } else {
      orientationLockBtn.classList.remove('lock-active');
      orientationLockBtn.setAttribute('title', 'Lock Orientation (Landscape)');
    }
  }

  if (locked) {
    // 1. Hardware/Browser Screen Orientation API (Android Chrome, Firefox, Opera)
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      try {
        await screen.orientation.lock('landscape');
      } catch (err) {
        console.log('Screen orientation lock without fullscreen failed or unsupported:', err);
      }
    }

    // 2. CSS Cinema Landscape Rotation Fallback (for iOS Safari and system-portrait-locked devices)
    document.body.classList.add('lock-landscape');
    showOrientationToast('📱 Locked to Landscape');
  } else {
    // 1. Release Screen Orientation API lock
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      try {
        screen.orientation.unlock();
      } catch (err) {}
    }

    // 2. Remove CSS rotation
    document.body.classList.remove('lock-landscape');
    showOrientationToast('🔓 Orientation: Auto');
  }

  // Synchronize Plyr fullscreen button icon state with orientation lock
  const fsBtn = document.querySelector('[data-plyr="fullscreen"]');
  if (fsBtn) {
    if (locked) {
      fsBtn.classList.add('plyr__control--pressed');
      fsBtn.setAttribute('aria-pressed', 'true');
    } else {
      fsBtn.classList.remove('plyr__control--pressed');
      fsBtn.setAttribute('aria-pressed', 'false');
    }
  }

  // Trigger resize event so Plyr and canvas recompute dimensions cleanly
  window.dispatchEvent(new Event('resize'));
}

function toggleOrientationLock() {
  setOrientationLock(!isOrientationLocked);
}

if (orientationLockBtn) {
  orientationLockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOrientationLock();
  });
}

// Automatically lock orientation to landscape on mobile fullscreen entry
player.on('enterfullscreen', () => {
  if (window.innerWidth <= 768) {
    setOrientationLock(true);
  }
});

player.on('exitfullscreen', () => {
  if (window.innerWidth <= 768) {
    setOrientationLock(false);
  }
});

// Intercept Fullscreen Button on mobile view to directly switch into Landscape Cinema Mode
let lastFsTapTime = 0;
function handleMobileFullscreenClick(e) {
  const fsBtn = e.target.closest('[data-plyr="fullscreen"]');
  if (fsBtn && window.innerWidth <= 768) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const now = Date.now();
    if (now - lastFsTapTime > 400) {
      lastFsTapTime = now;
      toggleOrientationLock();
    }
  }
}

document.addEventListener('click', handleMobileFullscreenClick, true);
document.addEventListener('touchend', handleMobileFullscreenClick, true);

// Sync Mobile Play/Pause Icon with Video Playback State
function updateMobilePlayPauseBtn() {
  if (!mobilePlayIcon || !mobilePauseIcon) return;
  if (video.paused) {
    mobilePlayIcon.classList.remove('hidden');
    mobilePauseIcon.classList.add('hidden');
    if (mobilePlayPauseBtn) mobilePlayPauseBtn.classList.remove('hidden');
  } else {
    mobilePlayIcon.classList.add('hidden');
    mobilePauseIcon.classList.remove('hidden');
  }
}

video.addEventListener('play', updateMobilePlayPauseBtn);
video.addEventListener('pause', updateMobilePlayPauseBtn);

if (mobilePlayPauseBtn) {
  mobilePlayPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}

// ---------------------------------------------------------------------------
// VERTICAL CINEMA VOLUME HUD CONTROLLER & GESTURES
// ---------------------------------------------------------------------------
let volumeHudTimer = null;
let lastNonZeroVolume = 1.0;

function updateVolumeHud(show = true) {
  if (!volumeHud || !volumeHudLevel || !volumeHudFill) return;

  const isMuted = player.muted || player.volume === 0;
  const currentVol = isMuted ? 0 : player.volume;
  const percentage = Math.round(currentVol * 100);

  volumeHudLevel.textContent = `${percentage}%`;
  volumeHudFill.style.height = `${percentage}%`;

  if (isMuted || percentage === 0) {
    volumeHudIconHigh?.classList.add('hidden');
    volumeHudIconLow?.classList.add('hidden');
    volumeHudIconMute?.classList.remove('hidden');
  } else if (percentage < 50) {
    volumeHudIconHigh?.classList.add('hidden');
    volumeHudIconLow?.classList.remove('hidden');
    volumeHudIconMute?.classList.add('hidden');
  } else {
    volumeHudIconHigh?.classList.remove('hidden');
    volumeHudIconLow?.classList.add('hidden');
    volumeHudIconMute?.classList.add('hidden');
  }

  if (player.volume > 0 && !player.muted) {
    lastNonZeroVolume = player.volume;
  }

  if (show) {
    volumeHud.classList.add('visible');
    clearTimeout(volumeHudTimer);
    volumeHudTimer = setTimeout(() => {
      volumeHud.classList.remove('visible');
    }, 1800);
  }
}

function adjustVolume(delta) {
  if ((player.muted || video.muted) && delta > 0) {
    player.muted = false;
    video.muted = false;
  }
  const currentVol = (player.muted || video.muted) ? 0 : (player.volume ?? video.volume ?? 1);
  let newVol = Math.round((currentVol + delta) * 100) / 100;
  newVol = Math.max(0, Math.min(1, newVol));
  if (newVol === 0) {
    player.muted = true;
    video.muted = true;
  } else {
    player.muted = false;
    video.muted = false;
    lastNonZeroVolume = newVol;
  }
  player.volume = newVol;
  video.volume = newVol;
  updateVolumeHud(true);
}

function toggleMuteVolume() {
  const currentlyMuted = player.muted || video.muted || player.volume === 0 || video.volume === 0;
  if (currentlyMuted) {
    const restoreVol = lastNonZeroVolume || 1.0;
    player.muted = false;
    video.muted = false;
    player.volume = restoreVol;
    video.volume = restoreVol;
  } else {
    if (player.volume > 0) {
      lastNonZeroVolume = player.volume;
    } else if (video.volume > 0) {
      lastNonZeroVolume = video.volume;
    }
    player.muted = true;
    video.muted = true;
  }
  updateVolumeHud(true);
}

// React to Plyr and Video native volume changes
player.on('volumechange', () => {
  updateVolumeHud(true);
});
video.addEventListener('volumechange', () => {
  updateVolumeHud(true);
});

function toggleVideoPlayback() {
  if (!video) return;
  if (!video.src && !video.currentSrc) return;
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  wakeUpOverlay();
}

function isFullScreen() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    (player && player.fullscreen && player.fullscreen.active)
  );
}

function toggleFullScreen() {
  if (isFullScreen()) {
    // Exit full-screen (back from full-screen)
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        if (player && player.fullscreen && typeof player.fullscreen.exit === 'function') {
          player.fullscreen.exit();
        }
      });
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    } else if (player && player.fullscreen && typeof player.fullscreen.exit === 'function') {
      player.fullscreen.exit();
    }
  } else {
    // Enter full-screen
    if (player && player.fullscreen && typeof player.fullscreen.enter === 'function') {
      try {
        player.fullscreen.enter();
      } catch (err) {
        const plyrEl = document.querySelector('.plyr') || screenFrame;
        if (plyrEl && plyrEl.requestFullscreen) {
          plyrEl.requestFullscreen().catch(() => {});
        } else if (plyrEl && plyrEl.webkitRequestFullscreen) {
          plyrEl.webkitRequestFullscreen();
        }
      }
    } else {
      const plyrEl = document.querySelector('.plyr') || screenFrame;
      if (plyrEl && plyrEl.requestFullscreen) {
        plyrEl.requestFullscreen().catch(() => {});
      } else if (plyrEl && plyrEl.webkitRequestFullscreen) {
        plyrEl.webkitRequestFullscreen();
      }
    }
  }
  wakeUpOverlay();
}

// 1. Keyboard Shortcuts (Space: Play/Pause, F: Fullscreen Toggle, ArrowUp / ArrowDown: Volume, ArrowLeft / ArrowRight: Seek, M: Mute)
window.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  const activeTag = activeEl ? activeEl.tagName.toLowerCase() : '';
  if (activeTag === 'input' || activeTag === 'textarea' || activeEl?.isContentEditable) {
    return;
  }

  // Only active when inside theater screen
  if (theaterScreen && theaterScreen.classList.contains('hidden')) {
    return;
  }

  const isSpaceKey = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
  const isFKey = ((e.key === 'f' || e.key === 'F' || e.code === 'KeyF') && !e.ctrlKey && !e.metaKey && !e.altKey);
  const isMKey = ((e.key === 'm' || e.key === 'M' || e.code === 'KeyM') && !e.ctrlKey && !e.metaKey && !e.altKey);

  if (isSpaceKey) {
    // Intercept space completely so it ONLY toggles play/pause:
    // 1. Prevents page from scrolling down
    // 2. Prevents any focused button (reactions, leave room, file, etc.) from being activated
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (activeEl && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }

    toggleVideoPlayback();
  } else if (isFKey) {
    // Full-screen and back from that
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (activeEl && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }

    toggleFullScreen();
  } else if (isMKey) {
    // Mute and unmute toggle
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (activeEl && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }

    toggleMuteVolume();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    adjustVolume(0.05);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    adjustVolume(-0.05);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    performSeek(-10);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    performSeek(10);
  }
}, true);

// Prevent keyup default on Space, F, and M so buttons don't fire on key release
window.addEventListener('keyup', (e) => {
  const isSpaceKey = (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32);
  const isFKey = ((e.key === 'f' || e.key === 'F' || e.code === 'KeyF') && !e.ctrlKey && !e.metaKey && !e.altKey);
  const isMKey = ((e.key === 'm' || e.key === 'M' || e.code === 'KeyM') && !e.ctrlKey && !e.metaKey && !e.altKey);
  if (isSpaceKey || isFKey || isMKey) {
    const activeEl = document.activeElement;
    const activeTag = activeEl ? activeEl.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeEl?.isContentEditable) {
      return;
    }
    if (theaterScreen && theaterScreen.classList.contains('hidden')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
}, true);

// Blur buttons automatically after mouse/touch clicks so they don't hold keyboard focus
document.addEventListener('mouseup', (e) => {
  const btn = e.target.closest('button, [role="button"]');
  if (btn) {
    btn.blur();
  }
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, [role="button"]');
  if (btn) {
    btn.blur();
  }
});

const screenFrameEl = document.querySelector('.screen-frame');

// 2. Direct HUD Click & Drag
if (volumeHudIconBtn) {
  volumeHudIconBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMuteVolume();
  });
}

function setVolumeFromTrack(clientY) {
  if (!volumeHudTrack) return;
  const rect = volumeHudTrack.getBoundingClientRect();
  const offsetY = rect.bottom - clientY;
  let ratio = offsetY / rect.height;
  ratio = Math.max(0, Math.min(1, ratio));
  player.muted = (ratio === 0);
  player.volume = Math.round(ratio * 100) / 100;
  updateVolumeHud(true);
}

let isDraggingVolumeTrack = false;
if (volumeHudTrack) {
  volumeHudTrack.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDraggingVolumeTrack = true;
    setVolumeFromTrack(e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingVolumeTrack) {
      setVolumeFromTrack(e.clientY);
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingVolumeTrack = false;
  });

  volumeHudTrack.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      setVolumeFromTrack(e.touches[0].clientY);
    }
  }, { passive: true });

  volumeHudTrack.addEventListener('touchmove', (e) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      setVolumeFromTrack(e.touches[0].clientY);
    }
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// YOUTUBE-STYLE DOUBLE-TAP & ARROW KEY SEEK CONTROLLER (+10s / -10s)
// ---------------------------------------------------------------------------
let seekHudTimer = null;
let accumulatedSeekSeconds = 0;
let lastSeekDirection = null;

function performSeek(seconds) {
  const current = video ? video.currentTime : 0;
  const duration = video && video.duration && !isNaN(video.duration) ? video.duration : null;
  const targetTime = duration ? Math.max(0, Math.min(duration, current + seconds)) : Math.max(0, current + seconds);

  if (video) {
    video.currentTime = targetTime;
  }

  const direction = seconds > 0 ? 'right' : 'left';

  if (lastSeekDirection === direction && seekHudTimer) {
    accumulatedSeekSeconds += Math.abs(seconds);
  } else {
    accumulatedSeekSeconds = Math.abs(seconds);
  }
  lastSeekDirection = direction;

  const overlay = direction === 'right' ? seekOverlayRight : seekOverlayLeft;
  const textEl = direction === 'right' ? seekOverlayRightText : seekOverlayLeftText;
  const otherOverlay = direction === 'right' ? seekOverlayLeft : seekOverlayRight;

  if (otherOverlay) {
    otherOverlay.classList.remove('visible', 'yt-seek-pulse');
  }

  if (overlay && textEl) {
    textEl.textContent = `${accumulatedSeekSeconds}s`;
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');

    // Trigger micro-animation
    overlay.classList.remove('yt-seek-pulse');
    void overlay.offsetWidth; // force reflow
    overlay.classList.add('yt-seek-pulse');

    clearTimeout(seekHudTimer);
    seekHudTimer = setTimeout(() => {
      overlay.classList.remove('visible', 'yt-seek-pulse');
      seekHudTimer = null;
      lastSeekDirection = null;
      accumulatedSeekSeconds = 0;
    }, 750);
  }
}

// Desktop Double-Click on Left (-10s) or Right (+10s)
if (screenFrameEl) {
  screenFrameEl.addEventListener('dblclick', (e) => {
    // Stop Plyr from toggling fullscreen on double-click
    e.preventDefault();
    e.stopPropagation();

    if (e.target.closest('button, input, textarea, .icon-btn, .plyr__controls, .chat-panel, .queue-panel, .volume-hud')) {
      return;
    }

    const rect = screenFrameEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;

    if (relX < rect.width * 0.5) {
      performSeek(-10);
    } else {
      performSeek(10);
    }
  });
}

// Mobile Double-Tap on Left (-10s) or Right (+10s)
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
let isTouchDragging = false;

if (screenFrameEl) {
  screenFrameEl.addEventListener('touchstart', (e) => {
    isTouchDragging = false;
  }, { passive: true });

  screenFrameEl.addEventListener('touchmove', (e) => {
    isTouchDragging = true;
  }, { passive: true });

  screenFrameEl.addEventListener('touchend', (e) => {
    if (typeof isDrawingMode !== 'undefined' && isDrawingMode) return;
    if (isTouchDragging) return;
    if (e.target.closest('button, input, textarea, .icon-btn, .plyr__controls, .chat-panel, .queue-panel, .mobile-play-pause-btn, .volume-hud')) {
      return;
    }

    const changedTouch = e.changedTouches ? e.changedTouches[0] : null;
    if (!changedTouch) return;

    const now = Date.now();
    const tapX = changedTouch.clientX;
    const tapY = changedTouch.clientY;
    const timeDiff = now - lastTapTime;
    const dist = Math.hypot(tapX - lastTapX, tapY - lastTapY);

    if (timeDiff < 340 && dist < 45) {
      // Confirmed double tap
      e.preventDefault();
      const rect = screenFrameEl.getBoundingClientRect();
      const relX = tapX - rect.left;

      if (relX < rect.width * 0.5) {
        performSeek(-10);
      } else {
        performSeek(10);
      }
      lastTapTime = now;
    } else {
      lastTapTime = now;
      lastTapX = tapX;
      lastTapY = tapY;
    }
  });
}

// Initial HUD state sync without showing HUD immediately
updateVolumeHud(false);

