import * as Engine from './engine.js';

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const elements = {
        navItems: document.querySelectorAll('.nav-item'),
        views: document.querySelectorAll('.view-section'),
        themeToggle: document.getElementById('theme-toggle'),
        connectBtn: document.getElementById('main-connect-btn'),
        statusContainer: document.querySelector('.connection-status'),
        statusText: document.querySelector('.status-text'),
        deviceModal: document.getElementById('device-modal'),
        deviceCardClickable: document.getElementById('device-card-clickable'),
        closeDeviceModal: document.querySelector('.close-modal'),
        deviceList: document.getElementById('device-list'),
        deviceSearch: document.getElementById('device-search'),
        selectedDeviceDisplay: document.getElementById('selected-device-display'),
        firmwareSelect: document.getElementById('firmware-select'),
        versionSelect: document.getElementById('version-select'),
        baudRateSelect: document.getElementById('baud-rate-select'),
        eraseFlashCheckbox: document.getElementById('erase-flash-checkbox'),
        flashBtn: document.getElementById('flash-btn'),
        progressCircle: document.getElementById('progress-circle'),
        progressPercent: document.getElementById('progress-percent'),
        flashStatusMsg: document.getElementById('flash-status-msg'),
        terminalLog: document.getElementById('terminal-log'),
        monitorTerminal: document.getElementById('serial-monitor-terminal'),
        clearConsoleBtn: document.getElementById('clear-console-btn'),
        clearMonitorBtn: document.getElementById('clear-monitor-btn'),
        monitorBaudSelect: document.getElementById('modal-baud-rate-select'),
        serialInput: document.getElementById('serial-send-input'),
        serialSendBtn: document.getElementById('serial-send-btn')
    };

    let appConfig = null;
    let selectedDevice = null;
    let selectedFirmware = null;
    let selectedVersion = null;
    let isConnected = false;

    // --- View Navigation Fix ---
    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewId = item.getAttribute('data-view');
            
            // Update nav state
            elements.navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Switch views
            elements.views.forEach(v => v.classList.remove('active'));
            const targetView = document.getElementById(`${viewId}-view`);
            if (targetView) {
                targetView.classList.add('active');
            }

            // Update title
            const viewTitle = document.getElementById('view-title');
            if (viewTitle) viewTitle.textContent = viewId.charAt(0).toUpperCase() + viewId.slice(1);
            
            // Resize terminals
            if (viewId === 'terminal') setTimeout(() => Engine.fitAddon.fit(), 50);
            if (viewId === 'monitor') setTimeout(() => Engine.monitorFitAddon.fit(), 50);
        });
    });

    // --- Theme Toggle Fix ---
    const initTheme = () => {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        const isLight = savedTheme === 'light';
        document.body.classList.toggle('light-mode', isLight);
        updateThemeToggleUI(isLight);
    };

    const updateThemeToggleUI = (isLight) => {
        const icon = elements.themeToggle.querySelector('i');
        const text = elements.themeToggle.querySelector('span');
        icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
        text.textContent = isLight ? 'Light Mode' : 'Dark Mode';
    };

    elements.themeToggle.onclick = () => {
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateThemeToggleUI(isLight);
    };

    initTheme();

    // --- Modal Logic ---
    const toggleModal = (show) => elements.deviceModal.classList.toggle('active', show);
    if(elements.deviceCardClickable) elements.deviceCardClickable.onclick = () => toggleModal(true);
    if(elements.closeDeviceModal) elements.closeDeviceModal.onclick = () => toggleModal(false);
    elements.deviceModal.onclick = (e) => { if (e.target === elements.deviceModal) toggleModal(false); };

    // --- Config & Device Render ---
    try {
        const response = await fetch('firmware/config.json');
        appConfig = await response.json();
        renderDevices(appConfig.devices);
    } catch (e) { console.error("Config load error:", e); }

    function renderDevices(devices) {
        elements.deviceList.innerHTML = '';
        devices.forEach(device => {
            const el = document.createElement('div');
            el.className = 'device-item';
            el.innerHTML = `<img src="${device.image || 'assets/bear-logo.svg'}" onerror="this.src='assets/bear-logo.svg'"><div class="device-name">${device.name}</div>`;
            el.onclick = () => {
                selectedDevice = device;
                toggleModal(false);
                elements.selectedDeviceDisplay.innerHTML = `
                    <div class="selected-device-info">
                        <img src="${device.image || 'assets/bear-logo.svg'}" class="device-img" onerror="this.src='assets/bear-logo.svg'">
                        <h4>${device.name}</h4>
                    </div>`;
                elements.firmwareSelect.innerHTML = '<option value="">Select Firmware</option>';
                device.firmwares.forEach(fw => {
                    const opt = document.createElement('option');
                    opt.value = fw.id; opt.textContent = fw.name;
                    elements.firmwareSelect.appendChild(opt);
                });
                elements.firmwareSelect.disabled = false;
                elements.versionSelect.disabled = true;
                updateUI();
            };
            elements.deviceList.appendChild(el);
        });
    }

    elements.firmwareSelect.onchange = () => {
        selectedFirmware = selectedDevice.firmwares.find(f => f.id === elements.firmwareSelect.value);
        if (selectedFirmware) {
            elements.versionSelect.innerHTML = '<option value="">Select Version</option>';
            selectedFirmware.versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id; opt.textContent = v.name;
                elements.versionSelect.appendChild(opt);
            });
            elements.versionSelect.disabled = false;
        } else { elements.versionSelect.disabled = true; }
        updateUI();
    };

    elements.versionSelect.onchange = () => {
        selectedVersion = selectedFirmware.versions.find(v => v.id === elements.versionSelect.value);
        updateUI();
    };

    function updateUI() {
        elements.flashBtn.disabled = !(isConnected && selectedVersion);
        if (isConnected) {
            elements.connectBtn.innerHTML = '<i class="fas fa-unlink"></i> Disconnect';
            elements.statusContainer.classList.add('connected');
            elements.statusText.textContent = 'Connected';
        } else {
            elements.connectBtn.innerHTML = '<i class="fas fa-link"></i> Connect Device';
            elements.statusContainer.classList.remove('connected');
            elements.statusText.textContent = 'Disconnected';
        }
    }

    // --- Engine Integration ---
    Engine.initTerminals(elements.terminalLog, elements.monitorTerminal);

    elements.connectBtn.onclick = async () => {
        if (!isConnected) {
            try {
                const baud = parseInt(elements.monitorBaudSelect.value);
                await Engine.connect(baud);
                isConnected = true;
                updateUI();
                setTimeout(() => Engine.getChipInfo(), 500);
            } catch (e) { console.error("Connect error:", e); }
        } else {
            await Engine.disconnect();
            isConnected = false;
            updateUI();
        }
    };

    function updateProgress(percent) {
        const radius = elements.progressCircle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        const offset = circumference - (percent / 100 * circumference);
        elements.progressCircle.style.strokeDashoffset = offset;
        elements.progressPercent.textContent = `${Math.round(percent)}%`;
    }

    elements.flashBtn.onclick = async () => {
        elements.flashBtn.disabled = true;
        elements.flashStatusMsg.textContent = "Pouring honey...";
        updateProgress(0);
        try {
            await Engine.flash(selectedVersion, elements.eraseFlashCheckbox.checked, parseInt(elements.baudRateSelect.value));
            elements.flashStatusMsg.textContent = "Flash Complete!";
            updateProgress(100);
        } catch (e) {
            elements.flashStatusMsg.textContent = "Flash Failed!";
        } finally { elements.flashBtn.disabled = false; }
    };

    Engine.eventCallbacks.onProgress = (idx, written, total) => {
        const p = (written / total) * 100;
        updateProgress(p);
    };

    elements.clearConsoleBtn.onclick = () => Engine.term.clear();
    elements.clearMonitorBtn.onclick = () => Engine.serialMonitorTerminal.clear();
    elements.serialSendBtn.onclick = () => {
        if (elements.serialInput.value) {
            Engine.sendData(elements.serialInput.value + '\n');
            elements.serialInput.value = '';
        }
    };

    window.onresize = () => {
        Engine.fitAddon.fit();
        Engine.monitorFitAddon.fit();
    };
});