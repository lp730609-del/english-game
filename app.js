/* ==========================================
   Spelling Hero - Application Logic
   ========================================== */

// --- 狀態管理 ---
let allWords = [];       // 全部的單字資料
let units = [];          // 劃分好的單元清單
let currentUser = null;  // 當前登入的使用者 Profile
let currentUnit = null;  // 當前進入的單元
let currentMode = '';    // 當前的遊戲模式 ('learn', 'spelling-bee', 'multiple-choice', 'memory-match')
let todayDateStr = '';   // 今天的日期字串 (YYYY-MM-DD)

// 學習計時相關
let timerInterval = null;
let elapsedSeconds = 0;
let lastSavedTime = 0;

// 遊戲遊玩相關
let gameQuestions = [];
let currentGameIndex = 0;
let score = 0;
let consecutiveCorrect = 0;

// 記憶翻牌模式專用狀態
let firstFlippedCard = null;
let secondFlippedCard = null;
let lockBoard = false;
let matchedPairsCount = 0;

// Web Speech API
const synth = window.speechSynthesis;
let englishVoice = null;

// --- 初始化 Web Speech 語音 ---
function initVoices() {
  if (!synth) return;
  const voices = synth.getVoices();
  // 優先尋找美式英語 (en-US)
  englishVoice = voices.find(v => v.lang === 'en-US' || v.lang.includes('en_US')) || 
                 voices.find(v => v.lang.startsWith('en')) || 
                 voices[0];
}
if (synth) {
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = initVoices;
  }
  initVoices();
}

// 語音播放輔助函數
function speak(text, callback) {
  if (!synth) return;
  synth.cancel(); // 停止目前播放
  const utterance = new SpeechSynthesisUtterance(text);
  if (englishVoice) {
    utterance.voice = englishVoice;
  }
  utterance.lang = 'en-US';
  utterance.rate = 0.85; // 稍微慢一點，適合小朋友聽
  if (callback) {
    utterance.onend = callback;
  }
  synth.speak(utterance);
}

// 逐字母朗讀 + 完整朗讀 (用於拼字王模式答對時)
function speakLetterByLetter(word, callback) {
  if (!synth) return;
  const cleanWord = word.replace(/[^a-zA-Z]/g, ''); // 去除特殊字元與空格
  const spelledText = cleanWord.split('').join('-') + `, ${word}`;
  speak(spelledText, callback);
}

// 取得今天日期的字串 (格式 YYYY-MM-DD)
function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- 頁面切換控制 ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(scr => {
    scr.classList.remove('active');
  });
  const activeScreen = document.getElementById(screenId);
  activeScreen.classList.add('active');
  
  // 進入不同畫面時，觸發特定初始化
  if (screenId === 'login-screen') {
    loadProfilesToUI();
  } else if (screenId === 'menu-screen') {
    updateHeaderUI();
    renderUnitsGrid();
    renderThemeFilters();
  } else if (screenId === 'parent-screen') {
    renderParentDashboard();
  }
}

// --- Canvas 粒子特效 (金幣/星星飄散) ---
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.size = Math.random() * 8 + 4;
    this.speedX = Math.random() * 8 - 4;
    this.speedY = Math.random() * -10 - 5;
    this.gravity = 0.4;
    this.color = color;
    this.alpha = 1;
    this.decay = Math.random() * 0.015 + 0.015;
  }
  update() {
    this.speedY += this.gravity;
    this.x += this.speedX;
    this.y += this.speedY;
    this.alpha -= this.decay;
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function spawnParticles(x, y, count = 30) {
  const colors = ['#ffd700', '#ffae00', '#ffeb60', '#ff9c00']; // 金色漸層
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    particles.push(new Particle(x, y, color));
  }
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter(p => p.alpha > 0);
  particles.forEach(p => {
    p.update();
    p.draw();
  });
  requestAnimationFrame(animateParticles);
}
requestAnimationFrame(animateParticles);

// --- 音效播放輔助 ---
function playSound(audioId) {
  const snd = document.getElementById(audioId);
  if (snd) {
    snd.currentTime = 0;
    snd.play().catch(() => {}); // 避免未互動前播放失敗錯誤
  }
}

// ==========================================
// 學習時間與資料庫存取 (LocalStorage)
// ==========================================

function getProfilesFromStorage() {
  const data = localStorage.getItem('spelling_hero_profiles');
  return data ? JSON.parse(data) : {};
}

function saveProfilesToStorage(profiles) {
  localStorage.setItem('spelling_hero_profiles', JSON.stringify(profiles));
}

// 啟動學習計時器
function startLearningTimer() {
  if (timerInterval) clearInterval(timerInterval);
  elapsedSeconds = 0;
  lastSavedTime = 0;
  
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    // 每 10 秒自動備份一次時間數據，避免中斷
    if (elapsedSeconds - lastSavedTime >= 10) {
      saveTimeRecord();
    }
  }, 1000);
}

// 停止計時並儲存
function stopLearningTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  saveTimeRecord();
}

// 將當前累計時間寫入當前使用者的 localStorage
function saveTimeRecord() {
  if (!currentUser) return;
  
  const secondsToSave = elapsedSeconds - lastSavedTime;
  if (secondsToSave <= 0) return;
  
  const profiles = getProfilesFromStorage();
  const userProfile = profiles[currentUser.name];
  if (!userProfile) return;
  
  todayDateStr = getTodayString();
  
  if (!userProfile.dailyStats) userProfile.dailyStats = {};
  if (!userProfile.dailyStats[todayDateStr]) {
    userProfile.dailyStats[todayDateStr] = { time_seconds: 0, completed_today: [] };
  }
  
  userProfile.dailyStats[todayDateStr].time_seconds += secondsToSave;
  
  // 更新當前在記憶體中的使用者狀態
  currentUser.dailyStats = userProfile.dailyStats;
  lastSavedTime = elapsedSeconds;
  
  saveProfilesToStorage(profiles);
}

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbytFWSkoap5P-FsjB1y2CJuuYBjwWBd-LzV7fNxJLxC0rJQjrmbjMRhAVPFS75DRkxF/exec";

function getProfilesFromStorage() {
  const data = localStorage.getItem('spelling_hero_profiles');
  return data ? JSON.parse(data) : {};
}

function saveProfilesToStorage(profiles) {
  localStorage.setItem('spelling_hero_profiles', JSON.stringify(profiles));
  // 異步同步到雲端試算表
  if (currentUser && profiles[currentUser.name]) {
    saveUserToCloud(profiles[currentUser.name]);
  }
}

function saveUserToCloud(userObj) {
  if (!userObj) return;
  fetch(GAS_API_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(userObj)
  }).catch(err => console.warn("Cloud sync failed:", err));
}

function syncProfilesFromCloud() {
  fetch(GAS_API_URL)
    .then(res => res.json())
    .then(cloudProfiles => {
      if (cloudProfiles && Object.keys(cloudProfiles).length > 0) {
        const localProfiles = getProfilesFromStorage();
        const mergedProfiles = { ...localProfiles };
        
        Object.keys(cloudProfiles).forEach(name => {
          const cloudU = cloudProfiles[name];
          const localU = localProfiles[name];
          
          if (!localU) {
            mergedProfiles[name] = cloudU;
          } else {
            // 合併進度，以完成單元數較多為準
            const cloudCompleted = cloudU.completedUnits ? cloudU.completedUnits.length : 0;
            const localCompleted = localU.completedUnits ? localU.completedUnits.length : 0;
            if (cloudCompleted >= localCompleted) {
              mergedProfiles[name] = cloudU;
            }
          }
        });
        
        localStorage.setItem('spelling_hero_profiles', JSON.stringify(mergedProfiles));
        
        if (currentUser && mergedProfiles[currentUser.name]) {
          currentUser = mergedProfiles[currentUser.name];
          updateHeaderUI();
        }
        
        // 重新渲染畫面
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen.classList.contains('active')) {
          loadProfilesToUI();
        } else {
          renderUnitsGrid();
        }
      }
    })
    .catch(err => console.warn("Cloud read failed:", err));
}

// 監聽網頁關閉/重新整理，安全保存時間
window.addEventListener('beforeunload', () => {
  saveTimeRecord();
});

// ==========================================
// Profile 管理與登入 UI
// ==========================================

function loadProfilesToUI() {
  const profiles = getProfilesFromStorage();
  const profileListEl = document.getElementById('profile-list');
  profileListEl.innerHTML = '';
  
  const names = Object.keys(profiles);
  if (names.length === 0) {
    profileListEl.innerHTML = `<p class="no-data-msg">目前尚無角色，請點擊下方按鈕建立一個！</p>`;
    return;
  }
  
  names.forEach(name => {
    const p = profiles[name];
    const card = document.createElement('div');
    card.className = 'profile-card glass-panel';
    
    // 計算總進度
    const totalUnits = units.length;
    const completedCount = p.completedUnits ? p.completedUnits.length : 0;
    const progressPct = totalUnits > 0 ? Math.round((completedCount / totalUnits) * 100) : 0;
    
    const avatarEmoji = getAvatarEmoji(p.avatar);
    
    card.innerHTML = `
      <span class="profile-avatar">${avatarEmoji}</span>
      <div class="profile-name">${name}</div>
      <div class="profile-progress">進度 ${progressPct}%</div>
    `;
    
    card.addEventListener('click', () => {
      loginAsUser(name);
    });
    
    profileListEl.appendChild(card);
  });
}

function getAvatarEmoji(avatarName) {
  const mapping = {
    owl: '🦉',
    fox: '🦊',
    lion: '🦁',
    panda: '🐼',
    koala: '🐨',
    cat: '🐱'
  };
  return mapping[avatarName] || '🦉';
}

function loginAsUser(name) {
  const profiles = getProfilesFromStorage();
  currentUser = profiles[name];
  playSound('snd-click');
  showScreen('menu-screen');
  startLearningTimer();
}

// ==========================================
// 單元劃分與篩選 (Data Processing)
// ==========================================

function processWordsData(words) {
  allWords = words;
  
  // 依照原本的主題順序分組，在各個主題內以 13 個單字切分為 Unit
  const wordsByTheme = {};
  words.forEach(w => {
    if (!wordsByTheme[w.theme]) {
      wordsByTheme[w.theme] = [];
    }
    wordsByTheme[w.theme].push(w);
  });
  
  units = [];
  let globalUnitId = 1;
  
  // 遍歷主題
  Object.keys(wordsByTheme).forEach(themeName => {
    const themeWords = wordsByTheme[themeName];
    const unitSize = 13; // 一個單元大約 12-15 個單字，選定 13 為基準
    const totalWordsInTheme = themeWords.length;
    const numUnits = Math.ceil(totalWordsInTheme / unitSize);
    
    for (let i = 0; i < numUnits; i++) {
      const startIdx = i * unitSize;
      const endIdx = Math.min(startIdx + unitSize, totalWordsInTheme);
      const unitWords = themeWords.slice(startIdx, endIdx);
      
      // 給這些單字標記 unitId
      unitWords.forEach(w => {
        w.unitId = globalUnitId;
      });
      
      // 建立單元名稱
      let displayTitle = themeName;
      if (numUnits > 1) {
        displayTitle += ` (${i + 1})`;
      }
      
      units.push({
        id: globalUnitId,
        theme: themeName,
        title: displayTitle,
        words: unitWords
      });
      
      globalUnitId++;
    }
  });
}

// 更新頂部使用者資訊
function updateHeaderUI() {
  if (!currentUser) return;
  document.getElementById('header-username').innerText = currentUser.name;
  document.getElementById('header-avatar').innerText = getAvatarEmoji(currentUser.avatar);
  document.getElementById('header-level').innerText = currentUser.level || 1;
  document.getElementById('header-coins').innerText = currentUser.coins || 0;
  
  const xp = currentUser.xp || 0;
  const level = currentUser.level || 1;
  const xpNeeded = level * 100;
  document.getElementById('header-xp').innerText = `${xp}/${xpNeeded}`;
  
  const wrongCount = currentUser.wrongWords ? currentUser.wrongWords.length : 0;
  document.getElementById('header-wrong-count').innerText = wrongCount;
}

// 渲染主題篩選邊邊欄
function renderThemeFilters() {
  const filterList = document.getElementById('theme-filter-list');
  // 保留「全部主題」
  filterList.innerHTML = `<li class="active" data-theme="all">全部主題</li>`;
  
  const uniqueThemes = [...new Set(units.map(u => u.theme))];
  uniqueThemes.forEach(theme => {
    const li = document.createElement('li');
    li.setAttribute('data-theme', theme);
    li.innerText = theme;
    li.addEventListener('click', () => {
      document.querySelectorAll('#theme-filter-list li').forEach(item => {
        item.classList.remove('active');
      });
      li.classList.add('active');
      renderUnitsGrid(theme);
    });
    filterList.appendChild(li);
  });
  
  // 綁定「全部主題」的點擊
  filterList.querySelector('li[data-theme="all"]').addEventListener('click', (e) => {
    document.querySelectorAll('#theme-filter-list li').forEach(item => {
      item.classList.remove('active');
    });
    e.target.classList.add('active');
    renderUnitsGrid();
  });
}

// 渲染單元卡片
function renderUnitsGrid(themeFilter = 'all') {
  const grid = document.getElementById('unit-grid');
  grid.innerHTML = '';
  
  const filteredUnits = themeFilter === 'all' ? units : units.filter(u => u.theme === themeFilter);
  
  filteredUnits.forEach(u => {
    const card = document.createElement('div');
    card.className = 'unit-card glass-panel';
    
    const isCompleted = currentUser.completedUnits && currentUser.completedUnits.includes(u.id);
    
    let statusIcon = '<span class="unit-status unstarted"><i class="fa-regular fa-circle-play"></i></span>';
    if (isCompleted) {
      statusIcon = '<span class="unit-status completed"><i class="fa-solid fa-circle-check"></i></span>';
    }
    
    card.innerHTML = `
      <div>
        <span class="unit-theme-lbl">${u.theme}</span>
        <h4>${u.title}</h4>
      </div>
      <div class="unit-card-footer">
        <span class="unit-words-count">${u.words.length} 個單字</span>
        ${statusIcon}
      </div>
    `;
    
    card.addEventListener('click', () => {
      enterUnit(u);
    });
    
    grid.appendChild(card);
  });
}

// ==========================================
// 遊戲核心邏輯 (Learning & Playing)
// ==========================================

function enterUnit(unit) {
  currentUnit = unit;
  playSound('snd-click');
  
  // 初始化遊戲面板
  document.getElementById('game-unit-title').innerText = unit.title;
  document.getElementById('game-progress-bar').style.width = '0%';
  document.getElementById('game-score-count').innerText = `0 / ${unit.words.length}`;
  
  // 載入單字到記憶卡模式
  currentGameIndex = 0;
  score = 0;
  consecutiveCorrect = 0;
  
  showScreen('game-screen');
  startLearnMode();
}

// --- 記憶卡學習模式 (Learn Mode) ---
function startLearnMode() {
  currentMode = 'learn';
  document.querySelectorAll('.game-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('panel-learn').classList.add('active');
  
  // 檢查是否已通關過
  const isCompleted = currentUser.completedUnits && currentUser.completedUnits.includes(currentUnit.id);
  const skipBtn = document.getElementById('btn-learn-skip');
  if (isCompleted) {
    skipBtn.classList.remove('hidden');
  } else {
    skipBtn.classList.add('hidden');
  }
  
  showLearnCard();
}

function showLearnCard() {
  const word = currentUnit.words[currentGameIndex];
  document.getElementById('learn-card-index').innerText = currentGameIndex + 1;
  document.getElementById('learn-card-total').innerText = currentUnit.words.length;
  
  document.getElementById('learn-english').innerText = word.english;
  document.getElementById('learn-chinese').innerText = word.chinese;
  document.getElementById('learn-phonetic').innerText = word.phonetic || '';
  
  // 更新進度條
  const pct = Math.round((currentGameIndex / currentUnit.words.length) * 100);
  document.getElementById('game-progress-bar').style.width = `${pct}%`;
  
  // 是否自動播放語音
  const autoSpeak = document.getElementById('chk-auto-speak').checked;
  if (autoSpeak) {
    speak(word.english);
  }
}

// 記憶卡控制按鈕
document.getElementById('btn-learn-speak').addEventListener('click', () => {
  const word = currentUnit.words[currentGameIndex];
  speak(word.english);
});

document.getElementById('btn-learn-prev').addEventListener('click', () => {
  if (currentGameIndex > 0) {
    currentGameIndex--;
    playSound('snd-click');
    showLearnCard();
  }
});

document.getElementById('btn-learn-next').addEventListener('click', () => {
  if (currentGameIndex < currentUnit.words.length - 1) {
    currentGameIndex++;
    playSound('snd-click');
    showLearnCard();
  } else {
    // 記憶閱讀結束，解鎖遊戲挑戰模式選擇
    playSound('snd-levelup');
    showModeSelect();
  }
});

document.getElementById('btn-learn-skip').addEventListener('click', () => {
  playSound('snd-click');
  showModeSelect();
});

// --- 遊戲模式選擇 (Mode Select) ---
function showModeSelect() {
  currentMode = 'mode-select';
  document.getElementById('game-progress-bar').style.width = '100%';
  document.querySelectorAll('.game-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('panel-mode-select').classList.add('active');
}

// 點選挑戰模式卡片
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    const selectedMode = card.getAttribute('data-mode');
    startChallenge(selectedMode);
  });
});

function startChallenge(mode) {
  currentMode = mode;
  currentGameIndex = 0;
  score = 0;
  consecutiveCorrect = 0;
  
  // 打亂題目順序
  gameQuestions = [...currentUnit.words];
  shuffleArray(gameQuestions);
  
  document.querySelectorAll('.game-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('game-score-count').innerText = `0 / ${gameQuestions.length}`;
  document.getElementById('game-progress-bar').style.width = '0%';
  
  if (mode === 'spelling-bee') {
    document.getElementById('panel-game-spelling').classList.add('active');
    initSpellingBeeQuestion();
  } else if (mode === 'multiple-choice') {
    document.getElementById('panel-game-choice').classList.add('active');
    initChoiceQuestion();
  } else if (mode === 'memory-match') {
    document.getElementById('panel-game-match').classList.add('active');
    initMemoryMatch();
  }
}

// --- C. 拼字王模式 (Spelling Bee) 邏輯 ---
function initSpellingBeeQuestion() {
  const q = gameQuestions[currentGameIndex];
  
  // 清空輸入
  const inputField = document.getElementById('spelling-input-field');
  inputField.value = '';
  
  // 隱藏中文提示
  document.getElementById('spelling-chinese-hint').classList.add('hidden');
  document.getElementById('btn-show-spelling-hint').classList.remove('hidden');
  document.getElementById('spelling-chinese-hint').innerText = q.chinese;
  
  // 生成首尾提示文字
  const hintText = generateSpellingMask(q.english);
  document.getElementById('spelling-prompt').innerText = hintText;
  
  // 延遲發音，給孩子準備時間
  setTimeout(() => {
    speak(q.english);
  }, 300);
  
  // 自動聚焦輸入框 (電腦版)
  inputField.focus();
}

// 生成例如 b _ _ _ _ _ _ _ l
function generateSpellingMask(word) {
  // 移去可能的空格和括號干擾，僅針對核心拼寫進行處理，或是只遮蔽字母
  const letters = word.split('');
  const mask = [];
  
  for (let i = 0; i < letters.length; i++) {
    const char = letters[i];
    // 若不是字母 (如括號、逗號、底線)，則直接顯示
    if (!/[a-zA-Z]/.test(char)) {
      mask.push(char);
      continue;
    }
    
    // 首尾判定
    if (i === 0) {
      mask.push(char);
    } else if (i === letters.length - 1) {
      // 若長度大於 2 且是最後一個字元，顯示
      if (word.length > 2) {
        mask.push(char);
      } else {
        // 長度小於等於 2 時，最後一個字元是底線
        mask.push('_');
      }
    } else {
      // 中間的字元是底線
      mask.push('_');
    }
  }
  
  return mask.join(' ');
}

// 重播發音
document.getElementById('btn-spelling-repeat-speak').addEventListener('click', () => {
  const q = gameQuestions[currentGameIndex];
  speak(q.english);
});

// 中文提示切換
document.getElementById('btn-show-spelling-hint').addEventListener('click', (e) => {
  e.target.classList.add('hidden');
  document.getElementById('spelling-chinese-hint').classList.remove('hidden');
});

// 虛擬鍵盤點擊輸入
document.querySelectorAll('.key').forEach(keyBtn => {
  keyBtn.addEventListener('click', (e) => {
    playSound('snd-click');
    const key = e.target.getAttribute('data-key');
    const inputField = document.getElementById('spelling-input-field');
    
    if (key === 'backspace') {
      inputField.value = inputField.value.slice(0, -1);
    } else if (key === 'enter') {
      submitSpellingAnswer();
    } else {
      inputField.value += key;
    }
    inputField.focus();
  });
});

// 實體鍵盤綁定 Enter 與一般字母
document.getElementById('spelling-input-field').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitSpellingAnswer();
  }
});

function submitSpellingAnswer() {
  const q = gameQuestions[currentGameIndex];
  const userAnswer = document.getElementById('spelling-input-field').value.trim().toLowerCase();
  const correctAnswer = q.english.trim().toLowerCase();
  
  // 去除所有可能的不規則標點干擾 (如 sleep slept slept 對比拼寫)
  // 如果是動詞三態，答案是完整的三態，例如 "sleep slept slept"
  if (userAnswer === correctAnswer) {
    // 答對
    score++;
    consecutiveCorrect++;
    playSound('snd-correct');
    
    // 金幣粒子動畫
    const rect = document.getElementById('spelling-prompt').getBoundingClientRect();
    spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 20);
    
    // 拼讀語音回饋
    speakLetterByLetter(q.english, () => {
      // 語音播放完才進下一題
      nextChallengeQuestion();
    });
  } else {
    // 答錯
    playSound('snd-wrong');
    addWrongWord(q);
    
    // 顯示紅色錯誤並告知答案
    const spellingPrompt = document.getElementById('spelling-prompt');
    spellingPrompt.innerHTML = `<span style="color:var(--danger)">錯誤！答案是: ${q.english}</span>`;
    
    // 朗讀正確答案
    speak(q.english);
    
    setTimeout(() => {
      nextChallengeQuestion();
    }, 2500); // 留 2.5 秒給孩子看正確答案
  }
}

// --- D. 選擇題模式 (Multiple Choice) 邏輯 ---
function initChoiceQuestion() {
  const q = gameQuestions[currentGameIndex];
  const isEngQuestion = Math.random() > 0.5; // 隨機出英翻中或中翻英
  
  const speakBtn = document.getElementById('btn-choice-speak');
  if (isEngQuestion) {
    document.getElementById('choice-question-title').innerText = q.english;
    speakBtn.classList.remove('hidden');
    speak(q.english);
  } else {
    document.getElementById('choice-question-title').innerText = q.chinese;
    speakBtn.classList.add('hidden');
  }
  
  // 生成干擾選項 (必須從所有單字中選取 non-overlapping 的 3 個)
  const options = [q];
  const otherWords = allWords.filter(w => w.english !== q.english);
  shuffleArray(otherWords);
  
  let optIndex = 0;
  while (options.length < 4 && optIndex < otherWords.length) {
    const candidate = otherWords[optIndex];
    // 確保干擾項不與正確答案的中文/英文重複
    if (!options.some(o => o.chinese === candidate.chinese || o.english === candidate.english)) {
      options.push(candidate);
    }
    optIndex++;
  }
  
  // 打亂 4 個選項
  shuffleArray(options);
  
  const optionsGrid = document.getElementById('choice-options-grid');
  optionsGrid.innerHTML = '';
  
  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn glass-panel';
    btn.innerText = isEngQuestion ? opt.chinese : opt.english;
    
    btn.addEventListener('click', () => {
      // 鎖定按鈕，防止重複點擊
      document.querySelectorAll('.choice-btn').forEach(b => b.style.pointerEvents = 'none');
      
      const isCorrect = opt.english === q.english;
      if (isCorrect) {
        score++;
        btn.classList.add('correct');
        playSound('snd-correct');
        const rect = btn.getBoundingClientRect();
        spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 15);
        speak(q.english);
        setTimeout(nextChallengeQuestion, 1200);
      } else {
        btn.classList.add('wrong');
        playSound('snd-wrong');
        addWrongWord(q);
        
        // 將正確答案標成綠色
        document.querySelectorAll('.choice-btn').forEach(b => {
          if (b.innerText === (isEngQuestion ? q.chinese : q.english)) {
            b.classList.add('correct');
          }
        });
        
        speak(q.english);
        setTimeout(nextChallengeQuestion, 2000);
      }
    });
    
    optionsGrid.appendChild(btn);
  });
}

document.getElementById('btn-choice-speak').addEventListener('click', () => {
  const q = gameQuestions[currentGameIndex];
  speak(q.english);
});

// --- E. 翻牌記憶對對碰 (Memory Match) 邏輯 ---
function initMemoryMatch() {
  const board = document.getElementById('memory-board');
  board.innerHTML = '';
  
  // 從單元中隨機挑選 6 個單字 (共 12 張牌)
  const matchWords = [...currentUnit.words];
  shuffleArray(matchWords);
  const selectedWords = matchWords.slice(0, 6);
  
  // 建立牌組
  let cards = [];
  selectedWords.forEach(w => {
    cards.push({ id: w.english, type: 'english', text: w.english });
    cards.push({ id: w.english, type: 'chinese', text: w.chinese });
  });
  
  shuffleArray(cards);
  
  firstFlippedCard = null;
  secondFlippedCard = null;
  lockBoard = false;
  matchedPairsCount = 0;
  
  cards.forEach(c => {
    const cardEl = document.createElement('div');
    cardEl.className = 'memory-card';
    cardEl.setAttribute('data-id', c.id);
    cardEl.setAttribute('data-type', c.type);
    
    cardEl.innerHTML = `
      <div class="card-inner">
        <div class="card-front">?</div>
        <div class="card-back">${c.text}</div>
      </div>
    `;
    
    cardEl.addEventListener('click', flipCard);
    board.appendChild(cardEl);
  });
}

function flipCard() {
  if (lockBoard) return;
  if (this === firstFlippedCard) return;
  
  playSound('snd-click');
  this.classList.add('flipped');
  
  if (this.getAttribute('data-type') === 'english') {
    speak(this.querySelector('.card-back').innerText);
  }
  
  if (!firstFlippedCard) {
    firstFlippedCard = this;
    return;
  }
  
  secondFlippedCard = this;
  checkForMatch();
}

function checkForMatch() {
  const id1 = firstFlippedCard.getAttribute('data-id');
  const id2 = secondFlippedCard.getAttribute('data-id');
  
  const isMatch = id1 === id2;
  
  if (isMatch) {
    disableCards();
  } else {
    unflipCards();
  }
}

function disableCards() {
  lockBoard = true;
  playSound('snd-correct');
  
  const rect = secondFlippedCard.getBoundingClientRect();
  spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 10);
  
  setTimeout(() => {
    firstFlippedCard.classList.add('matched');
    secondFlippedCard.classList.add('matched');
    
    matchedPairsCount++;
    // 更新虛擬進度
    const pct = Math.round((matchedPairsCount / 6) * 100);
    document.getElementById('game-progress-bar').style.width = `${pct}%`;
    document.getElementById('game-score-count').innerText = `${matchedPairsCount} / 6`;
    
    resetBoard();
    
    if (matchedPairsCount === 6) {
      score = 6;
      setTimeout(showGameResult, 600);
    }
  }, 600);
}

function unflipCards() {
  lockBoard = true;
  playSound('snd-wrong');
  
  setTimeout(() => {
    firstFlippedCard.classList.remove('flipped');
    secondFlippedCard.classList.remove('flipped');
    resetBoard();
  }, 1200);
}

function resetBoard() {
  [firstFlippedCard, secondFlippedCard] = [null, null];
  lockBoard = false;
}

// --- 通用進度遞進與結算 ---
function nextChallengeQuestion() {
  currentGameIndex++;
  
  // 更新進度 UI
  const pct = Math.round((currentGameIndex / gameQuestions.length) * 100);
  document.getElementById('game-progress-bar').style.width = `${pct}%`;
  document.getElementById('game-score-count').innerText = `${score} / ${gameQuestions.length}`;
  
  if (currentGameIndex < gameQuestions.length) {
    if (currentMode === 'spelling-bee') {
      initSpellingBeeQuestion();
    } else if (currentMode === 'multiple-choice') {
      initChoiceQuestion();
    }
  } else {
    showGameResult();
  }
}

function showGameResult() {
  // 計算本單元是否判定為「完成」
  // 只要挑戰有答題（答對達 60% 以上，或是記憶配對成功），即判定完成該單元
  const passThreshold = currentMode === 'memory-match' ? 1.0 : 0.6;
  const isPass = (score / gameQuestions.length) >= passThreshold;
  
  let coinGain = 10;
  let xpGain = 20;
  
  if (isPass) {
    coinGain = 25; // 順利過關獎勵
    xpGain = 50;
    
    // 記錄完成單元
    if (!currentUser.completedUnits) currentUser.completedUnits = [];
    if (!currentUser.completedUnits.includes(currentUnit.id)) {
      currentUser.completedUnits.push(currentUnit.id);
      
      // 記錄到本日完成單元
      todayDateStr = getTodayString();
      if (!currentUser.dailyStats) currentUser.dailyStats = {};
      if (!currentUser.dailyStats[todayDateStr]) {
        currentUser.dailyStats[todayDateStr] = { time_seconds: 0, completed_today: [] };
      }
      if (!currentUser.dailyStats[todayDateStr].completed_today.includes(currentUnit.id)) {
        currentUser.dailyStats[todayDateStr].completed_today.push(currentUnit.id);
      }
    }
  }
  
  // 給予獎勵
  currentUser.coins = (currentUser.coins || 0) + coinGain;
  currentUser.xp = (currentUser.xp || 0) + xpGain;
  
  // 檢查是否升級
  let levelUp = false;
  const nextLvlXp = (currentUser.level || 1) * 100;
  if (currentUser.xp >= nextLvlXp) {
    currentUser.xp -= nextLvlXp;
    currentUser.level = (currentUser.level || 1) + 1;
    levelUp = true;
  }
  
  // 儲存進度
  const profiles = getProfilesFromStorage();
  profiles[currentUser.name] = currentUser;
  saveProfilesToStorage(profiles);
  
  // 顯示結算畫面
  document.querySelectorAll('.game-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('panel-result').classList.add('active');
  
  document.getElementById('result-coin-gain').innerText = coinGain;
  document.getElementById('result-xp-gain').innerText = xpGain;
  
  if (levelUp) {
    document.getElementById('level-up-box').classList.remove('hidden');
    document.getElementById('level-up-val').innerText = currentUser.level;
    playSound('snd-levelup');
  } else {
    document.getElementById('level-up-box').classList.add('hidden');
    playSound('snd-correct');
  }
  
  // 特效
  const w = window.innerWidth;
  const h = window.innerHeight;
  spawnParticles(w / 2, h / 2, 40);
}

// 結束返回單元列表
document.getElementById('btn-result-to-menu').addEventListener('click', () => {
  playSound('snd-click');
  showScreen('menu-screen');
});

document.getElementById('btn-exit-game').addEventListener('click', () => {
  playSound('snd-click');
  stopLearningTimer();
  showScreen('menu-screen');
  startLearningTimer();
});

// ==========================================
// 錯題本 (Wrong Words Book) 邏輯
// ==========================================

function addWrongWord(word) {
  if (!currentUser.wrongWords) currentUser.wrongWords = [];
  // 避免重複加入
  if (!currentUser.wrongWords.some(w => w.english === word.english)) {
    currentUser.wrongWords.push({
      english: word.english,
      chinese: word.chinese,
      theme: word.theme
    });
  }
}

// 顯示錯題本 UI
document.getElementById('btn-show-wrong-words').addEventListener('click', () => {
  playSound('snd-click');
  const modal = document.getElementById('wrong-words-modal');
  modal.classList.remove('hidden');
  
  const listEl = document.getElementById('wrong-words-list');
  listEl.innerHTML = '';
  
  const wrongWords = currentUser.wrongWords || [];
  if (wrongWords.length === 0) {
    listEl.innerHTML = `<p class="no-data-msg">目前沒有錯題！您太厲害了！</p>`;
    document.getElementById('btn-start-review').classList.add('hidden');
    return;
  }
  
  document.getElementById('btn-start-review').classList.remove('hidden');
  
  wrongWords.forEach((w, index) => {
    const item = document.createElement('div');
    item.className = 'wrong-word-item';
    item.innerHTML = `
      <div>
        <span class="wrong-word-eng">${w.english}</span>
        <span class="wrong-word-chi">(${w.chinese})</span>
      </div>
      <button class="btn btn-icon btn-sm btn-remove-wrong" data-index="${index}" title="移出錯題本">
        <i class="fa-solid fa-trash-can" style="color:var(--danger)"></i>
      </button>
    `;
    
    // 綁定刪除錯題按鈕
    item.querySelector('.btn-remove-wrong').addEventListener('click', (e) => {
      e.stopPropagation();
      removeWrongWordByIndex(index);
    });
    
    listEl.appendChild(item);
  });
});

function removeWrongWordByIndex(index) {
  currentUser.wrongWords.splice(index, 1);
  // 儲存
  const profiles = getProfilesFromStorage();
  profiles[currentUser.name] = currentUser;
  saveProfilesToStorage(profiles);
  playSound('snd-click');
  
  // 重新渲染列表
  document.getElementById('btn-show-wrong-words').click();
  updateHeaderUI();
}

// 關閉錯題本 modal
document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('wrong-words-modal').classList.add('hidden');
  });
});

// 開始錯題複習挑戰
document.getElementById('btn-start-review').addEventListener('click', () => {
  document.getElementById('wrong-words-modal').classList.add('hidden');
  
  // 建立一個虛擬的單元 (魔王關卡)
  const mockUnit = {
    id: 9999, // 錯題本專屬虛擬 ID
    title: '魔王複習挑戰',
    theme: '錯題複習',
    words: [...currentUser.wrongWords]
  };
  
  // 答對的單字在挑戰完成後會移出錯題本
  enterUnit(mockUnit);
});

// ==========================================
// 家長監控面板 (Parent Dashboard)
// ==========================================

function renderParentDashboard() {
  const profiles = getProfilesFromStorage();
  const summaryGrid = document.getElementById('parent-summary-grid');
  const tbody = document.getElementById('parent-stats-tbody');
  
  summaryGrid.innerHTML = '';
  tbody.innerHTML = '';
  
  const names = Object.keys(profiles);
  if (names.length === 0) {
    summaryGrid.innerHTML = `<p class="no-data-msg">目前沒有學習數據，請先建立角色開始學習。</p>`;
    return;
  }
  
  // 1. 渲染角色學習卡片
  names.forEach(name => {
    const p = profiles[name];
    const completedCount = p.completedUnits ? p.completedUnits.length : 0;
    const totalUnitsCount = units.length;
    const progressPct = totalUnitsCount > 0 ? Math.round((completedCount / totalUnitsCount) * 100) : 0;
    
    // 計算累計學習時間 (所有 dailyStats 的時間加總)
    let totalSeconds = 0;
    if (p.dailyStats) {
      Object.keys(p.dailyStats).forEach(date => {
        totalSeconds += p.dailyStats[date].time_seconds || 0;
      });
    }
    const totalMinutes = Math.round(totalSeconds / 60);
    
    const card = document.createElement('div');
    card.className = 'parent-card glass-panel';
    card.innerHTML = `
      <div class="parent-card-header">
        <span class="parent-avatar">${getAvatarEmoji(p.avatar)}</span>
        <div>
          <h3>${name} 的學習進度</h3>
          <p style="color:var(--text-secondary)">LV ${p.level || 1} ∙ 金幣: ${p.coins || 0}</p>
        </div>
      </div>
      <div class="parent-progress-stats">
        <div class="stat-item">
          <span class="stat-val">${progressPct}%</span>
          <span class="stat-lbl">單元完成率 (${completedCount}/${totalUnitsCount})</span>
        </div>
        <div class="stat-item">
          <span class="stat-val">${totalMinutes} 分鐘</span>
          <span class="stat-lbl">累計讀單字時間</span>
        </div>
      </div>
      <div>
        <p style="font-weight:700; margin-bottom:5px;">常錯生字本 (${p.wrongWords ? p.wrongWords.length : 0} 個):</p>
        <div style="font-size:0.9rem; color:var(--text-secondary); max-height: 80px; overflow-y:auto;">
          ${p.wrongWords && p.wrongWords.length > 0 ? p.wrongWords.map(w => w.english).join(', ') : '無'}
        </div>
      </div>
    `;
    summaryGrid.appendChild(card);
  });
  
  // 2. 渲染每日學習表格
  // 我們將所有的每日記錄攤平，按日期倒序排列
  const allRecords = [];
  names.forEach(name => {
    const p = profiles[name];
    if (p.dailyStats) {
      Object.keys(p.dailyStats).forEach(date => {
        const stats = p.dailyStats[date];
        allRecords.push({
          name: name,
          date: date,
          time_seconds: stats.time_seconds || 0,
          completed_today: stats.completed_today || []
        });
      });
    }
  });
  
  // 按日期由新到舊排序
  allRecords.sort((a, b) => b.date.localeCompare(a.date));
  
  if (allRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);">尚無每日數據記錄。</td></tr>`;
    return;
  }
  
  allRecords.forEach(rec => {
    const tr = document.createElement('tr');
    
    // 計算分鐘與秒
    const min = Math.floor(rec.time_seconds / 60);
    const sec = rec.time_seconds % 60;
    const timeStr = min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
    
    // 渲染完成單元標籤
    let unitTags = '無';
    if (rec.completed_today.length > 0) {
      unitTags = rec.completed_today.map(id => {
        const u = units.find(unit => unit.id === id);
        const title = u ? u.title : `Unit ${id}`;
        return `<span class="completed-badge">${title}</span>`;
      }).join(' ');
    }
    
    tr.innerHTML = `
      <td style="font-weight:700;">${rec.name}</td>
      <td>${rec.date}</td>
      <td style="color:var(--primary-light); font-weight:700;">${timeStr}</td>
      <td>${unitTags}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 事件綁定 (UI Events)
// ==========================================

// 登出切換角色
document.getElementById('btn-logout').addEventListener('click', () => {
  playSound('snd-click');
  stopLearningTimer();
  currentUser = null;
  showScreen('login-screen');
});

// 前往家長看板
document.getElementById('btn-show-parent-dash').addEventListener('click', () => {
  playSound('snd-click');
  showScreen('parent-screen');
});

// 返回登入
document.querySelectorAll('.btn-go-login').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('snd-click');
    showScreen('login-screen');
  });
});

// 新增角色模態框顯示與隱藏
document.getElementById('btn-show-add-profile').addEventListener('click', () => {
  playSound('snd-click');
  document.getElementById('add-profile-modal').classList.remove('hidden');
  document.getElementById('new-profile-name').value = '';
});

document.getElementById('btn-cancel-add').addEventListener('click', () => {
  playSound('snd-click');
  document.getElementById('add-profile-modal').classList.add('hidden');
});

// 頭像選擇點擊
document.querySelectorAll('.avatar-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.avatar-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  });
});

// 確認建立新角色
document.getElementById('btn-create-profile').addEventListener('click', () => {
  const nameInput = document.getElementById('new-profile-name');
  const name = nameInput.value.trim();
  
  if (!name) {
    alert('請輸入角色名字！');
    return;
  }
  
  const profiles = getProfilesFromStorage();
  if (profiles[name]) {
    alert('這個名字已經存在囉，請換一個！');
    return;
  }
  
  const selectedAvatarOpt = document.querySelector('.avatar-opt.active');
  const avatar = selectedAvatarOpt ? selectedAvatarOpt.getAttribute('data-avatar') : 'owl';
  
  // 建立全新 Profile
  profiles[name] = {
    name: name,
    avatar: avatar,
    coins: 0,
    level: 1,
    xp: 0,
    completedUnits: [],
    wrongWords: [],
    dailyStats: {}
  };
  
  saveProfilesToStorage(profiles);
  saveUserToCloud(profiles[name]); // 同步新建角色至雲端
  playSound('snd-levelup');
  
  // 關閉 Modal 並重新載入
  document.getElementById('add-profile-modal').classList.add('hidden');
  loadProfilesToUI();
});

// ==========================================
// 輔助工具 (Utility Functions)
// ==========================================

// Fisher-Yates 洗牌演算法
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// ==========================================
// 應用程式起點 (Bootstrap)
// ==========================================

function initApp() {
  // 1. 讀取 words_db.json
  fetch('words_db.json')
    .then(res => {
      if (!res.ok) throw new Error('無法載入單字資料庫！');
      return res.json();
    })
    .then(data => {
      // 2. 劃分單元
      processWordsData(data);
      
      // 3. 進入登入畫面，並在背景進行一次雲端同步
      showScreen('login-screen');
      syncProfilesFromCloud();
    })
    .catch(err => {
      console.error(err);
      alert('載入單字資料庫失敗，請確認 words_db.json 是否正確放置在專案目錄下！');
    });
}

// 啟動應用程式
initApp();
