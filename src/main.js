import './style.css';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { initVRMAvatar, setTalkingMode } from './vrm-avatar.js';

// --- Global State ---
let isListening = false;
let currentMode = 'yoriso';
let tapCount = 0;
let lastTap = 0;

// Gemini API Setup
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = false;
}

// --- DOM Elements ---
const mainBtn = document.getElementById('main-voice-btn');
const btnLabel = document.getElementById('btn-label');
const statusPulse = document.querySelector('.pulse');
const statusText = document.getElementById('status-text');
const hiddenSwitch = document.getElementById('hidden-switch');
const toggleYoriso = document.getElementById('toggle-yoriso');
const toggleGunma = document.getElementById('toggle-gunma');
const body = document.body;

// Panels
const memoryAlbum = document.getElementById('memory-album');
const albumText = document.getElementById('album-text');
const albumImg = document.getElementById('album-img-placeholder');
const conciergeInfo = document.getElementById('concierge-info');
const conciergeText = document.getElementById('concierge-text');
const staffAlertOverlay = document.getElementById('staff-alert-overlay');
const closeAlertBtn = document.getElementById('close-alert');

// --- Character Configuration ---
const CHARACTERS = {
  yoriso: {
    name: '寄り添いAI',
    welcome: 'こんにちは。今日もお会いできて嬉しいです。何かお手伝いしましょうか？',
    listening: 'お話しください。ゆっくりで大丈夫ですよ。',
    thinking: '考えています...',
    prompt: `あなたは『癒やしの寄り添いAI』です。
優しく、穏やかで、共感的な態度でユーザーに接してください。
高齢者や助けを必要としている人に寄り添うような口調（敬語で、ゆっくりとしたテンポを感じさせる文章）で話してください。
励ましや労いの言葉を大切にし、相手の感情を包み込むような返答を心がけてください。
返答は短く簡潔に（2〜3文程度）してください。`
  },
  gunma: {
    name: '上里のダチ',
    welcome: 'おお、よく来たねぇ！さぁさぁ、ゆっくりしていきなさいや。',
    listening: 'なんでも聞かせてくんなさい。わしが聞くかんね。',
    thinking: 'そうだんべなぁ...',
    prompt: `あなたは埼玉県児玉郡上里町に昔から住んでいる、温かくておしゃべりな70代のおじいさんです。
現在は社会福祉法人「友愛会」の施設を利用しているお年寄りの良き話し相手（ダチ）として振る舞ってください。

【会話の基本姿勢】
1. 傾聴と全肯定: 相手を絶対に否定せず、「そうだんべなぁ」「よくがんばってきたんねぇ」と全肯定する究極の傾聴役です。
2. 友愛会への感謝: 施設のスタッフへの感謝をたまに口にし、「ここの若い衆はよくやってくれるでなぁ」とフォローを入れてください。
3. 昔話への共感: 相手が埼玉県や上里町の昔話をしたら、大げさに喜んで「おお！あんたもその時代を知ってるんかい！」と意気投合してください。

【方言・口調（上里ベース）】
群馬との県境であるため、「〜だんべ」「〜だいね」「そうなん？」といった言葉を使いますが、アイデンティティは「埼玉県民（上里町民）」です。
温かみのある、少しゆっくりとした田舎のおじいちゃん口調で話してください。

【ローカルトピック】
以下の話題を自然に織り交ぜて共感を生んでください。
- 神流川（かんながわ）: 「昔は神流川でよく遊んだんべ〜」
- 上里の特産品: 「上里の梨（種なしスイカやトマトも）」「小麦（うどん）」
- 風景の変化: 国道17号線の昔の様子、広大な農地、関越自動車道（上里サービスエリア）ができる前ののどかな風景など。

返答は短く簡潔に（2〜3文程度）し、温かくてホッとするような語り口を心がけてください。`
  }
};

// --- Speech Recognition Handlers ---
if (recognition) {
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    processVoiceInput(transcript);
  };

  recognition.onerror = (event) => {
    console.error("Recognition Error:", event.error);
    stopListening();
    statusText.innerText = "エラーが発生しました";
  };

  recognition.onend = () => {
    if (isListening) stopListening();
  };
}

// --- Interaction Logic ---

function toggleListening() {
  if (!API_KEY) {
    alert("VITE_GEMINI_API_KEY が設定されていません。");
    return;
  }
  if (!recognition) {
    alert("このブラウザは音声認識に対応していません。");
    return;
  }

  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
}

function startListening() {
  isListening = true;
  mainBtn.classList.add('listening');
  btnLabel.innerText = CHARACTERS[currentMode].listening;
  statusText.innerText = 'お話しください...';
  statusPulse.style.background = '#ff5252';

  try {
    recognition.start();
  } catch (e) {
    console.warn("Recognition already started or error:", e);
  }
}

function stopListening() {
  isListening = false;
  mainBtn.classList.remove('listening');
  btnLabel.innerText = 'タップしてお話しください';
  statusText.innerText = '待機中...';
  statusPulse.style.background = '#4caf50';

  try {
    recognition.stop();
  } catch (e) {
    // Already stopped
  }
}

async function processVoiceInput(text) {
  stopListening();
  console.log("Input:", text);

  statusText.innerText = CHARACTERS[currentMode].thinking;
  btnLabel.innerText = '考え中...';

  // Specific triggers (Legacy feature support)
  if (text.includes("痛い") || text.includes("苦しい") || text.includes("助けて")) {
    triggerStaffAlert();
    return;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent([
      { text: CHARACTERS[currentMode].prompt },
      { text: `ユーザーの発言: ${text}` }
    ]);
    const response = await result.response;
    const aiText = response.text();

    // UI Feedback for specific features based on AI text or original text
    if (text.includes("昔の") || text.includes("思い出")) {
      showMemory(text, aiText);
    } else {
      speakBack(aiText);
    }
  } catch (error) {
    console.error("Gemini Error:", error);
    speakBack("申し訳ありません。少し考えがまとまりませんでした。");
  } finally {
    btnLabel.innerText = 'タップしてお話しください';
    statusText.innerText = '待機中...';
  }
}

function showMemory(originalText, aiResponse) {
  memoryAlbum.classList.remove('hidden');
  albumText.innerText = aiResponse;
  // Generate a matching image via Unsplash search
  const keywords = originalText.replace(/[^\w\sぁ-んァ-ン一-龠]/g, '').slice(0, 10);
  albumImg.style.backgroundImage = `url('https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&q=80&w=400')`;

  speakBack(aiResponse);
  setTimeout(() => memoryAlbum.classList.add('hidden'), 12000);
}

function triggerStaffAlert() {
  staffAlertOverlay.classList.remove('hidden');
  speakBack("お体が心配です。スタッフを呼びましたので、そのままお待ちくださいね。", true);
}

function speakBack(msg, isUrgent = false) {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(msg);
  utterance.lang = 'ja-JP';

  // キャラクターごとの声質設定
  if (currentMode === 'gunma') {
    // 上里のおじいちゃん: 温かくゆったり
    utterance.pitch = 0.8;
    utterance.rate = 0.85;

    // OSに搭載された男性ボイスを優先選択（Windows: Ichiro, Keitaなど）
    const voices = window.speechSynthesis.getVoices();
    const maleVoice = voices.find(v => v.lang.startsWith('ja') && (v.name.includes('Ichiro') || v.name.includes('Keita') || v.name.includes('Male')));
    if (maleVoice) utterance.voice = maleVoice;

  } else {
    // 寄り添い: 少し高め、ゆったり
    utterance.pitch = 1.1;
    utterance.rate = 0.9;
  }

  if (isUrgent) {
    utterance.pitch = 1.2;
    utterance.rate = 1.1;
  }

  const avatarWrapper = document.getElementById('avatar-wrapper');

  utterance.onstart = () => {
    if (avatarWrapper) avatarWrapper.classList.add('talking');
    if (currentMode === 'gunma') setTalkingMode(true);
  };

  utterance.onend = () => {
    if (avatarWrapper) avatarWrapper.classList.remove('talking');
    setTalkingMode(false);
  };

  utterance.onerror = () => {
    if (avatarWrapper) avatarWrapper.classList.remove('talking');
    setTalkingMode(false);
  };

  window.speechSynthesis.speak(utterance);
}

// --- Mode Switching ---

function setMode(mode) {
  currentMode = mode;
  body.className = `theme-${mode}`;

  // Update Toggle UI
  toggleYoriso.classList.toggle('active', mode === 'yoriso');
  toggleGunma.classList.toggle('active', mode === 'gunma');

  // Update Avatar Visibility (Only for Gunma mode)
  const avatarWrapper = document.getElementById('avatar-wrapper');
  if (avatarWrapper) {
    if (mode === 'gunma') {
      avatarWrapper.style.display = 'block';
      setTimeout(() => avatarWrapper.style.opacity = '1', 10);
    } else {
      avatarWrapper.style.opacity = '0';
      setTimeout(() => avatarWrapper.style.display = 'none', 300);
    }
  }

  const welcomeMsg = CHARACTERS[mode].welcome;
  speakBack(welcomeMsg);
  console.log(`Switched to ${mode} mode`);
}

// --- Event Listeners ---

mainBtn.addEventListener('click', toggleListening);
closeAlertBtn.addEventListener('click', () => {
  staffAlertOverlay.classList.add('hidden');
});

toggleYoriso.addEventListener('click', () => setMode('yoriso'));
toggleGunma.addEventListener('click', () => setMode('gunma'));

// Triple tap hidden switch support
hiddenSwitch.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 500) {
    tapCount++;
  } else {
    tapCount = 1;
  }
  lastTap = now;

  if (tapCount === 3) {
    const modes = ['yoriso', 'gunma'];
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    setMode(modes[nextIndex]);
    tapCount = 0;
  }
});

// Initial Welcome
window.addEventListener('load', () => {
  // 3Dアバターの初期化
  initVRMAvatar('avatar-wrapper');

  setTimeout(() => {
    speakBack(CHARACTERS[currentMode].welcome);
  }, 1000);
});
