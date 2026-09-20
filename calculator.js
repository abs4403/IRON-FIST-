// IRONFIST — calorie calculator + daily food log
// Everything here is stored in localStorage, on the visitor's own device.
(function () {
  var STORAGE_TARGET = 'ironfist_target_kcal';
  var STORAGE_LOG_PREFIX = 'ironfist_log_'; // + YYYY-MM-DD

  var form = document.getElementById('calc-form');
  var unitInputs = document.getElementsByName('unit');
  var weightLabel = document.getElementById('weight-label');
  var heightLabel = document.getElementById('height-label');

  var resultTarget = document.getElementById('result-target');
  var resultBmr = document.getElementById('result-bmr');
  var resultTdee = document.getElementById('result-tdee');
  var resultGoal = document.getElementById('result-goal');
  var logTargetEcho = document.getElementById('log-target-echo');

  var logForm = document.getElementById('log-form');
  var logBody = document.getElementById('log-body');
  var logEmpty = document.getElementById('log-empty');
  var logTotalNum = document.getElementById('log-total-num');
  var logRemaining = document.getElementById('log-remaining');
  var logClearBtn = document.getElementById('log-clear');

  function todayKey() {
    var d = new Date();
    return STORAGE_LOG_PREFIX + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function safeGet(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage unavailable (private browsing etc) — fail quietly, app still works this session
    }
  }

  // ---------- unit toggle (metric / imperial) ----------
  unitInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.value === 'imperial') {
        weightLabel.textContent = 'Weight (lb)';
        heightLabel.textContent = 'Height (in)';
      } else {
        weightLabel.textContent = 'Weight (kg)';
        heightLabel.textContent = 'Height (cm)';
      }
    });
  });

  // ---------- BMR / TDEE calculation ----------
  function calculate(e) {
    e.preventDefault();

    var sex = document.querySelector('input[name="sex"]:checked').value;
    var unit = document.querySelector('input[name="unit"]:checked').value;
    var age = parseFloat(document.getElementById('age').value);
    var weight = parseFloat(document.getElementById('weight').value);
    var height = parseFloat(document.getElementById('height').value);
    var activity = parseFloat(document.getElementById('activity').value);
    var goalAdj = parseFloat(document.getElementById('goal').value);

    if (!age || !weight || !height) return;

    var kg = weight;
    var cm = height;
    if (unit === 'imperial') {
      kg = weight * 0.45359237;
      cm = height * 2.54;
    }

    // Mifflin-St Jeor
    var bmr = (10 * kg) + (6.25 * cm) - (5 * age) + (sex === 'male' ? 5 : -161);
    var tdee = bmr * activity;
    var target = Math.round(tdee + goalAdj);

    resultBmr.textContent = Math.round(bmr) + ' kcal';
    resultTdee.textContent = Math.round(tdee) + ' kcal';
    resultGoal.textContent = (goalAdj > 0 ? '+' : '') + goalAdj + ' kcal';
    resultTarget.textContent = target;

    safeSet(STORAGE_TARGET, target);
    renderLog();
  }

  if (form) form.addEventListener('submit', calculate);

  // ---------- food log ----------
  function getLog() {
    return safeGet(todayKey()) || [];
  }

  function setLog(entries) {
    safeSet(todayKey(), entries);
  }

  function renderLog() {
    var entries = getLog();
    logBody.innerHTML = '';

    if (entries.length === 0) {
      logEmpty.style.display = 'block';
    } else {
      logEmpty.style.display = 'none';
      entries.forEach(function (entry, i) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(entry.name) + '</td>' +
          '<td>' + escapeHtml(entry.time || '—') + '</td>' +
          '<td class="num">' + entry.cals + '</td>' +
          '<td><button class="log-remove" data-idx="' + i + '" aria-label="Remove entry">✕</button></td>';
        logBody.appendChild(tr);
      });
    }

    var total = entries.reduce(function (sum, e) { return sum + e.cals; }, 0);
    logTotalNum.textContent = total + ' kcal';

    var target = safeGet(STORAGE_TARGET);
    if (target) {
      logTargetEcho.textContent = target + ' kcal/day';
      var remaining = target - total;
      logRemaining.textContent = (remaining >= 0 ? remaining + ' kcal left' : Math.abs(remaining) + ' kcal over');
      logRemaining.style.color = remaining >= 0 ? 'var(--sage)' : 'var(--iron)';

      // reflect a previously-saved target back into the calculator display
      resultTarget.textContent = target;
    } else {
      logTargetEcho.textContent = 'set a target above';
      logRemaining.textContent = '—';
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (logForm) {
    logForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameInput = document.getElementById('food-name');
      var calsInput = document.getElementById('food-cals');
      var timeInput = document.getElementById('food-time');

      var name = nameInput.value.trim();
      var cals = parseInt(calsInput.value, 10);
      var time = timeInput.value.trim();

      if (!name || isNaN(cals)) return;

      var entries = getLog();
      entries.push({ name: name, cals: cals, time: time });
      setLog(entries);

      nameInput.value = '';
      calsInput.value = '';
      timeInput.value = '';
      nameInput.focus();

      renderLog();
    });
  }

  if (logBody) {
    logBody.addEventListener('click', function (e) {
      var btn = e.target.closest('.log-remove');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var entries = getLog();
      entries.splice(idx, 1);
      setLog(entries);
      renderLog();
    });
  }

  if (logClearBtn) {
    logClearBtn.addEventListener('click', function () {
      setLog([]);
      renderLog();
    });
  }

  // initial paint
  renderLog();
})();
