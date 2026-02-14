import { marked } from 'https://esm.sh/marked';
import JSZip from 'https://esm.sh/jszip';

console.log("Nexus Bridge UI Initializing...");

// --- State Management ---
let state = {
    backendUrl: localStorage.getItem('nexus_backendUrl') || 'http://localhost:5484',
    ollamaUrl: localStorage.getItem('nexus_ollamaUrl') || 'http://localhost:11434/api/chat',
    modelId: localStorage.getItem('nexus_modelId') || 'llama3',
    inferenceMode: localStorage.getItem('nexus_inferenceMode') || 'proxy',
    modelsPath: localStorage.getItem('nexus_modelsPath') || 'D:/ggufs',
    imageModelsPath: localStorage.getItem('nexus_imageModelsPath') || 'D:/images',
    imageModelId: localStorage.getItem('nexus_imageModelId') || '',
    imageSubfolder: localStorage.getItem('nexus_imageSubfolder') || '',
    temperature: parseFloat(localStorage.getItem('nexus_temperature') || '0.7') || 0.7,
    maxTokens: parseInt(localStorage.getItem('nexus_maxTokens') || '1024') || 1024,
    systemOverride: localStorage.getItem('nexus_systemOverride') || '',
    compactMode: localStorage.getItem('nexus_compactMode') === 'true',
    scriptMode: localStorage.getItem('nexus_scriptMode') === 'true',
    targetLang: localStorage.getItem('nexus_targetLang') || 'Roblox Lua',
    outputFilename: localStorage.getItem('nexus_outputFilename') || '',
    sessions: [],
    currentSessionId: null,
    messages: [],
    isConnected: false,
    isThinking: false
};

// --- DOM Elements ---
const dom = {
    messages: document.getElementById('chat-messages'),
    input: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    statusDot: document.getElementById('status-dot'),
    statusDetails: document.getElementById('connection-details'),
    settingsToggle: document.getElementById('settings-toggle'),
    settingsPanel: document.getElementById('settings-panel'),
    settingsBackdrop: document.getElementById('settings-backdrop'),
    closeSettings: document.getElementById('close-settings'),
    saveSettings: document.getElementById('save-settings'),
    helpBtn: document.getElementById('help-btn'),
    helpPanel: document.getElementById('help-panel'),
    closeHelp: document.getElementById('close-help'),
    helpBackdrop: document.getElementById('help-backdrop'),
    webToggle: document.getElementById('toggle-web'),
    chromeToggle: document.getElementById('toggle-chrome'),
    scriptToggle: document.getElementById('toggle-script'),
    langSelector: document.getElementById('language-selector'),
    langContainer: document.getElementById('lang-container'),
    history: document.getElementById('chat-history'),
    contextInfo: document.getElementById('context-info'),
    welcomeState: document.getElementById('welcome-state'),
    inputBackend: document.getElementById('backend-url'),
    inputOllama: document.getElementById('ollama-url'),
    inputModel: document.getElementById('model-id'),
    inputInferenceMode: document.getElementById('inference-mode'),
    inputModelsPath: document.getElementById('models-path'),
    localModelSelector: document.getElementById('local-model-selector'),
    scanModelsBtn: document.getElementById('scan-models'),
    inputImageModelsPath: document.getElementById('image-models-path'),
    imageModelSelector: document.getElementById('image-model-selector'),
    activeImageFolder: document.getElementById('active-image-folder'),
    subfolderChips: document.getElementById('subfolder-chips'),
    refreshSubfoldersBtn: document.getElementById('refresh-subfolders'),
    scanImageModelsBtn: document.getElementById('scan-image-models'),
    imageToggle: document.getElementById('toggle-image-mode'),
    proxySettings: document.getElementById('proxy-settings'),
    localSettings: document.getElementById('local-settings'),
    inputTemp: document.getElementById('input-temp'),
    inputTokens: document.getElementById('input-tokens'),
    inputSystem: document.getElementById('system-prompt-override'),
    inputCompact: document.getElementById('ui-compact'),
    inputOutputFilename: document.getElementById('output-filename'),
    tempVal: document.getElementById('temp-val'),
    tokensVal: document.getElementById('tokens-val'),
    exportData: document.getElementById('export-data'),
    clearData: document.getElementById('clear-data'),
    newChat: document.getElementById('new-chat'),
    downloadBtn: document.getElementById('download-bridge'),
    modelDisplay: document.getElementById('active-model-display')
};

// --- Initial Setup ---
async function init() {
    // Fill settings inputs
    dom.inputBackend.value = state.backendUrl;
    dom.inputOllama.value = state.ollamaUrl;
    dom.inputModel.value = state.modelId;
    dom.inputInferenceMode.value = state.inferenceMode;
    dom.inputModelsPath.value = state.modelsPath.replace(/\\/g, '/');
    dom.inputImageModelsPath.value = (state.imageModelsPath || '').replace(/\\/g, '/');
    dom.activeImageFolder.value = state.imageSubfolder || '';
    dom.inputTemp.value = state.temperature;
    dom.inputTokens.value = state.maxTokens;
    dom.inputSystem.value = state.systemOverride;
    dom.inputCompact.checked = state.compactMode;
    dom.scriptToggle.checked = state.scriptMode;
    dom.langSelector.value = state.targetLang;
    dom.inputOutputFilename.value = state.outputFilename;
    
    dom.tempVal.innerText = state.temperature;
    dom.tokensVal.innerText = state.maxTokens;
    dom.modelDisplay.innerText = state.modelId;

    applyUIState();
    checkConnection();
    setInterval(checkConnection, 5000);

    // --- Event Listeners ---
    dom.input.addEventListener('input', () => {
        dom.input.style.height = 'auto';
        dom.input.style.height = Math.min(dom.input.scrollHeight, 200) + 'px';
    });

    dom.sendBtn.addEventListener('click', handleSend);
    dom.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    dom.settingsToggle.addEventListener('click', async () => {
        dom.settingsPanel.classList.remove('hidden');
        if (state.inferenceMode === 'local') {
            await refreshLocalModels();
        }
        await refreshImageModels();
        await refreshImageSubfolders();
    });
    
    dom.closeSettings.addEventListener('click', () => dom.settingsPanel.classList.add('hidden'));
    dom.settingsBackdrop.addEventListener('click', () => dom.settingsPanel.classList.add('hidden'));
    
    dom.helpBtn.addEventListener('click', () => dom.helpPanel.classList.remove('hidden'));
    dom.closeHelp.addEventListener('click', () => dom.helpPanel.classList.add('hidden'));
    dom.helpBackdrop.addEventListener('click', () => dom.helpPanel.classList.add('hidden'));

    dom.saveSettings.addEventListener('click', () => {
        saveSettings();
        dom.settingsPanel.classList.add('hidden');
    });

    document.getElementById('example-roblox')?.addEventListener('click', () => {
        dom.input.value = 'Write a Roblox sword script';
        handleSend();
    });
    document.getElementById('example-search')?.addEventListener('click', () => {
        dom.input.value = 'Search for the latest news on AI';
        dom.webToggle.checked = true;
        handleSend();
    });

    dom.inputInferenceMode.addEventListener('change', () => {
        saveSettings();
        if (state.inferenceMode === 'local') refreshLocalModels();
    });

    dom.scanModelsBtn.addEventListener('click', async () => {
        await refreshLocalModels();
    });

    dom.scanImageModelsBtn.addEventListener('click', async () => {
        await refreshImageModels();
        await refreshImageSubfolders();
    });

    dom.refreshSubfoldersBtn.addEventListener('click', async () => {
        await refreshImageSubfolders();
    });

    dom.activeImageFolder.addEventListener('input', () => {
        state.imageSubfolder = dom.activeImageFolder.value.trim();
        saveSettings();
    });

    const inputsToWatch = [
        dom.inputBackend, dom.inputOllama, dom.inputModel, 
        dom.inputInferenceMode, dom.inputModelsPath, dom.inputImageModelsPath,
        dom.activeImageFolder,
        dom.inputTemp, dom.inputTokens, dom.inputSystem, 
        dom.inputCompact, dom.scriptToggle, dom.langSelector,
        dom.inputOutputFilename
    ];
    inputsToWatch.forEach(input => {
        const eventType = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'blur';
        input.addEventListener(eventType, saveSettings);
    });



    dom.localModelSelector.addEventListener('change', async () => {
        saveSettings();
        if (state.inferenceMode === 'local' && dom.localModelSelector.value) {
            await loadLocalModel(dom.localModelSelector.value);
        }
    });

    dom.imageModelSelector.addEventListener('change', async () => {
        saveSettings();
        if (dom.imageModelSelector.value) {
            await loadImageModel(dom.imageModelSelector.value);
        }
    });



    dom.inputTemp.oninput = (e) => {
        dom.tempVal.innerText = e.target.value;
    };
    dom.inputTokens.oninput = (e) => {
        dom.tokensVal.innerText = e.target.value;
    };

    dom.exportData.addEventListener('click', () => {
        const data = {
            settings: { ...state, sessions: undefined },
            sessions: state.sessions
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexus-export-${Date.now()}.json`;
        a.click();
    });

    dom.clearData.addEventListener('click', () => {
        if(confirm("Clear all sessions and settings?")) {
            localStorage.clear();
            location.reload();
        }
    });
    
    dom.newChat.addEventListener('click', () => {
        createNewSession();
    });

    dom.downloadBtn.addEventListener('click', async () => {
        const btn = dom.downloadBtn;
        const originalContent = btn.innerHTML;
        try {
            btn.innerHTML = '<i class="bi bi-hourglass-split animate-spin text-indigo-400"></i> <span class="hidden md:inline text-[11px] uppercase tracking-wider">Bundling Bridge...</span>';
            btn.disabled = true;
            
            const zip = new JSZip();
            const files = ['backend.py', 'requirements.txt', 'index.html', 'app.js'];
            
            const fetchPromises = files.map(async (file) => {
                try {
                    const res = await fetch(`./${file}`);
                    if (res.ok) {
                        const content = await res.text();
                        zip.file(file, content);
                        return true;
                    }
                } catch (e) {
                    console.error(`Failed to fetch ${file} for bundle`, e);
                }
                return false;
            });

            await Promise.all(fetchPromises);

            zip.file("README.txt", 
                "NEXUS LOCAL BRIDGE SETUP\n" +
                "========================\n\n" +
                "1. INSTALL PYTHON: Ensure Python 3.10+ is installed.\n" +
                "2. INSTALL DEPENDENCIES: Run 'pip install -r requirements.txt'\n" +
                "3. START THE BRIDGE: Run 'python backend.py'\n" +
                "4. RUN THE FRONTEND: Open 'index.html' in your browser.\n\n" +
                "Note: If using GGUF mode, place your .gguf files in the directory specified in settings."
            );

            const blob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "nexus-local-bridge.zip";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Download bundle error:", err);
            alert("Could not generate bundle. Please ensure you are running on a server that allows file access.");
        } finally {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }
    });

    dom.scriptToggle.addEventListener('change', () => {
        dom.langContainer.style.display = dom.scriptToggle.checked ? 'block' : 'none';
    });

    // Initial sync
    setTimeout(async () => {
        const isLive = await checkConnection();
        await syncSessions();
        if (isLive) {
            if (state.inferenceMode === 'local') await refreshLocalModels();
            await refreshImageModels();
            await refreshImageSubfolders();
            // Auto-load current models if backend has none
            try {
                const statusRes = await fetch(`${state.backendUrl}/api/status`);
                const statusData = await statusRes.json();
                
                // Auto-load LLM
                if (!statusData.loaded && state.modelId && state.inferenceMode === 'local') {
                    console.log("Backend LLM idle, auto-initializing:", state.modelId);
                    await loadLocalModel(state.modelId);
                }

                // Auto-load Image Model
                if (!statusData.image_loaded && state.imageModelId) {
                    console.log("Backend SD idle, auto-initializing:", state.imageModelId);
                    await loadImageModel(state.imageModelId);
                }
            } catch (e) { console.warn("Initial model sync failed", e); }
        }
    }, 500);
}

// --- Functions ---

async function syncSessions() {
    if (!state.isConnected) return;
    try {
        const res = await fetch(`${state.backendUrl}/sessions`);
        if (res.ok) {
            state.sessions = await res.json();
            renderHistory();
        }
    } catch (e) {
        console.error("Failed to sync sessions", e);
    }
}

async function saveSessionsToBackend() {
    if (!state.isConnected) return;
    try {
        await fetch(`${state.backendUrl}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.sessions)
        });
    } catch (e) {
        console.error("Failed to save sessions to backend", e);
    }
}

function createNewSession() {
    const id = Date.now().toString();
    const newSession = {
        id,
        title: "New Session",
        timestamp: new Date().toISOString(),
        messages: []
    };
    state.sessions.unshift(newSession);
    state.currentSessionId = id;
    state.messages = [];
    renderMessages();
    renderHistory();
    saveSessionsToBackend();
}

function loadSession(id) {
    const session = state.sessions.find(s => s.id === id);
    if (session) {
        state.currentSessionId = id;
        state.messages = [...session.messages];
        renderMessages();
        renderHistory();
    }
}

async function checkConnection() {
    const start = performance.now();
    try {
        const res = await fetch(`${state.backendUrl}/api/status`, { mode: 'cors' });
        const data = await res.json();
        state.isConnected = res.ok;
        const end = performance.now();
        document.getElementById('ping-val').innerText = `${Math.round(end - start)}ms`;
        
        if (data.current_model && state.inferenceMode === 'local') {
            dom.modelDisplay.innerText = data.current_model;
            state.modelId = data.current_model;
        }
    } catch (err) {
        state.isConnected = false;
        document.getElementById('ping-val').innerText = '---';
    }
    
    if (state.isConnected) {
        dom.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-500 pulse-accent';
        dom.statusDetails.innerText = 'NEXUS LINK ACTIVE';
        dom.statusDetails.classList.replace('text-gray-500', 'text-green-500');
        try {
            const url = new URL(state.backendUrl);
            document.getElementById('footer-status').innerText = `Connected to ${url.host} • Privacy Shield Active`;
        } catch(e) {}
    } else {
        dom.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        dom.statusDetails.innerText = 'BRIDGE OFFLINE';
        dom.statusDetails.classList.replace('text-green-500', 'text-gray-500');
    }
}

async function refreshLocalModels() {
    if (!state.isConnected) return;
    try {
        const url = new URL(`${state.backendUrl}/api/models`);
        if (state.modelsPath) url.searchParams.append('path', state.modelsPath);
        
        const res = await fetch(url);
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
            if (data.models.length === 0) {
                dom.localModelSelector.innerHTML = '<option value="">No models found in folder</option>';
            } else {
                dom.localModelSelector.innerHTML = data.models.map(m => `<option value="${m}" ${m === state.modelId ? 'selected' : ''}>${m}</option>`).join('');
            }
            if (data.models.length > 0 && !dom.localModelSelector.value) {
                dom.localModelSelector.value = data.models[0];
            }
        }
    } catch (e) {
        console.error("Failed to fetch models", e);
    }
}

async function refreshImageModels() {
    if (!state.isConnected) return;
    try {
        const url = new URL(`${state.backendUrl}/api/image-models`);
        if (state.imageModelsPath) url.searchParams.append('path', state.imageModelsPath);
        
        const res = await fetch(url);
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
            if (data.models.length === 0) {
                dom.imageModelSelector.innerHTML = '<option value="">No models found in folder</option>';
            } else {
                dom.imageModelSelector.innerHTML = data.models.map(m => `<option value="${m}" ${m === state.imageModelId ? 'selected' : ''}>${m}</option>`).join('');
            }
            if (data.models.length > 0 && !dom.imageModelSelector.value) {
                dom.imageModelSelector.value = data.models[0];
            }
        }
    } catch (e) {
        console.error("Failed to fetch image models", e);
    }
}

async function refreshImageSubfolders() {
    if (!state.isConnected) return;
    try {
        const url = new URL(`${state.backendUrl}/api/image-subfolders`);
        if (state.imageModelsPath) url.searchParams.append('path', state.imageModelsPath);
        
        const res = await fetch(url);
        const data = await res.json();
        if (data.subfolders && Array.isArray(data.subfolders)) {
            dom.subfolderChips.innerHTML = '';
            
            // Root chip
            const rootChip = document.createElement('button');
            rootChip.className = `px-2 py-1 border rounded-md text-[9px] font-bold uppercase transition-all ${!state.imageSubfolder ? 'bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/20' : 'bg-pink-500/10 border-pink-500/20 text-pink-400 hover:bg-pink-500/20'}`;
            rootChip.innerText = 'Root';
            rootChip.onclick = () => {
                state.imageSubfolder = '';
                dom.activeImageFolder.value = '';
                saveSettings();
                refreshImageSubfolders();
            };
            dom.subfolderChips.appendChild(rootChip);

            data.subfolders.forEach(f => {
                const chip = document.createElement('button');
                const isActive = state.imageSubfolder === f;
                chip.className = `px-2 py-1 border rounded-md text-[9px] font-bold uppercase transition-all ${isActive ? 'bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/20' : 'bg-pink-500/10 border-pink-500/20 text-pink-400 hover:bg-pink-500/20'}`;
                chip.innerText = f;
                chip.onclick = () => {
                    state.imageSubfolder = f;
                    dom.activeImageFolder.value = f;
                    saveSettings();
                    refreshImageSubfolders();
                };
                dom.subfolderChips.appendChild(chip);
            });
        }
    } catch (e) {
        console.error("Failed to fetch image subfolders", e);
    }
}

async function loadLocalModel(modelName) {
    if (!state.isConnected) return;
    try {
        dom.modelDisplay.innerText = "LOADING LLM...";
        const res = await fetch(`${state.backendUrl}/api/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                path: modelName,
                base_dir: state.modelsPath 
            })
        });
        if (res.ok) {
            const data = await res.json();
            dom.modelDisplay.innerText = data.model;
            state.modelId = data.model;
            localStorage.setItem('nexus_modelId', state.modelId);
        } else {
            dom.modelDisplay.innerText = "LOAD ERROR";
        }
    } catch (e) {
        dom.modelDisplay.innerText = "LOAD ERROR";
    }
}

async function loadImageModel(modelName) {
    if (!state.isConnected) return;
    try {
        const res = await fetch(`${state.backendUrl}/api/load-image-model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                path: modelName,
                base_dir: state.imageModelsPath 
            })
        });
        if (res.ok) {
            const data = await res.json();
            state.imageModelId = data.model;
            localStorage.setItem('nexus_imageModelId', state.imageModelId);
            console.log("Image model loaded:", data.model);
        }
    } catch (e) {
        console.error("Image model load error", e);
    }
}

function saveSettings() {
    state.backendUrl = dom.inputBackend.value;
    state.ollamaUrl = dom.inputOllama.value;
    state.inferenceMode = dom.inputInferenceMode.value;
    state.modelsPath = dom.inputModelsPath.value;
    state.imageModelsPath = dom.inputImageModelsPath.value;
    state.imageSubfolder = dom.activeImageFolder.value.trim();
    
    if (state.inferenceMode === 'local') {
        state.modelId = dom.localModelSelector.value || state.modelId;
    } else {
        state.modelId = dom.inputModel.value || state.modelId;
    }
    state.imageModelId = dom.imageModelSelector.value || state.imageModelId;

    state.temperature = parseFloat(dom.inputTemp.value);
    state.maxTokens = parseInt(dom.inputTokens.value);
    state.systemOverride = dom.inputSystem.value;
    state.compactMode = dom.inputCompact.checked;
    state.scriptMode = dom.scriptToggle.checked;
    state.targetLang = dom.langSelector.value;
    state.outputFilename = dom.inputOutputFilename.value;

    dom.modelDisplay.innerText = state.modelId || 'NONE';
    
    localStorage.setItem('nexus_backendUrl', state.backendUrl);
    localStorage.setItem('nexus_ollamaUrl', state.ollamaUrl);
    localStorage.setItem('nexus_modelId', state.modelId);
    localStorage.setItem('nexus_inferenceMode', state.inferenceMode);
    localStorage.setItem('nexus_modelsPath', state.modelsPath);
    localStorage.setItem('nexus_imageModelsPath', state.imageModelsPath);
    localStorage.setItem('nexus_imageModelId', state.imageModelId);
    localStorage.setItem('nexus_imageSubfolder', state.imageSubfolder);
    localStorage.setItem('nexus_temperature', state.temperature);
    localStorage.setItem('nexus_maxTokens', state.maxTokens);
    localStorage.setItem('nexus_systemOverride', state.systemOverride);
    localStorage.setItem('nexus_compactMode', state.compactMode);
    localStorage.setItem('nexus_scriptMode', state.scriptMode);
    localStorage.setItem('nexus_targetLang', state.targetLang);
    localStorage.setItem('nexus_outputFilename', state.outputFilename);

    applyUIState();
}

function applyUIState() {
    if (state.inferenceMode === 'local') {
        dom.localSettings.classList.remove('hidden');
        dom.proxySettings.classList.add('hidden');
    } else {
        dom.localSettings.classList.add('hidden');
        dom.proxySettings.classList.remove('hidden');
    }

    dom.langContainer.style.display = state.scriptMode ? 'block' : 'none';

    if (state.compactMode) {
        document.documentElement.classList.add('compact-ui');
    } else {
        document.documentElement.classList.remove('compact-ui');
    }
}

async function handleSend() {
    const text = dom.input.value.trim();
    if (!text || state.isThinking) return;
    if (!state.isConnected) {
        dom.helpPanel.classList.remove('hidden');
        return;
    }

    if (!state.currentSessionId) createNewSession();

    dom.input.value = '';
    dom.input.style.height = 'auto';
    dom.welcomeState.style.display = 'none';
    
    state.isThinking = true;
    updateUIState();

    if (dom.imageToggle.checked) {
        const thinkingId = addMessage('assistant', '<div class="flex items-center gap-2 mono text-xs text-pink-400"><div class="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse"></div> Painting pixels...</div>', true);
        try {
            let res = await fetch(`${state.backendUrl}/api/generate-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: text,
                    subfolder: state.imageSubfolder,
                    base_dir: state.imageModelsPath
                })
            });

            // If model not loaded, try auto-loading once if we have an ID
            if (res.status === 400 && state.imageModelId) {
                console.log("Image model not loaded on backend. Attempting lazy load...");
                await loadImageModel(state.imageModelId);
                res = await fetch(`${state.backendUrl}/api/generate-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        prompt: text,
                        subfolder: state.imageSubfolder,
                        base_dir: state.imageModelsPath
                    })
                });
            }

            const data = await res.json();
            if (res.ok) {
                const saveNote = data.saved_to ? `\n\n💾 Saved to: \`${data.saved_to}\`` : '';
                updateMessage(thinkingId, `![Generated Image](${data.image})\n\nPrompt: *${text}*${saveNote}`);
                // Clear input after success
                dom.input.value = '';
                // Refresh subfolders list in case a new one was created
                refreshImageSubfolders();
            } else {
                updateMessage(thinkingId, `## Image Gen Failed\n${data.detail || 'Unknown error'}`);
            }
        } catch (e) {
            updateMessage(thinkingId, `## Connection Error\n${e.message}`);
        } finally {
            state.isThinking = false;
            updateUIState();
        }
        return;
    }

    // 1. Add user message to UI state first
    const userMsgId = addMessage('user', text);
    let finalPromptForAI = text;

    if (dom.webToggle.checked) {
        dom.contextInfo.classList.remove('hidden');
        dom.contextInfo.innerHTML = `<span class="text-[10px] font-bold text-indigo-400 flex items-center gap-2 uppercase tracking-widest"><div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></div> Interrogating Web Services...</span>`;
        try {
            const searchRes = await fetch(`${state.backendUrl}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: text, max_results: 8 })
            });
            const { results } = await searchRes.json();
            
            if (results && results.length > 0) {
                let contextText = "";
                if (dom.chromeToggle.checked) {
                    dom.contextInfo.innerHTML = `<span class="text-[10px] font-bold text-indigo-400 flex items-center gap-2 uppercase tracking-widest"><div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></div> Chromium Deep Scan Active...</span>`;
                    const scrapePromises = results.slice(0, 2).map(r => 
                        fetch(`${state.backendUrl}/scrape?url=${encodeURIComponent(r.href)}&use_browser=true`)
                        .then(res => res.json())
                    );
                    const scrapeResults = await Promise.all(scrapePromises);
                    contextText = scrapeResults.map((s, idx) => `Source: ${results[idx].title}\nContent: ${s.content || ""}`).join('\n\n---\n\n');
                } else {
                    contextText = results.map(r => `Source: ${r.title}\nSnippet: ${r.body}`).join('\n\n');
                }
                finalPromptForAI = `Context:\n${contextText}\n\nTask: ${text}`;
            }
        } catch (err) { console.error("Search failed", err); }
        finally { dom.contextInfo.classList.add('hidden'); }
    }

    // 2. Build bulletproof history from current state
    const conversationHistory = state.messages
        .filter(m => !m.isTransient)
        .map(m => {
            const isLatestUserMessage = m.id === userMsgId;
            return {
                role: m.role,
                content: isLatestUserMessage ? finalPromptForAI : m.content
            };
        });

    const thinkingId = addMessage('assistant', '<div class="flex items-center gap-2 mono text-xs text-blue-400"><div class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div> Thinking...</div>', true);

    try {
        const sys = state.scriptMode ? `You are a professional coder. Language: ${state.targetLang}. ${state.systemOverride}` : (state.systemOverride || "You are Nexus.");

        const fullMessages = [
            { role: 'system', content: sys },
            ...conversationHistory
        ];

        console.log("[DEBUG] Sending payload to Bridge:", fullMessages);

        const response = await fetch(`${state.backendUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: fullMessages,
                model: state.modelId || 'llama3',
                mode: state.inferenceMode,
                provider_url: state.ollamaUrl,
                temperature: state.temperature,
                max_tokens: state.maxTokens
            })
        });

        const data = await response.json();
        if (response.status === 400) {
            const errorDetail = data.detail ? JSON.stringify(data.detail, null, 2) : (data.message || 'Unknown Validation Error');
            updateMessage(thinkingId, `## 400 Bad Request\n\n**Details:**\n\`\`\`json\n${errorDetail}\n\`\`\`\n\nCheck the backend console for the full request body trace.`);
            console.error("Validation Error Payload:", data);
            return;
        }
        const content = data.message?.content || data.response || "No response.";
        updateMessage(thinkingId, content);

        if (state.scriptMode && state.outputFilename) {
            const code = content.match(/```(?:\w+)?\n([\s\S]*?)```/)?.[1] || content;
            await fetch(`${state.backendUrl}/save-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: state.outputFilename, content: code })
            });
        }
    } catch (err) {
        updateMessage(thinkingId, `## Connection Error\n${err.message}`);
    } finally {
        state.isThinking = false;
        updateUIState();
        const session = state.sessions.find(s => s.id === state.currentSessionId);
        if (session) {
            session.messages = [...state.messages];
            if (session.title === "New Session" && state.messages.length >= 1) session.title = state.messages[0].content.slice(0, 30);
            saveSessionsToBackend();
            renderHistory();
        }
    }
}

function updateUIState() {
    dom.sendBtn.disabled = state.isThinking;
}

function addMessage(role, content, isTransient = false) {
    const id = Date.now();
    state.messages.push({ id, role, content, isTransient });
    renderMessages();
    return id;
}

function updateMessage(id, content) {
    const msg = state.messages.find(m => m.id === id);
    if (msg) {
        msg.content = content;
        msg.isTransient = false; // Mark as permanent once response is received
        renderMessages();
    }
}

function renderHistory() {
    dom.history.innerHTML = `<div class="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-4 px-1">Recent Sessions</div>`;
    state.sessions.forEach(s => {
        const div = document.createElement('div');
        div.className = `p-3 rounded-xl cursor-pointer transition-all border ${s.id === state.currentSessionId ? 'bg-[#111] border-[#222] text-white shadow-lg' : 'border-transparent text-gray-500 hover:bg-white/5'}`;
        div.innerHTML = `<div class="text-[11px] font-bold truncate">${s.title}</div><div class="text-[9px] mono opacity-50 mt-1">${new Date(s.timestamp).toLocaleDateString()}</div>`;
        div.onclick = () => loadSession(s.id);
        dom.history.appendChild(div);
    });
}

function renderMessages() {
    if (state.messages.length === 0) {
        dom.welcomeState.style.display = 'flex';
        dom.messages.innerHTML = '';
        dom.messages.appendChild(dom.welcomeState);
        return;
    }

    dom.messages.innerHTML = state.messages.map(m => `
        <div class="flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="max-w-[90%] rounded-2xl p-4 ${m.role === 'user' ? 'chat-bubble-user text-white' : 'chat-bubble-ai text-gray-200'}">
                <div class="prose prose-invert prose-sm max-w-none">
                    ${marked.parse(m.content)}
                </div>
            </div>
        </div>
    `).join('');
    dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: 'smooth' });
}

init();
