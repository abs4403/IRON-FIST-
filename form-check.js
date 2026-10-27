// IRONFIST — Form Check
// Live camera-based posture/form tracking using TensorFlow.js + MoveNet.
// Everything runs client-side in the browser: no video or pose data is ever
// sent to a server. Requires HTTPS (or localhost) and camera permission.

(function () {
  'use strict';

  // ---------- DOM refs ----------
  var video = document.getElementById('fc-video');
  var canvas = document.getElementById('fc-canvas');
  var stage = document.getElementById('fc-stage');
  var placeholder = document.getElementById('fc-placeholder');
  var startBtn = document.getElementById('fc-start');
  var stopBtn = document.getElementById('fc-stop');
  var statusLine = document.getElementById('fc-status');
  var exerciseButtons = document.querySelectorAll('.fc-ex-btn');
  var messageEl = document.getElementById('fc-message');
  var repsEl = document.getElementById('fc-reps');
  var repsLabelEl = document.getElementById('fc-reps-label');
  var angleEl = document.getElementById('fc-angle');
  var cuesEl = document.getElementById('fc-cues');

  if (!video || !canvas) return; // page not present, nothing to wire up

  var ctx = canvas.getContext('2d');

  // ---------- state ----------
  var detector = null;
  var modelReady = false;
  var running = false;
  var stream = null;
  var rafId = null;
  var currentExercise = 'squat';
  var repState = 'up'; // generic state machine: 'up' / 'down'
  var repCount = 0;
  var plankHoldStart = null;
  var plankHoldSeconds = 0;

  // ---------- exercise definitions ----------
  // Each exercise lists: which joint triplet to measure (by MoveNet keypoint
  // names), the "down"/"up" angle thresholds for rep counting, and a
  // feedback function that turns the latest measurements into a message.
  var EXERCISES = {
    squat: {
      label: 'Squat',
      repsLabel: 'Reps',
      cues: [
        'Feet roughly shoulder-width apart, toes slightly out.',
        'Send the hips back and down, chest up.',
        'Knees track over the toes — avoid them caving inward.',
        'Aim for hip crease at or below knee height.'
      ],
      downAngle: 100,
      upAngle: 160
    },
    pushup: {
      label: 'Push-Up',
      repsLabel: 'Reps',
      cues: [
        'Hands under or slightly wider than shoulders.',
        'Keep a straight line from shoulders to ankles.',
        'Lower until elbows reach about 90°.',
        'Avoid letting the hips sag or pike up.'
      ],
      downAngle: 95,
      upAngle: 155
    },
    plank: {
      label: 'Plank',
      repsLabel: 'Seconds held',
      cues: [
        'Elbows under shoulders, forearms flat on the floor.',
        'Keep a straight line from shoulders to ankles.',
        'Brace the core — don’t let the hips drop or pike.',
        'Breathe steadily through the hold.'
      ]
    },
    curl: {
      label: 'Bicep Curl',
      repsLabel: 'Reps',
      cues: [
        'Keep the elbow pinned close to your torso.',
        'Curl through the full range, then lower with control.',
        'Avoid swinging the shoulder or torso to move the weight.',
        'Squeeze at the top, don’t just drop back down.'
      ],
      downAngle: 150,
      upAngle: 55
    },
    lunge: {
      label: 'Lunge',
      repsLabel: 'Reps',
      cues: [
        'Step forward (or back) into a long, stable stance.',
        'Front knee bends to roughly 90°, tracking over the ankle.',
        'Keep the torso upright, not leaning forward.',
        'Back knee lowers toward the floor without slamming it.'
      ],
      downAngle: 100,
      upAngle: 160
    }
  };

  // ---------- geometry helpers ----------
  function angleBetween(a, b, c) {
    // angle at point b, formed by rays b->a and b->c, in degrees
    var v1x = a.x - b.x, v1y = a.y - b.y;
    var v2x = c.x - b.x, v2y = c.y - b.y;
    var dot = v1x * v2x + v1y * v2y;
    var mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    var mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (mag1 === 0 || mag2 === 0) return null;
    var cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return (Math.acos(cos) * 180) / Math.PI;
  }

  function kp(keypoints, name) {
    for (var i = 0; i < keypoints.length; i++) {
      if (keypoints[i].name === name) return keypoints[i];
    }
    return null;
  }

  function confident(point, minScore) {
    return point && typeof point.score === 'number' && point.score >= (minScore || 0.35);
  }

  // Picks whichever side (left/right) has better keypoint confidence for a
  // given triplet of joint-name suffixes, e.g. ('shoulder','elbow','wrist').
  function pickSide(keypoints, jointA, jointB, jointC) {
    var left = [kp(keypoints, 'left_' + jointA), kp(keypoints, 'left_' + jointB), kp(keypoints, 'left_' + jointC)];
    var right = [kp(keypoints, 'right_' + jointA), kp(keypoints, 'right_' + jointB), kp(keypoints, 'right_' + jointC)];
    var leftScore = left.every(Boolean) ? (left[0].score + left[1].score + left[2].score) : -1;
    var rightScore = right.every(Boolean) ? (right[0].score + right[1].score + right[2].score) : -1;
    if (leftScore < 0 && rightScore < 0) return null;
    return rightScore >= leftScore ? right : left;
  }

  // ---------- drawing ----------
  var SKELETON_PAIRS = [
    ['left_shoulder', 'right_shoulder'], ['left_hip', 'right_hip'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
  ];

  function drawSkeleton(keypoints, statusClass) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var color = statusClass === 'good' ? '#8C9B7C' : statusClass === 'bad' ? '#B3311A' : '#D8A23B';

    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';

    SKELETON_PAIRS.forEach(function (pair) {
      var p1 = kp(keypoints, pair[0]);
      var p2 = kp(keypoints, pair[1]);
      if (confident(p1) && confident(p2)) {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    });

    ctx.fillStyle = color;
    keypoints.forEach(function (point) {
      if (confident(point)) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---------- per-exercise evaluation ----------
  // Each returns { angle, statusClass, message }
  function evaluateSquat(keypoints) {
    var side = pickSide(keypoints, 'hip', 'knee', 'ankle');
    var shoulderSide = pickSide(keypoints, 'shoulder', 'hip', 'knee');
    if (!side) return noBodyMessage();

    var kneeAngle = angleBetween(side[0], side[1], side[2]);
    var backAngle = shoulderSide ? angleBetween(shoulderSide[0], shoulderSide[1], shoulderSide[2]) : null;

    var cfg = EXERCISES.squat;
    updateRepState(kneeAngle, cfg.downAngle, cfg.upAngle);

    var statusClass = 'warn';
    var message = 'Stand so your full body is visible.';

    if (kneeAngle !== null) {
      if (kneeAngle > cfg.upAngle) {
        statusClass = 'good'; message = 'Standing — ready to squat.';
      } else if (kneeAngle <= cfg.downAngle) {
        statusClass = 'good'; message = 'Good depth — drive back up.';
      } else {
        statusClass = 'warn'; message = 'Go a little lower for full depth.';
      }
      if (backAngle !== null && backAngle < 140 && kneeAngle < 150) {
        statusClass = 'bad'; message = 'Keep your chest up — don’t fold forward.';
      }
    }
    return { angle: kneeAngle, statusClass: statusClass, message: message };
  }

  function evaluatePushup(keypoints) {
    var arm = pickSide(keypoints, 'shoulder', 'elbow', 'wrist');
    var line = pickSide(keypoints, 'shoulder', 'hip', 'ankle');
    if (!arm) return noBodyMessage();

    var elbowAngle = angleBetween(arm[0], arm[1], arm[2]);
    var bodyLine = line ? angleBetween(line[0], line[1], line[2]) : null;
    var cfg = EXERCISES.pushup;
    updateRepState(elbowAngle, cfg.downAngle, cfg.upAngle);

    var statusClass = 'warn';
    var message = 'Get your whole body in frame, from the side.';

    if (elbowAngle !== null) {
      if (elbowAngle > cfg.upAngle) { statusClass = 'good'; message = 'Top of the rep — lower with control.'; }
      else if (elbowAngle <= cfg.downAngle) { statusClass = 'good'; message = 'Good depth — press back up.'; }
      else { statusClass = 'warn'; message = 'Lower a little further.'; }
    }
    if (bodyLine !== null && bodyLine < 150) {
      statusClass = 'bad'; message = 'Keep your hips in line — don’t let them sag or pike.';
    }
    return { angle: elbowAngle, statusClass: statusClass, message: message };
  }

  function evaluatePlank(keypoints) {
    var line = pickSide(keypoints, 'shoulder', 'hip', 'ankle');
    if (!line) return noBodyMessage();

    var bodyLine = angleBetween(line[0], line[1], line[2]);
    var statusClass, message;

    if (bodyLine === null) { statusClass = 'warn'; message = 'Get your whole body in frame, from the side.'; }
    else if (bodyLine < 150) { statusClass = 'bad'; message = 'Hips are sagging — engage your core and lift slightly.'; }
    else if (bodyLine > 195) { statusClass = 'bad'; message = 'Hips are piking up — lower them in line with your shoulders.'; }
    else { statusClass = 'good'; message = 'Solid line — hold steady and breathe.'; }

    if (statusClass === 'good') {
      if (plankHoldStart === null) plankHoldStart = Date.now();
      plankHoldSeconds = Math.floor((Date.now() - plankHoldStart) / 1000);
    } else {
      plankHoldStart = null;
    }
    repCount = plankHoldSeconds;

    return { angle: bodyLine, statusClass: statusClass, message: message };
  }

  function evaluateCurl(keypoints) {
    var arm = pickSide(keypoints, 'shoulder', 'elbow', 'wrist');
    if (!arm) return noBodyMessage();

    var elbowAngle = angleBetween(arm[0], arm[1], arm[2]);
    var cfg = EXERCISES.curl;
    updateRepState(elbowAngle, cfg.upAngle, cfg.downAngle); // inverted: smaller angle = "down"(curled)

    var elbowDrift = Math.abs(arm[1].x - arm[0].x);
    var statusClass = 'warn';
    var message = 'Keep your arm visible from the side.';

    if (elbowAngle !== null) {
      if (elbowAngle <= cfg.upAngle) { statusClass = 'good'; message = 'Fully curled — lower with control.'; }
      else if (elbowAngle >= cfg.downAngle) { statusClass = 'good'; message = 'Fully extended — curl back up.'; }
      else { statusClass = 'warn'; message = 'Keep going through the full range.'; }
    }
    if (elbowDrift > 60) {
      statusClass = 'bad'; message = 'Keep your elbow pinned to your side — it’s drifting forward.';
    }
    return { angle: elbowAngle, statusClass: statusClass, message: message };
  }

  function evaluateLunge(keypoints) {
    var leg = pickSide(keypoints, 'hip', 'knee', 'ankle');
    var torso = pickSide(keypoints, 'shoulder', 'hip', 'knee');
    if (!leg) return noBodyMessage();

    var kneeAngle = angleBetween(leg[0], leg[1], leg[2]);
    var torsoAngle = torso ? angleBetween(torso[0], torso[1], torso[2]) : null;
    var cfg = EXERCISES.lunge;
    updateRepState(kneeAngle, cfg.downAngle, cfg.upAngle);

    var statusClass = 'warn';
    var message = 'Step into the lunge so your side is visible to the camera.';

    if (kneeAngle !== null) {
      if (kneeAngle > cfg.upAngle) { statusClass = 'good'; message = 'Standing tall — step into the next rep.'; }
      else if (kneeAngle <= cfg.downAngle + 10 && kneeAngle >= cfg.downAngle - 20) { statusClass = 'good'; message = 'Good depth on the front knee.'; }
      else if (kneeAngle < cfg.downAngle - 20) { statusClass = 'bad'; message = 'That’s very deep — ease up slightly to protect the knee.'; }
      else { statusClass = 'warn'; message = 'Bend the front knee a bit more.'; }
    }
    if (torsoAngle !== null && torsoAngle < 150) {
      statusClass = 'bad'; message = 'Keep your torso upright, not leaning over the front knee.';
    }
    return { angle: kneeAngle, statusClass: statusClass, message: message };
  }

  function noBodyMessage() {
    return { angle: null, statusClass: 'warn', message: 'Step back so your whole body is visible.' };
  }

  function updateRepState(angle, downThreshold, upThreshold) {
    if (angle === null) return;
    if (repState === 'up' && angle <= downThreshold) {
      repState = 'down';
    } else if (repState === 'down' && angle >= upThreshold) {
      repState = 'up';
      repCount += 1;
    }
  }

  var EVALUATORS = {
    squat: evaluateSquat,
    pushup: evaluatePushup,
    plank: evaluatePlank,
    curl: evaluateCurl,
    lunge: evaluateLunge
  };

  // ---------- UI wiring ----------
  function renderCues(exerciseKey) {
    var cfg = EXERCISES[exerciseKey];
    cuesEl.innerHTML = '';
    cfg.cues.forEach(function (cue) {
      var li = document.createElement('li');
      li.textContent = cue;
      cuesEl.appendChild(li);
    });
    repsLabelEl.textContent = cfg.repsLabel;
  }

  function setExercise(key) {
    currentExercise = key;
    repState = 'up';
    repCount = 0;
    plankHoldStart = null;
    plankHoldSeconds = 0;
    repsEl.textContent = '0';
    angleEl.textContent = '—';
    messageEl.className = 'fc-feedback-msg';
    messageEl.textContent = running ? 'Get in position…' : 'Waiting for camera…';
    renderCues(key);

    exerciseButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-exercise') === key);
    });
  }

  exerciseButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setExercise(btn.getAttribute('data-exercise'));
    });
  });

  // ---------- model loading ----------
  function loadModel() {
    if (modelReady || !window.tf || !window.poseDetection) return Promise.reject(new Error('library missing'));
    statusLine.textContent = 'Loading pose-detection model…';
    return tf.setBackend('webgl').then(function () {
      return tf.ready();
    }).then(function () {
      return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      });
    }).then(function (d) {
      detector = d;
      modelReady = true;
      statusLine.textContent = 'Model loaded. Camera ready.';
    });
  }

  // ---------- camera control ----------
  function startCamera() {
    startBtn.disabled = true;
    statusLine.textContent = 'Requesting camera access…';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusLine.textContent = 'This browser doesn’t support camera access, or the page isn’t served over HTTPS/localhost.';
      startBtn.disabled = false;
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = stream;
        return video.play();
      })
      .then(function () {
        return loadModel();
      })
      .then(function () {
        placeholder.style.display = 'none';
        video.style.display = 'block';
        canvas.style.display = 'block';
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        stopBtn.disabled = false;
        running = true;
        messageEl.textContent = 'Get in position…';
        statusLine.textContent = 'Tracking live.';
        detectLoop();
      })
      .catch(function (err) {
        startBtn.disabled = false;
        if (err && err.name === 'NotAllowedError') {
          statusLine.textContent = 'Camera permission was denied. Allow camera access and try again.';
        } else if (err && err.message === 'library missing') {
          statusLine.textContent = 'Could not load the pose-detection library (check your internet connection).';
        } else {
          statusLine.textContent = 'Could not start the camera: ' + (err && err.message ? err.message : err);
        }
      });
  }

  function stopCamera() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.pause();
    video.style.display = 'none';
    canvas.style.display = 'none';
    placeholder.style.display = 'block';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusLine.textContent = 'Camera stopped.';
    messageEl.className = 'fc-feedback-msg';
    messageEl.textContent = 'Waiting for camera…';
  }

  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  window.addEventListener('beforeunload', stopCamera);

  // ---------- main detection loop ----------
  function detectLoop() {
    if (!running || !detector) {
      rafId = requestAnimationFrame(detectLoop);
      return;
    }
    detector.estimatePoses(video).then(function (poses) {
      if (!running) return;
      if (poses && poses[0] && poses[0].keypoints) {
        var keypoints = poses[0].keypoints;
        var evaluator = EVALUATORS[currentExercise];
        var result = evaluator(keypoints);

        drawSkeleton(keypoints, result.statusClass);

        messageEl.className = 'fc-feedback-msg ' + result.statusClass;
        messageEl.textContent = result.message;
        angleEl.textContent = result.angle !== null ? Math.round(result.angle) + '°' : '—';
        repsEl.textContent = String(repCount);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        messageEl.className = 'fc-feedback-msg warn';
        messageEl.textContent = 'No person detected — step into frame.';
      }
      rafId = requestAnimationFrame(detectLoop);
    }).catch(function () {
      rafId = requestAnimationFrame(detectLoop);
    });
  }

  // initial UI state
  renderCues(currentExercise);
})();
