const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const chatEl = document.getElementById("chat");
const patEl = document.getElementById("pat");
const rememberPatEl = document.getElementById("rememberPat");
const modelEl = document.getElementById("model");
const pttBtn = document.getElementById("ptt");
const enableBtn = document.getElementById("enableDevices");
const speakerSelectEl = document.getElementById("speakerSelect");
const speakTestBtn = document.getElementById("speakTest");
const audioOut = document.getElementById("audioOut");
const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com/chat/completions";
const TEST_TONE_GAIN = 0.05;
const TEST_TONE_FREQUENCY = 880;
const TEST_TONE_SECONDS = 0.25;
const TEST_TONE_BUFFER_SECONDS = 0.25;
const MODEL_TEMPERATURE = 0.4;
const MODEL_MAX_TOKENS = 500;
let messages = [{ role: "system", content: "You are Jarvis: concise, capable, and helpful." }];

let mediaStream;
let audioContext;
let analyser;
let animationId;
let speechRecognition;
let interimTranscript = "";
let finalTranscript = "";
let testToneContext;
let toneDestination;
let isListening = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = `${role.toUpperCase()}: ${content}`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function drawIdle() {
  const w = canvas.width;
  const h = canvas.height;
  const r = Math.min(w, h) * 0.18;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#020912";
  ctx.fillRect(0, 0, w, h);

  const centerX = w / 2;
  const centerY = h / 2;

  ctx.strokeStyle = "#1f9aff66";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, r * 2.3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#4cc0ff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawVisualizer() {
  if (!analyser) {
    drawIdle();
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const innerRadius = Math.min(w, h) * 0.2;
  const bars = 120;

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#020912";
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2;
    const mag = data[i] / 255;
    const barLen = 12 + mag * 80;
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barLen);
    const y2 = cy + Math.sin(angle) * (innerRadius + barLen);

    ctx.strokeStyle = `hsla(${190 + mag * 40}, 100%, ${55 + mag * 20}%, 0.85)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.strokeStyle = "#46baff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius - 4, 0, Math.PI * 2);
  ctx.stroke();

  animationId = requestAnimationFrame(drawVisualizer);
}

async function initAudioDevices() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone not supported in this browser (page must be served over HTTPS).");
    }
    // Create AudioContext synchronously within the user-gesture context, before
    // any await.  iOS Safari drops the user-gesture flag after the first async
    // suspension point and will refuse to create an AudioContext afterwards.
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    if (!animationId) drawVisualizer();
    await loadOutputDevices();
    setStatus("Microphone ready");
  } catch (error) {
    let message = error.message;
    if (error.name === "NotAllowedError") {
      message = "Microphone permission denied. Please allow access in your browser settings.";
    } else if (error.name === "NotFoundError") {
      message = "No microphone found on this device.";
    } else if (error.name === "NotSupportedError") {
      message = "Microphone not supported. Page must be served over HTTPS.";
    }
    addMessage("system", `Microphone unavailable: ${message}`);
    setStatus("Mic unavailable");
  }
}

async function loadOutputDevices() {
  speakerSelectEl.innerHTML = "";
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  if (!outputs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Default Speaker";
    speakerSelectEl.appendChild(option);
    return;
  }
  outputs.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.deviceId;
    option.textContent = output.label || "Speaker";
    speakerSelectEl.appendChild(option);
  });
}

async function setAudioOutputDevice() {
  const deviceId = speakerSelectEl.value;
  if (deviceId && typeof audioOut.setSinkId === "function") {
    await audioOut.setSinkId(deviceId);
  }
}

async function ensureToneOutput() {
  if (!testToneContext) {
    testToneContext = new AudioContext();
    toneDestination = testToneContext.createMediaStreamDestination();
    audioOut.srcObject = toneDestination.stream;
  }
  if (testToneContext.state === "suspended") {
    await testToneContext.resume();
  }
  try {
    await audioOut.play();
  } catch (error) {
    // User gesture is required in some browsers; click event usually satisfies this.
    console.debug("Audio output play() not ready yet:", error);
  }
}

async function testSpeaker() {
  try {
    await setAudioOutputDevice();
    await ensureToneOutput();
    const oscillator = testToneContext.createOscillator();
    const gain = testToneContext.createGain();
    gain.gain.value = TEST_TONE_GAIN;
    oscillator.type = "sine";
    oscillator.frequency.value = TEST_TONE_FREQUENCY;
    oscillator.connect(gain).connect(toneDestination);
    oscillator.start();
    oscillator.stop(testToneContext.currentTime + TEST_TONE_SECONDS);
    setTimeout(() => {
      try {
        oscillator.disconnect();
        gain.disconnect();
        // Pause the audio element so it stops playing the silent MediaStream
        // after the tone finishes — otherwise it plays (silently) indefinitely.
        audioOut.pause();
      } catch (error) {
        console.debug("Test tone cleanup skipped:", error);
      }
    }, (TEST_TONE_SECONDS + TEST_TONE_BUFFER_SECONDS) * 1000);
    setStatus("Speaker test played");
  } catch (error) {
    addMessage("system", `Speaker test failed: ${error.message}`);
  }
}

function buildSpeechRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (event) => {
    interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += `${text} `;
      else interimTranscript += text;
    }
    transcriptEl.textContent = `${finalTranscript}${interimTranscript}`.trim() || "—";
  };
  rec.onerror = (event) => {
    isListening = false;
    addMessage("system", `Speech recognition error: ${event.error}`);
    setStatus("Error");
  };
  // Process the captured transcript only after recognition fully stops.
  // Reading transcripts immediately after stop() is a race condition on mobile —
  // the browser may not have delivered the final onresult event yet.
  rec.onend = () => {
    const wasListening = isListening;
    isListening = false;
    const text = `${finalTranscript}${interimTranscript}`.trim();
    if (!text) {
      if (wasListening) setStatus("No speech captured");
      return;
    }
    addMessage("user", text);
    setStatus("Thinking");
    savePatIfNeeded();
    callGitHubModel(text)
      .then((reply) => {
        addMessage("assistant", reply);
        speak(reply);
        setStatus("Idle");
      })
      .catch((error) => {
        addMessage("system", error.message);
        setStatus("Error");
      });
  };
  return rec;
}

async function callGitHubModel(userText) {
  const token = patEl.value.trim();
  if (!token) throw new Error("PAT is required.");

  messages.push({ role: "user", content: userText });
  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model: modelEl.value,
      messages,
      temperature: MODEL_TEMPERATURE,
      max_tokens: MODEL_MAX_TOKENS
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub Models request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const assistantText = typeof content === "string" ? content.trim() : "";
  if (!assistantText) throw new Error("Model returned empty response.");
  messages.push({ role: "assistant", content: assistantText });
  return assistantText;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  // Cancel any pending or active speech before queuing a new utterance.
  // Without this, iOS loops the speech indefinitely due to a known browser bug.
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onstart = () => setStatus("Speaking");
  utterance.onend = () => setStatus("Idle");
  speechSynthesis.speak(utterance);
}

function savePatIfNeeded() {
  if (rememberPatEl.checked && patEl.value) {
    sessionStorage.setItem("jarvis_pat", patEl.value);
  } else {
    sessionStorage.removeItem("jarvis_pat");
  }
}

function beginTalk() {
  // Do NOT await initAudioDevices here — awaiting before speechRecognition.start()
  // breaks the iOS requirement that start() must be called synchronously within a
  // user-gesture handler. initAudioDevices is only needed for the visualizer.
  if (!mediaStream) initAudioDevices();
  if (!speechRecognition) speechRecognition = buildSpeechRecognition();
  if (!speechRecognition) {
    addMessage("system", "SpeechRecognition is unsupported in this browser.");
    return;
  }
  finalTranscript = "";
  interimTranscript = "";
  transcriptEl.textContent = "Listening…";
  pttBtn.classList.add("active");
  setStatus("Listening");
  isListening = true;
  try {
    speechRecognition.start();
  } catch (err) {
    addMessage("system", `Could not start recognition: ${err.message}`);
  }
}

function endTalk() {
  pttBtn.classList.remove("active");
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (err) {
      // Recognition may have already stopped (e.g. timed out); ignore.
    }
  }
  // Transcript processing has moved to the speechRecognition.onend handler so
  // that we wait for the browser to deliver all final results before reading them.
}

enableBtn.addEventListener("click", initAudioDevices);
speakTestBtn.addEventListener("click", testSpeaker);
speakerSelectEl.addEventListener("change", setAudioOutputDevice);
rememberPatEl.addEventListener("change", savePatIfNeeded);

pttBtn.addEventListener("mousedown", beginTalk);
pttBtn.addEventListener("mouseup", endTalk);
pttBtn.addEventListener("mouseleave", () => {
  if (pttBtn.classList.contains("active")) endTalk();
});
pttBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  beginTalk();
}, { passive: false });
pttBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  endTalk();
}, { passive: false });

const savedPat = sessionStorage.getItem("jarvis_pat");
if (savedPat) {
  rememberPatEl.checked = true;
  patEl.value = savedPat;
}

drawIdle();
