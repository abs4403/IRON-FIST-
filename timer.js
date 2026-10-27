// IRONFIST — Workout Timer
// A fully client-side interval timer (warm-up / work / rest × rounds / cooldown)
// with a live countdown ring, audio cues (Web Audio API — no sound files needed),
// and settings remembered in localStorage. No external libraries, no network
// calls after the page loads, so it always works, including offline.

(function () {
  'use strict';

  var warmupInput = document.getElementById('tm-warmup');
  var workInput = document.getElementById('tm-work');
  var restInput = document.getElementById('tm-rest');
  var roundsInput = document.getElementById('tm-rounds');
  var cooldownInput = document.getElementById('tm-cooldown');
  var soundCheckbox = document.getElementById('tm-sound');
  var presetButtons = document.querySelectorAll('.tm-preset-btn');

  var phaseLabelEl = document.getElementById('tm-phase-label');
  var timeEl = document.getElementById('tm-time');
  var roundEl = document.getElementById('tm-round');
  var ringFg = document.getElementById('tm-ring-fg');
  var startBtn = document.getElementById('tm-start');
  var pauseBtn = document.getElementById('tm-pause');
  var resetBtn = document.getElementById('tm-reset');

  if (!startBtn) return; // page not present

  var CIRCUMFERENCE = 2 * Math.PI * 52;
  ringFg.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));

  var STORAGE_KEY = 'ironfist_timer_settings';

  var PRESETS = {
    tabata: { warmup: 10, work: 20, rest: 10, rounds: 8, cooldown: 0 },
    hiit: { warmup: 15, work: 40, rest: 20, rounds: 6, cooldown: 30 },
    strength: { warmup: 0, work: 5, rest: 90, rounds: 5, cooldown: 0 },
    emom: { warmup: 10, work: 60, rest: 0, rounds: 10, cooldown: 0 }
  };

  // ---------- settings persistence ----------
  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (typeof s.warmup === 'number') warmupInput.value = s.warmup;
      if (typeof s.work === 'number') workInput.value = s.work;
      if (typeof s.rest === 'number') restInput.value = s.rest;
      if (typeof s.rounds === 'number') roundsInput.value = s.rounds;
      if (typeof s.cooldown === 'number') cooldownInput.value = s.cooldown;
      if (typeof s.sound === 'boolean') soundCheckbox.checked = s.sound;
    } catch (e) { /* ignore — storage may be unavailable (private browsing) */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        warmup: Number(warmupInput.value),
        work: Number(workInput.value),
        rest: Number(restInput.value),
        rounds: Number(roundsInput.value),
        cooldown: Number(cooldownInput.value),
        sound: soundCheckbox.checked
      }));
    } catch (e) { /* ignore */ }
  }

  [warmupInput, workInput, restInput, roundsInput, cooldownInput, soundCheckbox].forEach(function (el) {
    el.addEventListener('change', function () {
      presetButtons.forEach(function (b) { b.classList.remove('active'); });
      saveSettings();
    });
  });

  presetButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = PRESETS[btn.getAttribute('data-preset')];
      if (!p) return;
      warmupInput.value = p.warmup;
      workInput.value = p.work;
      restInput.value = p.rest;
      roundsInput.value = p.rounds;
      cooldownInput.value = p.cooldown;
      presetButtons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      saveSettings();
    });
  });

  loadSettings();

  // ---------- audio cues (Web Audio API, no files) ----------
  var audioCtx = null;
  function playTone(freq, duration) {
    if (!soundCheckbox.checked) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (e) { /* audio unavailable — fail silently, the countdown still works */ }
  }

  // ---------- phase plan ----------
  function clampInt(val, min, max, fallback) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function buildPhases() {
    var warmup = clampInt(warmupInput.value, 0, 600, 0);
    var work = clampInt(workInput.value, 1, 1800, 30);
    var rest = clampInt(restInput.value, 0, 1800, 0);
    var rounds = clampInt(roundsInput.value, 1, 50, 1);
    var cooldown = clampInt(cooldownInput.value, 0, 600, 0);

    var phases = [];
    if (warmup > 0) phases.push({ type: 'warmup', duration: warmup });
    for (var i = 1; i <= rounds; i++) {
      phases.push({ type: 'work', duration: work, round: i, totalRounds: rounds });
      if (rest > 0 && i < rounds) phases.push({ type: 'rest', duration: rest, round: i, totalRounds: rounds });
    }
    if (cooldown > 0) phases.push({ type: 'cooldown', duration: cooldown });
    return phases;
  }

  // ---------- timer engine ----------
  var phases = [];
  var phaseIndex = 0;
  var phaseStartTime = null;
  var pauseTimestamp = null;
  var running = false;
  var rafId = null;
  var lastCountdownSecond = null;

  function formatTime(totalSeconds) {
    var s = Math.max(0, totalSeconds);
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function phaseLabel(type) {
    return { warmup: 'Warm-up', work: 'Work', rest: 'Rest', cooldown: 'Cooldown' }[type] || '';
  }

  function renderPhase(phase, remainingSeconds) {
    phaseLabelEl.textContent = phaseLabel(phase.type);
    phaseLabelEl.className = 'tm-phase ' + phase.type;

    timeEl.textContent = formatTime(Math.ceil(remainingSeconds));

    ringFg.setAttribute('class', 'tm-ring-fg' + (phase.type !== 'work' ? ' ' + phase.type : ''));
    var fraction = Math.max(0, Math.min(1, remainingSeconds / phase.duration));
    ringFg.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));

    if (phase.type === 'work' || phase.type === 'rest') {
      roundEl.innerHTML = 'Round <b>' + phase.round + '</b> of <b>' + phase.totalRounds + '</b>';
    } else if (phase.type === 'warmup') {
      roundEl.textContent = 'Warm-up — get into position.';
    } else {
      roundEl.textContent = 'Cooldown — ease it out.';
    }
  }

  function maybeCountdownBeep(remainingSeconds) {
    var whole = Math.ceil(remainingSeconds);
    if (whole !== lastCountdownSecond) {
      lastCountdownSecond = whole;
      if (whole > 0 && whole <= 3) playTone(600, 0.08);
    }
  }

  function tick() {
    if (!running) return;
    var now = performance.now();
    var elapsed = (now - phaseStartTime) / 1000;
    var phase = phases[phaseIndex];
    var remaining = phase.duration - elapsed;

    if (remaining <= 0) {
      advancePhase();
      return;
    }

    renderPhase(phase, remaining);
    maybeCountdownBeep(remaining);
    rafId = requestAnimationFrame(tick);
  }

  function advancePhase() {
    phaseIndex += 1;
    if (phaseIndex >= phases.length) {
      finishTimer();
      return;
    }
    phaseStartTime = performance.now();
    lastCountdownSecond = null;
    var newPhase = phases[phaseIndex];
    playTone(newPhase.type === 'work' ? 880 : 440, 0.18);
    tick();
  }

  function finishTimer() {
    running = false;
    phaseLabelEl.textContent = 'Done';
    phaseLabelEl.className = 'tm-phase done';
    timeEl.textContent = '00:00';
    ringFg.setAttribute('class', 'tm-ring-fg');
    ringFg.style.strokeDashoffset = '0';
    roundEl.textContent = 'Workout complete — nice work.';
    playTone(660, 0.12);
    setTimeout(function () { playTone(880, 0.22); }, 180);
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
    resetBtn.disabled = false;
    setInputsDisabled(false);
  }

  function setInputsDisabled(disabled) {
    [warmupInput, workInput, restInput, roundsInput, cooldownInput].forEach(function (el) {
      el.disabled = disabled;
    });
  }

  function startTimer() {
    phases = buildPhases();
    if (!phases.length) return;
    phaseIndex = 0;
    phaseStartTime = performance.now();
    lastCountdownSecond = null;
    running = true;
    setInputsDisabled(true);
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
    playTone(880, 0.18);
    tick();
  }

  function pauseTimer() {
    if (!running) return;
    running = false;
    pauseTimestamp = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    pauseBtn.textContent = 'Resume';
  }

  function resumeTimer() {
    var pausedDuration = performance.now() - pauseTimestamp;
    phaseStartTime += pausedDuration;
    running = true;
    pauseBtn.textContent = 'Pause';
    tick();
  }

  function resetTimer() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    phases = [];
    phaseIndex = 0;
    phaseLabelEl.textContent = 'Ready';
    phaseLabelEl.className = 'tm-phase';
    timeEl.textContent = '00:00';
    ringFg.setAttribute('class', 'tm-ring-fg');
    ringFg.style.strokeDashoffset = '0';
    roundEl.textContent = 'Set your intervals and press start.';
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
    resetBtn.disabled = true;
    setInputsDisabled(false);
  }

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', function () {
    if (pauseBtn.textContent === 'Resume') resumeTimer();
    else pauseTimer();
  });
  resetBtn.addEventListener('click', resetTimer);
  window.addEventListener('beforeunload', function () {
    if (rafId) cancelAnimationFrame(rafId);
  });
})();
