document.addEventListener('DOMContentLoaded', () => {
  // ===== APP STATE =====
  let state = {
    profile: null, // { name, sleep, rate, currency }
    schedule: {
      Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
    }, // Array of { id, start, end, type, label }
    tasks: [] // Array of { id, name, hours, deadline, complexity, category, notes, urgent, status }
  };

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let currentTab = 'week';
  let currentTaskFilter = 'all';
  let pomoInterval = null;
  let pomoTimeLeft = 25 * 60;
  let pomoIsRunning = false;
  let pomoCurrentMode = 25; // minutes

  // ===== INITIALIZATION =====
  async function init() {
    setupEventListeners();
    startLiveClock();
    
    const token = localStorage.getItem('flTimerToken');
    if (token) {
      await loadStateFromDB(token);
    } else {
      document.getElementById('authModal').classList.add('active');
    }
  }

  async function loadStateFromDB(token) {
    try {
      showToast('Loading data...', 'success');
      const res = await fetch('/api/state', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load state');
      
      const data = await res.json();
      if (data.state) {
        state = data.state;
      }
      
      document.getElementById('authModal').classList.remove('active');
      if (!state.profile) {
        document.getElementById('profileModal').classList.add('active');
      } else {
        document.getElementById('app').classList.remove('hidden');
        updateUI();
      }
    } catch (err) {
      console.error(err);
      localStorage.removeItem('flTimerToken');
      document.getElementById('authModal').classList.add('active');
    }
  }

  async function saveState() {
    // Save to DB asynchronously
    const token = localStorage.getItem('flTimerToken');
    if (!token) return;
    
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ state })
      });
    } catch (err) {
      console.error('Failed to save state to DB', err);
    }
  }

  // ===== UTILITIES =====
  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
  }

  function generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  function calculateFreeTime(day) {
    let sleepMins = (state.profile ? state.profile.sleep : 8) * 60;
    let totalDayMins = 24 * 60;
    let blocksMins = 0;
    let freelancingMins = 0;

    state.schedule[day].forEach(b => {
      let start = timeToMinutes(b.start);
      let end = timeToMinutes(b.end);
      if (end < start) end += 24 * 60; // Crosses midnight
      let dur = end - start;
      blocksMins += dur;
      if (b.type === 'freelancing') freelancingMins += dur;
    });

    let freeMins = totalDayMins - sleepMins - blocksMins;
    return { freeMins: Math.max(0, freeMins), freelancingMins };
  }

  function getDaysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    const diffTime = target - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // ===== EVENT LISTENERS =====
  function setupEventListeners() {
    // Auth
    document.getElementById('showSignupBtn').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('loginForm').classList.add('hidden');
      document.getElementById('signupForm').classList.remove('hidden');
    });

    document.getElementById('showLoginBtn').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('signupForm').classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
    });

    document.getElementById('loginBtn').addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value.trim();
      if(!email || !password) return showToast('Email and password required', 'error');

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', email, password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('flTimerToken', data.token);
          showToast('Login successful!');
          await loadStateFromDB(data.token);
        } else {
          showToast(data.error || 'Login failed', 'error');
        }
      } catch (err) {
        showToast('Network error', 'error');
      }
    });

    document.getElementById('signupBtn').addEventListener('click', async () => {
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value.trim();
      if(!name || !email || !password) return showToast('All fields required', 'error');

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'signup', name, email, password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('flTimerToken', data.token);
          showToast('Signup successful!');
          // Pre-fill profile name
          document.getElementById('profileName').value = data.user.name;
          await loadStateFromDB(data.token);
        } else {
          showToast(data.error || 'Signup failed', 'error');
        }
      } catch (err) {
        showToast('Network error', 'error');
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.removeItem('flTimerToken');
      location.reload();
    });

    // Profile Modal
    document.getElementById('profileSubmitBtn').addEventListener('click', () => {
      const name = document.getElementById('profileName').value.trim();
      const sleep = parseInt(document.getElementById('profileSleep').value) || 8;
      if (!name) return showToast('Naam dalna zaruri hai!', 'error');
      
      state.profile = { name, sleep, rate: 0, currency: 'PKR' };
      saveState();
      document.getElementById('profileModal').classList.remove('active');
      document.getElementById('app').classList.remove('hidden');
      showToast(`Welcome, ${name}!`);
      updateUI();
    });

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${currentTab}`).classList.add('active');
        
        const titles = {
          week: { t: 'My Week', s: 'Apna schedule set karo' },
          tasks: { t: 'Tasks Queue', s: 'Manage all your pending work' },
          schedule: { t: 'Smart Schedule', s: 'Auto-generated work plan' },
          analytics: { t: 'Analytics', s: 'Tumhari performance and stats' }
        };
        document.getElementById('pageTitle').textContent = titles[currentTab].t;
        document.getElementById('pageSub').textContent = titles[currentTab].s;
        
        updateUI();
      });
    });

    // Add Block Modal
    document.getElementById('saveBlockBtn').addEventListener('click', () => {
      const day = document.getElementById('blockDay').value;
      const start = document.getElementById('blockStart').value;
      const end = document.getElementById('blockEnd').value;
      const type = document.getElementById('blockType').value;
      const label = document.getElementById('blockLabel').value;
      
      if (!start || !end) return showToast('Time select karo!', 'error');
      
      state.schedule[day].push({ id: generateId(), start, end, type, label });
      // Sort blocks by start time
      state.schedule[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
      
      saveState();
      document.getElementById('blockModal').classList.remove('active');
      showToast('Block add ho gaya!');
      renderWeekTab();
    });

    document.getElementById('closeBlockBtn').addEventListener('click', () => {
      document.getElementById('blockModal').classList.remove('active');
    });

    // Task Management
    document.getElementById('addTaskBtn').addEventListener('click', () => {
      const name = document.getElementById('taskName').value.trim();
      const hours = parseFloat(document.getElementById('taskHours').value);
      const deadline = document.getElementById('taskDeadline').value;
      const complexity = document.getElementById('taskComplexity').value;
      const category = document.getElementById('taskCategory').value;
      const price = parseFloat(document.getElementById('taskPrice').value) || 0;
      const notes = document.getElementById('taskNotes').value.trim();
      const urgent = document.getElementById('taskUrgent').checked;

      if (!name || !hours || !deadline) return showToast('Sari zaruri details bharo!', 'error');

      state.tasks.push({
        id: generateId(), name, hours, deadline, complexity, category, price, notes, urgent, status: 'pending'
      });
      
      saveState();
      showToast('Task add ho gaya!');
      
      // Clear form
      document.getElementById('taskName').value = '';
      document.getElementById('taskHours').value = '';
      document.getElementById('taskPrice').value = '';
      document.getElementById('taskDeadline').value = '';
      document.getElementById('taskNotes').value = '';
      document.getElementById('taskUrgent').checked = false;
      
      renderTasksTab();
    });

    // Task Filters
    document.querySelectorAll('.ftab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTaskFilter = btn.dataset.filter;
        renderTasksTab();
      });
    });

    // Schedule Generator
    document.getElementById('genSchedBtn').addEventListener('click', generateSchedule);

    // Settings
    document.getElementById('openSettingsBtn').addEventListener('click', () => {
      if(state.profile) {
        document.getElementById('settingsName').value = state.profile.name;
        document.getElementById('settingsSleep').value = state.profile.sleep;
        document.getElementById('settingsRate').value = state.profile.rate;
        document.getElementById('settingsCurrency').value = state.profile.currency;
      }
      document.getElementById('settingsModal').classList.add('active');
    });
    
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('active');
    });
    
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      state.profile.name = document.getElementById('settingsName').value;
      state.profile.sleep = parseInt(document.getElementById('settingsSleep').value) || 8;
      state.profile.rate = parseFloat(document.getElementById('settingsRate').value) || 0;
      state.profile.currency = document.getElementById('settingsCurrency').value;
      saveState();
      document.getElementById('settingsModal').classList.remove('active');
      showToast('Settings saved!');
      updateUI();
    });

    document.getElementById('resetAppBtn').addEventListener('click', () => {
      if(confirm('Are you sure? Sab data delete ho jayega!')) {
        localStorage.removeItem('flTimerState');
        location.reload();
      }
    });

    // Pomodoro
    document.getElementById('openPomoBtn').addEventListener('click', () => {
      document.getElementById('pomodoroWidget').classList.remove('hidden');
    });
    document.getElementById('pomoCloseBtn').addEventListener('click', () => {
      document.getElementById('pomodoroWidget').classList.add('hidden');
    });
    
    document.getElementById('pomoToggleBtn').addEventListener('click', () => {
      if (pomoIsRunning) {
        clearInterval(pomoInterval);
        document.getElementById('pomoToggleBtn').textContent = '▶ Start';
      } else {
        pomoInterval = setInterval(updatePomoTimer, 1000);
        document.getElementById('pomoToggleBtn').textContent = '⏸ Pause';
      }
      pomoIsRunning = !pomoIsRunning;
    });

    document.getElementById('pomoResetBtn').addEventListener('click', () => {
      clearInterval(pomoInterval);
      pomoIsRunning = false;
      document.getElementById('pomoToggleBtn').textContent = '▶ Start';
      pomoTimeLeft = pomoCurrentMode * 60;
      updatePomoUI();
    });

    document.querySelectorAll('.pomo-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pomo-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pomoCurrentMode = parseInt(btn.dataset.mins);
        pomoTimeLeft = pomoCurrentMode * 60;
        clearInterval(pomoInterval);
        pomoIsRunning = false;
        document.getElementById('pomoToggleBtn').textContent = '▶ Start';
        updatePomoUI();
      });
    });
  }

  // ===== LIVE CLOCK =====
  function startLiveClock() {
    setInterval(() => {
      const now = new Date();
      document.getElementById('liveClock').textContent = now.toLocaleTimeString();
    }, 1000);
  }

  // ===== POMODORO LOGIC =====
  function updatePomoTimer() {
    if (pomoTimeLeft > 0) {
      pomoTimeLeft--;
      updatePomoUI();
    } else {
      clearInterval(pomoInterval);
      pomoIsRunning = false;
      document.getElementById('pomoToggleBtn').textContent = '▶ Start';
      showToast('Focus Session Complete! 🎉');
      // Play sound
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.play().catch(e => console.log('Audio play failed'));
    }
  }

  function updatePomoUI() {
    const mins = Math.floor(pomoTimeLeft / 60);
    const secs = pomoTimeLeft % 60;
    document.getElementById('pomoDisplay').textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    const total = pomoCurrentMode * 60;
    const progress = pomoTimeLeft / total;
    const dashoffset = 264 * (1 - progress); // 264 is roughly 2 * pi * r (where r=42)
    document.getElementById('pomoRing').style.strokeDashoffset = dashoffset;
  }

  // ===== UI RENDERING =====
  function updateUI() {
    if(!state.profile) return;
    
    // Sidebar
    document.getElementById('sidebarAvatar').textContent = state.profile.name.charAt(0).toUpperCase();
    document.getElementById('sidebarName').textContent = state.profile.name;
    
    // Pending Tasks Badge
    const pendingCount = state.tasks.filter(t => t.status !== 'completed').length;
    const badge = document.getElementById('pendingBadge');
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }

    if (currentTab === 'week') renderWeekTab();
    if (currentTab === 'tasks') renderTasksTab();
    if (currentTab === 'analytics') renderAnalyticsTab();
  }

  // -- WEEK TAB --
  function renderWeekTab() {
    let totalFreeMins = 0;
    let totalFreelancingMins = 0;

    const grid = document.getElementById('weekGrid');
    grid.innerHTML = '';

    DAYS.forEach(day => {
      const stats = calculateFreeTime(day);
      totalFreeMins += stats.freeMins;
      totalFreelancingMins += stats.freelancingMins;

      const freeHours = (stats.freeMins / 60).toFixed(1);
      
      let blocksHtml = state.schedule[day].map(b => `
        <div class="block-item">
          <div class="block-dot" style="background: ${b.type === 'freelancing' ? 'var(--primary)' : 'var(--yellow)'}"></div>
          <div class="block-info">
            <span class="block-time">${b.start}-${b.end}</span>
            ${b.label || (b.type === 'freelancing' ? 'Work' : 'Busy')}
          </div>
          <button class="block-del" onclick="window.deleteBlock('${day}', '${b.id}')">✕</button>
        </div>
      `).join('');

      // Timeline visual
      const sleepPct = (state.profile.sleep / 24) * 100;
      const blocksPct = ( (24*60 - stats.freeMins - state.profile.sleep*60) / (24*60) ) * 100;
      const freePct = (stats.freeMins / (24*60)) * 100;

      const card = document.createElement('div');
      card.className = 'day-card';
      card.innerHTML = `
        <div class="day-header">
          <span class="day-name">${day}</span>
          <span class="day-free">${freeHours}h Free</span>
        </div>
        <div class="timeline-bar">
          <div class="tl-seg tl-sleep" style="width:${sleepPct}%" title="Sleep"></div>
          <div class="tl-seg tl-other" style="width:${blocksPct}%" title="Busy"></div>
          <div class="tl-seg tl-free" style="width:${freePct}%" title="Free"></div>
        </div>
        <div class="blocks-list">${blocksHtml}</div>
        <button class="add-block-btn" onclick="window.openAddBlock('${day}')">+ Add Period</button>
      `;
      grid.appendChild(card);
    });

    document.getElementById('weekStats').innerHTML = `
      <div class="stat-card" style="--grad: linear-gradient(90deg, var(--green), #34d399)">
        <div class="stat-label">Total Free Time</div>
        <div><span class="stat-value">${(totalFreeMins / 60).toFixed(1)}</span><span class="stat-unit">hrs/week</span></div>
        <div class="stat-sub">Time available for tasks</div>
      </div>
      <div class="stat-card" style="--grad: linear-gradient(90deg, var(--primary), var(--primary2))">
        <div class="stat-label">Freelancing Commits</div>
        <div><span class="stat-value">${(totalFreelancingMins / 60).toFixed(1)}</span><span class="stat-unit">hrs/week</span></div>
        <div class="stat-sub">Fixed work periods</div>
      </div>
    `;
  }

  // Global functions for inline HTML calls
  window.openAddBlock = (day) => {
    document.getElementById('blockDay').value = day;
    document.getElementById('blockModalTitle').textContent = `${day} - Add Busy Period`;
    document.getElementById('blockStart').value = '09:00';
    document.getElementById('blockEnd').value = '17:00';
    document.getElementById('blockLabel').value = '';
    document.getElementById('blockModal').classList.add('active');
  };

  window.deleteBlock = (day, id) => {
    state.schedule[day] = state.schedule[day].filter(b => b.id !== id);
    saveState();
    renderWeekTab();
  };

  // -- TASKS TAB --
  function renderTasksTab() {
    const list = document.getElementById('taskList');
    list.innerHTML = '';

    let filteredTasks = state.tasks;
    if (currentTaskFilter !== 'all') {
      filteredTasks = state.tasks.filter(t => t.status === currentTaskFilter);
    }

    // Sort: Urgent first, then closest deadline
    filteredTasks.sort((a, b) => {
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

    if (filteredTasks.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🍃</div>
          <p>Koi tasks nahi hain yahan.</p>
        </div>
      `;
      return;
    }

    filteredTasks.forEach(t => {
      const daysLeft = getDaysUntil(t.deadline);
      let dlClass = daysLeft < 0 ? 'overdue' : '';
      let dlText = daysLeft < 0 ? `Overdue by ${Math.abs(daysLeft)}d` : daysLeft === 0 ? 'Due Today' : `Due in ${daysLeft}d`;

      const div = document.createElement('div');
      div.className = `task-card ${t.complexity} ${t.urgent ? 'urgent' : ''} ${t.status === 'completed' ? 'completed' : ''}`;
      div.innerHTML = `
        <div class="tc-top">
          <div class="tc-name">${t.name}</div>
          <div class="tc-actions">
            <button class="tc-btn" title="Focus Timer" onclick="window.startPomoForTask('${t.name}')">⏱️</button>
            <button class="tc-btn" title="Mark Done" onclick="window.toggleTaskStatus('${t.id}')">${t.status === 'completed' ? '↺' : '✓'}</button>
            <button class="tc-btn" style="color:var(--red)" onclick="window.deleteTask('${t.id}')">✕</button>
          </div>
        </div>
        <div class="tc-meta">
          <span class="badge badge-${t.complexity}">${t.complexity === 'easy' ? '😊 Easy' : '🧠 Hard'}</span>
          <span class="badge badge-time">⏱️ ${t.hours}h</span>
          ${t.price ? `<span class="badge" style="background:#10b981;color:#fff">💰 ${state.profile.currency} ${t.price}</span>` : ''}
          <span class="badge badge-deadline ${dlClass}">📅 ${dlText}</span>
          ${t.status === 'in-progress' ? '<span class="badge" style="background:var(--yellow);color:#000">In Progress</span>' : ''}
        </div>
        ${t.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:8px">${t.notes}</div>` : ''}
      `;
      list.appendChild(div);
    });
  }

  window.toggleTaskStatus = (id) => {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
      task.status = task.status === 'completed' ? 'pending' : 'completed';
      saveState();
      updateUI();
    }
  };

  window.deleteTask = (id) => {
    if(confirm('Are you sure you want to delete this task?')) {
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveState();
      updateUI();
    }
  };

  window.startPomoForTask = (name) => {
    document.getElementById('pomodoroWidget').classList.remove('hidden');
    document.getElementById('pomoTaskLabel').textContent = name;
  };

  // -- SCHEDULE GENERATOR --
  function generateSchedule() {
    const out = document.getElementById('scheduleOutput');
    out.innerHTML = '<div style="text-align:center;padding:40px"><span style="font-size:40px">⚙️</span><p>Optimizing schedule...</p></div>';
    
    setTimeout(() => {
      // 1. Get all pending tasks
      let pendingTasks = state.tasks.filter(t => t.status !== 'completed');
      
      // Sort tasks: Urgent -> Deadline closest
      pendingTasks.sort((a, b) => {
        if (a.urgent && !b.urgent) return -1;
        if (!a.urgent && b.urgent) return 1;
        return new Date(a.deadline) - new Date(b.deadline);
      });

      let scheduleHtml = '';
      let unscheduled = [];
      let clonedTasks = JSON.parse(JSON.stringify(pendingTasks)); // For tracking remaining hours

      DAYS.forEach(day => {
        const stats = calculateFreeTime(day);
        let freeHours = stats.freeMins / 60;
        let daySlots = [];

        while (freeHours > 0 && clonedTasks.length > 0) {
          // Find next task
          let task = clonedTasks[0];
          
          if (task.complexity === 'hard') {
            // Hard task: solo
            let timeAllocated = Math.min(task.hours, freeHours);
            daySlots.push({
              type: 'solo', complexity: 'hard',
              tasks: [task],
              hours: timeAllocated
            });
            task.hours -= timeAllocated;
            freeHours -= timeAllocated;
            if (task.hours <= 0) clonedTasks.shift();
          } else {
            // Easy task: look for multitasking opportunities
            let multiTasks = [task];
            clonedTasks.shift();
            
            // Find another easy task
            if (clonedTasks.length > 0 && clonedTasks[0].complexity === 'easy') {
              multiTasks.push(clonedTasks.shift());
            }

            if (multiTasks.length === 1) {
              let t1 = multiTasks[0];
              let timeAllocated = Math.min(t1.hours, freeHours);
              daySlots.push({
                type: 'solo', complexity: 'easy',
                tasks: [t1],
                hours: timeAllocated
              });
              t1.hours -= timeAllocated;
              freeHours -= timeAllocated;
              if (t1.hours > 0) clonedTasks.unshift(t1);
            } else {
              // Multitasking 2 tasks!
              let t1 = multiTasks[0];
              let t2 = multiTasks[1];
              // Multitasking takes 1.5x of the max time
              let maxH = Math.max(t1.hours, t2.hours);
              let requiredTime = maxH * 1.5;
              
              let timeAllocated = Math.min(requiredTime, freeHours);
              daySlots.push({
                type: 'multi',
                tasks: [t1, t2],
                hours: timeAllocated
              });
              
              // Proportionally reduce their remaining hours
              let pctDone = timeAllocated / requiredTime;
              t1.hours -= (t1.hours * pctDone);
              t2.hours -= (t2.hours * pctDone);
              
              freeHours -= timeAllocated;
              
              // Put back if not finished
              if (t2.hours > 0.1) clonedTasks.unshift(t2);
              if (t1.hours > 0.1) clonedTasks.unshift(t1);
              
              // Sort again to maintain deadline priority
              clonedTasks.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
            }
          }
        }

        // Render Day
        let slotsHtml = daySlots.map(s => {
          if (s.type === 'multi') {
            return `
              <div class="sched-slot multi">
                <div class="slot-icon">🤹</div>
                <div class="slot-info">
                  <div class="slot-tasks">${s.tasks.map(t => t.name).join(' + ')}</div>
                  <div class="slot-meta">Multitasking (1.5x efficiency)</div>
                </div>
                <div class="slot-hours">${s.hours.toFixed(1)}h</div>
              </div>
            `;
          } else {
            return `
              <div class="sched-slot solo ${s.complexity}">
                <div class="slot-icon">${s.complexity === 'hard' ? '🧠' : '😊'}</div>
                <div class="slot-info">
                  <div class="slot-tasks">${s.tasks[0].name}</div>
                  <div class="slot-meta">Focused Work</div>
                </div>
                <div class="slot-hours">${s.hours.toFixed(1)}h</div>
              </div>
            `;
          }
        }).join('');

        if (daySlots.length === 0) {
          slotsHtml = `<div class="sched-no-tasks">Koi tasks nahi schedule kiye gaye aaj. Enjoy your free time! 🎉</div>`;
        }

        scheduleHtml += `
          <div class="sched-day">
            <div class="sched-day-header">
              <span class="sched-day-name">${day}</span>
              <span class="sched-day-free">Free Time Used: ${((stats.freeMins/60) - freeHours).toFixed(1)}h / ${(stats.freeMins/60).toFixed(1)}h</span>
            </div>
            <div class="sched-slots">
              ${slotsHtml}
            </div>
          </div>
        `;
      });

      if (clonedTasks.length > 0) {
        scheduleHtml += `
          <div class="sched-warn">
            ⚠️ <strong>Warning:</strong> Tumhare paas is hafte poore tasks karne ka time nahi hai! Kuch tasks next week shift honge ya deadlines miss ho sakti hain.
          </div>
        `;
      }

      out.innerHTML = scheduleHtml;
    }, 800);
  }

  // -- ANALYTICS TAB --
  function renderAnalyticsTab() {
    const out = document.getElementById('analyticsOutput');
    
    const totalTasks = state.tasks.length;
    const completedTasks = state.tasks.filter(t => t.status === 'completed').length;
    const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    let totalHoursLogged = 0;
    let estEarnings = 0;

    state.tasks.filter(t => t.status === 'completed').forEach(t => {
      totalHoursLogged += t.hours;
      if (t.price && t.price > 0) {
        estEarnings += t.price;
      } else {
        estEarnings += t.hours * (state.profile.rate || 0);
      }
    });

    out.innerHTML = `
      <div class="earnings-highlight">
        <div class="e-label">Estimated Earnings (Completed Tasks)</div>
        <div class="e-value">${state.profile.currency} ${estEarnings.toLocaleString()}</div>
      </div>
      
      <div class="analytics-grid">
        <div class="anal-card">
          <div class="stat-label">Tasks Completed</div>
          <div class="stat-value">${completedTasks} <span style="font-size:14px;color:var(--text3)">/ ${totalTasks}</span></div>
        </div>
        <div class="anal-card">
          <div class="stat-label">Hours Logged</div>
          <div class="stat-value">${totalHoursLogged.toFixed(1)}h</div>
        </div>
        <div class="anal-card">
          <div class="stat-label">Hourly Rate</div>
          <div class="stat-value" style="font-size:24px">${state.profile.currency} ${state.profile.rate}/h</div>
        </div>
      </div>

      <div class="progress-section">
        <h3>Task Progress by Category</h3>
        ${['coding', 'design', 'writing', 'meeting', 'other'].map(cat => {
          const catTasks = state.tasks.filter(t => t.category === cat);
          if(catTasks.length === 0) return '';
          const catDone = catTasks.filter(t => t.status === 'completed').length;
          const pct = Math.round((catDone / catTasks.length) * 100);
          return `
            <div class="prog-row">
              <div class="prog-label" style="text-transform:capitalize">${cat}</div>
              <div class="prog-bar-bg">
                <div class="prog-bar-fill" style="width:${pct}%"></div>
              </div>
              <div class="prog-pct">${pct}%</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Go!
  init();
});
