const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const chatEl = document.getElementById("chat");
const patEl = document.getElementById("pat");
const rememberPatEl = document.getElementById("rememberPat");
const modelEl = document.getElementById("model");
const testInferenceBtn = document.getElementById("testInference");
const pttBtn = document.getElementById("ptt");
const enableBtn = document.getElementById("enableDevices");
const speakerSelectEl = document.getElementById("speakerSelect");
const speakTestBtn = document.getElementById("speakTest");
const audioOut = document.getElementById("audioOut");
const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const GITHUB_MODELS_LIST_ENDPOINT = "https://models.github.ai/catalog/models";
const GITHUB_API_VERSION = "2022-11-28";
const TEST_TONE_GAIN = 0.05;
const TEST_TONE_FREQUENCY = 880;
const MODEL_TEMPERATURE = 0.4;
const MODEL_MAX_TOKENS = 500;
const MODEL_LOAD_WAIT_TIMEOUT_MS = 5000;
const TEST_INFERENCE_PROMPT = "Testing test test";
const DEFAULT_MODELS = [
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "meta/Llama-3.3-70B-Instruct",
  "mistral-ai/Mistral-Large-2411"
];
const MODEL_PREFIX_ALLOWLIST = [
  "openai/",
  "meta/",
  "mistral-ai/",
  "cohere/",
  "deepseek/",
  "microsoft/",
  "xai/",
  "ai21/"
];
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
let testToneOscillator;
let testToneGain;
let isListening = false;
let isSpeakerTestActive = false;
let isInitializingDevices = false;
let isLoadingModels = false;
let isTestingInference = false;
let lastLoadedModelsToken = "";
let lastModelLoadError = "";

function createAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Audio output is not supported in this browser.");
  }
  return new AudioContextConstructor();
}

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

function updateInferenceTestButton() {
  testInferenceBtn.disabled = isTestingInference;
  testInferenceBtn.textContent = isTestingInference ? "Testing Inference..." : "Test Model Inference";
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
  if (isInitializingDevices) return;
  isInitializingDevices = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone API not available (browser may not support it, or page must be served over HTTPS).");
    }
    if (mediaStream) {
      await loadOutputDevices();
      setStatus("Microphone ready");
      return;
    }
    if (!audioContext) {
      audioContext = createAudioContext();
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
      message = "Microphone not supported or incompatible settings.";
    }
    addMessage("system", `Microphone unavailable: ${message}`);
    setStatus("Mic unavailable");
  } finally {
    isInitializingDevices = false;
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
    testToneContext = createAudioContext();
    toneDestination = testToneContext.createMediaStreamDestination();
    audioOut.srcObject = toneDestination.stream;
  }
  if (testToneContext.state === "suspended") {
    await testToneContext.resume();
  }
  try {
    await audioOut.play();
  } catch (error) {
    console.debug("Audio output play() not ready yet:", error);
  }
}

function updateSpeakerTestButton() {
  speakTestBtn.textContent = isSpeakerTestActive ? "Stop Speaker Test" : "Test Speaker";
  speakTestBtn.setAttribute("aria-pressed", String(isSpeakerTestActive));
}

async function stopSpeakerTest() {
  if (!isSpeakerTestActive) return;
  isSpeakerTestActive = false;
  updateSpeakerTestButton();
  try {
    if (testToneOscillator) {
      testToneOscillator.stop();
      testToneOscillator.disconnect();
      testToneOscillator = undefined;
    }
    if (testToneGain) {
      testToneGain.disconnect();
      testToneGain = undefined;
    }
    audioOut.pause();
    setStatus("Speaker test stopped");
  } catch (error) {
    console.debug("Speaker test stop skipped:", error);
  }
}

async function testSpeaker() {
  try {
    if (isSpeakerTestActive) {
      await stopSpeakerTest();
      return;
    }
    await setAudioOutputDevice();
    await ensureToneOutput();
    testToneOscillator = testToneContext.createOscillator();
    testToneGain = testToneContext.createGain();
    testToneGain.gain.value = TEST_TONE_GAIN;
    testToneOscillator.type = "sine";
    testToneOscillator.frequency.value = TEST_TONE_FREQUENCY;
    testToneOscillator.connect(testToneGain).connect(toneDestination);
    testToneOscillator.start();
    isSpeakerTestActive = true;
    updateSpeakerTestButton();
    setStatus("Speaker test playing");
  } catch (error) {
    await stopSpeakerTest();
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
  rec.onend = () => {
    const wasListening = isListening;
    isListening = false;
    const text = `${finalTranscript}${interimTranscript}`.trim();
    finalTranscript = "";
    interimTranscript = "";
    transcriptEl.textContent = "—";
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
  await refreshAvailableModels({
    force: token !== lastLoadedModelsToken,
    throwOnError: false
  });

  messages.push({ role: "user", content: userText });
  const makeRequest = async () => {
    try {
      const response = await fetch(GITHUB_MODELS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
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
        let errorCode = "";
        try {
          const parsed = JSON.parse(errText);
          errorCode = parsed?.error?.code || "";
        } catch (parseError) {
        }
        const requestError = new Error(`GitHub Models request failed (${response.status}): ${errText}`);
        requestError.code = errorCode;
        requestError.status = response.status;
        throw requestError;
      }
      return response.json();
    } catch (error) {
      const isNetworkError = error instanceof TypeError;
      if (isNetworkError) {
        throw new Error(`Failed to reach GitHub Models endpoint. Check: 1) network connectivity, 2) GitHub Models service status, 3) browser extensions/privacy blockers, 4) VPN/proxy settings, 5) firewall rules. Original error: ${error.message}`);
      }
      throw error;
    }
  };

  try {
    const data = await makeRequest();
    const content = data?.choices?.[0]?.message?.content;
    const assistantText = typeof content === "string" ? content.trim() : "";
    if (!assistantText) throw new Error("Model returned empty response.");
    messages.push({ role: "assistant", content: assistantText });
    return assistantText;
  } catch (error) {
    const isUnknownModel = error?.code === "unknown_model"
      || String(error?.message || "").includes("unknown_model");
    if (!isUnknownModel) throw error;
    await refreshAvailableModels({ force: true, throwOnError: false });
    ensureValidSelectedModel();
    const data = await makeRequest();
    const content = data?.choices?.[0]?.message?.content;
    const assistantText = typeof content === "string" ? content.trim() : "";
    if (!assistantText) throw new Error("Model returned empty response.");
    messages.push({ role: "assistant", content: assistantText });
    return assistantText;
  }
}

async function runInferenceTest() {
  if (isTestingInference) return;

  const token = patEl.value.trim();
  if (!token) {
    addMessage("system", "Enter a GitHub PAT before testing model inference.");
    setStatus("PAT required");
    return;
  }

  ensureValidSelectedModel();
  const requestedModel = modelEl.value;
  isTestingInference = true;
  updateInferenceTestButton();
  savePatIfNeeded();
  setStatus("Testing inference");
  addMessage("system", `Testing inference with model ${requestedModel}.`);
  addMessage("user", TEST_INFERENCE_PROMPT);

  try {
    const reply = await callGitHubModel(TEST_INFERENCE_PROMPT);
    addMessage("assistant", reply);
    setStatus("Inference test passed");
  } catch (error) {
    addMessage("system", `Inference test failed for ${requestedModel}: ${error.message}`);
    setStatus("Inference test failed");
  } finally {
    isTestingInference = false;
    updateInferenceTestButton();
  }
}

function speak(text, onComplete) {
  if (!("speechSynthesis" in window)) {
    if (typeof onComplete === "function") onComplete();
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onstart = () => setStatus("Speaking");
  utterance.onend = () => {
    setStatus("Idle");
    if (typeof onComplete === "function") onComplete();
  };
  utterance.onerror = () => {
    setStatus("Idle");
    if (typeof onComplete === "function") onComplete();
  };
  speechSynthesis.speak(utterance);
}

function savePatIfNeeded() {
  if (rememberPatEl.checked && patEl.value) {
    sessionStorage.setItem("jarvis_pat", patEl.value);
  } else {
    sessionStorage.removeItem("jarvis_pat");
  }
}

function setModelOptions(modelIds, preferredModel) {
  const uniqueModelIds = [...new Set(modelIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!uniqueModelIds.length) return;

  const selectedModel = uniqueModelIds.includes(preferredModel)
    ? preferredModel
    : uniqueModelIds.includes(modelEl.value)
      ? modelEl.value
      : uniqueModelIds[0];

  modelEl.innerHTML = "";
  uniqueModelIds.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    modelEl.appendChild(option);
  });

  modelEl.value = selectedModel;
}

function getModelEntriesFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  return [];
}

function getModelId(model) {
  if (typeof model === "string") return model;
  if (typeof model?.id === "string") return model.id;
  if (typeof model?.name === "string") return model.name;
  return "";
}

function isSupportedChatModelId(modelId) {
  return MODEL_PREFIX_ALLOWLIST.some((prefix) => modelId.startsWith(prefix));
}

function extractModelPathFromAzureRegistryUri(uri) {
  const match = uri.match(/^azureml:\/\/registries\/[^/]+\/models\/([^/]+)\/versions\/[^/]+$/i);
  if (!match) return "";
  return match[1] || "";
}

function toGitHubModelId(modelPath) {
  if (!modelPath) return "";

  const vendorMatchers = [
    { prefix: "openai-", vendor: "openai" },
    { prefix: "meta-", vendor: "meta" },
    { prefix: "mistral-", vendor: "mistral-ai" },
    { prefix: "mistral-ai-", vendor: "mistral-ai" },
    { prefix: "cohere-", vendor: "cohere" },
    { prefix: "deepseek-", vendor: "deepseek" },
    { prefix: "microsoft-", vendor: "microsoft" },
    { prefix: "xai-", vendor: "xai" },
    { prefix: "ai21-", vendor: "ai21" }
  ];

  for (const { prefix, vendor } of vendorMatchers) {
    if (modelPath.startsWith(prefix)) {
      const remainder = modelPath.slice(prefix.length);
      if (!remainder) return "";
      return `${vendor}/${remainder}`;
    }
  }

  return "";
}

function normalizeModelId(model) {
  const raw = getModelId(model).trim();
  if (!raw) return "";

  let candidate = raw;
  if (raw.startsWith("azureml://")) {
    candidate = toGitHubModelId(extractModelPathFromAzureRegistryUri(raw));
  }

  if (!candidate) return "";
  if (!candidate.includes("/")) return "";
  if (!isSupportedChatModelId(candidate)) return "";
  return candidate;
}

function buildAvailableModelList(modelEntries) {
  return [...new Set([
    ...DEFAULT_MODELS,
    ...modelEntries.map(normalizeModelId).filter(Boolean)
  ])];
}

function ensureValidSelectedModel() {
  const options = Array.from(modelEl.options).map((option) => option.value).filter(Boolean);
  if (!options.length) {
    setModelOptions(DEFAULT_MODELS, DEFAULT_MODELS[0]);
    return;
  }
  if (!options.includes(modelEl.value)) {
    modelEl.value = options[0];
  }
}

async function waitForModelLoadToFinish() {
  const start = Date.now();
  while (isLoadingModels) {
    if (Date.now() - start >= MODEL_LOAD_WAIT_TIMEOUT_MS) {
      throw new Error("Timed out waiting for model list refresh to finish.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function refreshAvailableModels({ force = false, throwOnError = false } = {}) {
  const token = patEl.value.trim();
  if (!token) {
    lastLoadedModelsToken = "";
    setModelOptions(DEFAULT_MODELS, modelEl.value);
    return false;
  }
  if (!force && token === lastLoadedModelsToken) return true;
  if (isLoadingModels) {
    await waitForModelLoadToFinish();
    if (!force && token === lastLoadedModelsToken) return true;
  }

  isLoadingModels = true;
  try {
    const response = await fetch(GITHUB_MODELS_LIST_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const responseText = await response.text();
      const responsePreview = responseText ? responseText.slice(0, 200) : "";
      const detail = responsePreview ? ` ${responsePreview}` : "";
      throw new Error(`Failed to load models (${response.status}).${detail}`);
    }

    const data = await response.json();
    const modelEntries = getModelEntriesFromResponse(data);
    const availableModels = buildAvailableModelList(modelEntries);

    if (!availableModels.length) {
      throw new Error("No compatible chat models were returned for this token. Please verify your PAT has access to GitHub Models.");
    }

    setModelOptions(availableModels, modelEl.value);
    ensureValidSelectedModel();
    lastLoadedModelsToken = token;
    lastModelLoadError = "";
    return true;
  } catch (error) {
    const modelLoadMessage = `Model list refresh failed. ${error.message}`;
    if (modelLoadMessage !== lastModelLoadError) {
      addMessage("system", modelLoadMessage);
      lastModelLoadError = modelLoadMessage;
    }
    console.debug("Model list refresh failed:", error);
    if (throwOnError) throw error;
    return false;
  } finally {
    isLoadingModels = false;
  }
}

async function beginTalk() {
  if (!mediaStream) {
    await initAudioDevices();
    if (!mediaStream) return;
  }
  if (!speechRecognition) speechRecognition = buildSpeechRecognition();
  if (!speechRecognition) {
    addMessage("system", "SpeechRecognition is unsupported in this browser.");
    return;
  }
  if (isListening) return;
  finalTranscript = "";
  interimTranscript = "";
  transcriptEl.textContent = "Listening…";
  setStatus("Listening");
  isListening = true;
  try {
    speechRecognition.start();
  } catch (err) {
    isListening = false;
    addMessage("system", `Could not start recognition: ${err.message}`);
  }
}

function endTalk() {
  pttBtn.classList.remove("active");
  if (speechRecognition && isListening) {
    try {
      speechRecognition.stop();
    } catch (err) {
    }
  } else {
    setStatus("Idle");
  }
}

if ("PointerEvent" in window) {
  enableBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    initAudioDevices();
  });
} else {
  enableBtn.addEventListener("click", initAudioDevices);
  enableBtn.addEventListener("touchstart", (event) => {
    event.preventDefault();
    initAudioDevices();
  }, { passive: false });
}
enableBtn.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  initAudioDevices();
});
speakTestBtn.addEventListener("click", testSpeaker);
testInferenceBtn.addEventListener("click", runInferenceTest);
speakerSelectEl.addEventListener("change", setAudioOutputDevice);
rememberPatEl.addEventListener("change", savePatIfNeeded);
patEl.addEventListener("change", () => {
  savePatIfNeeded();
  refreshAvailableModels({ force: true });
});
patEl.addEventListener("blur", () => {
  refreshAvailableModels({ force: true });
});

if ("PointerEvent" in window) {
  pttBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pttBtn.classList.add("active");
    beginTalk();
  });
  pttBtn.addEventListener("pointerup", endTalk);
  pttBtn.addEventListener("pointercancel", endTalk);
  pttBtn.addEventListener("pointerleave", () => {
    if (pttBtn.classList.contains("active")) endTalk();
  });
} else {
  pttBtn.addEventListener("mousedown", () => {
    pttBtn.classList.add("active");
    beginTalk();
  });
  pttBtn.addEventListener("mouseup", endTalk);
  pttBtn.addEventListener("mouseleave", () => {
    if (pttBtn.classList.contains("active")) endTalk();
  });
  pttBtn.addEventListener("touchstart", (event) => {
    event.preventDefault();
    pttBtn.classList.add("active");
    beginTalk();
  }, { passive: false });
  pttBtn.addEventListener("touchend", (event) => {
    event.preventDefault();
    endTalk();
  }, { passive: false });
}
pttBtn.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (!pttBtn.classList.contains("active")) {
    pttBtn.classList.add("active");
    beginTalk();
  }
});
pttBtn.addEventListener("keyup", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (pttBtn.classList.contains("active")) endTalk();
});

const savedPat = sessionStorage.getItem("jarvis_pat");
if (savedPat) {
  rememberPatEl.checked = true;
  patEl.value = savedPat;
  refreshAvailableModels({ force: true });
}

updateSpeakerTestButton();
updateInferenceTestButton();
drawIdle();
