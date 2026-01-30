/*
  Code Bear Engine
  Core flashing and serial logic for ESP devices.
  Based on esptool-js
*/

import { ESPLoader, Transport } from './lib/esptool-js/bundle.js';
import { Terminal } from 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm';

// --- Terminal Instances ---
const term = new Terminal({
    convertEol: true,
    theme: { background: '#000', foreground: '#f39c12' },
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace'
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

const serialMonitorTerminal = new Terminal({
    convertEol: true,
    theme: { background: '#000', foreground: '#fff' },
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace'
});
const monitorFitAddon = new FitAddon();
serialMonitorTerminal.loadAddon(monitorFitAddon);

// Helper for logging
const logger = {
    log: (msg) => term.writeln(`\x1b[38;5;214m[Bear]\x1b[0m ${msg}`),
    error: (msg) => term.writeln(`\x1b[31m[Error]\x1b[0m ${msg}`),
    info: (msg) => term.writeln(`\x1b[36m[Info]\x1b[0m ${msg}`),
    raw: (data) => term.write(data)
};

// --- State ---
let device = null;
let transport = null;
let esploader = null;
let monitorReader = null;
let keepReading = false;
let currentBaudRate = 115200;

// --- Events ---
const eventCallbacks = {
    onStatusChange: null,
    onProgress: null,
    onConnected: null,
    onDisconnected: null,
    onChipDetected: null
};

// --- Core Functions ---

async function getChipInfo() {
    if (!device) return;
    
    // To get chip info, we usually need to enter the bootloader
    // This involves a reset. 
    logger.info("Detecting device details...");
    await stopMonitor();
    await device.close();

    try {
        transport = new Transport(device, true);
        const flashOptions = {
            transport,
            baudrate: 115200,
            terminal: {
                clean: () => {},
                writeLine: (d) => {},
                write: (d) => {}
            }
        };
        esploader = new ESPLoader(flashOptions);
        const chip = await esploader.main();
        const mac = await esploader.chip.getMacAddr(esploader);
        
        const info = {
            chip,
            mac
        };

        if (eventCallbacks.onChipDetected) {
            eventCallbacks.onChipDetected(info);
        }

        await transport.disconnect();
        transport = null;
        esploader = null;

        // Restore for monitoring
        await device.open({ baudRate: currentBaudRate });
        await hardReset();
        startMonitor();
        
        return info;
    } catch (e) {
        logger.error("Failed to detect chip: " + e.message);
        // Try to restore anyway
        try {
            await device.open({ baudRate: currentBaudRate });
            startMonitor();
        } catch(re) {}
    }
}

async function hardReset() {
    if (!device) return;
    await device.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    await device.setSignals({ dataTerminalReady: false, requestToSend: false });
    await new Promise(resolve => setTimeout(resolve, 200));
}

async function connect(baudrate = 115200) {
    try {
        if (!device) {
            device = await navigator.serial.requestPort();
        }

        if (device.readable) {
            await device.close();
        }

        logger.info(`Opening port at ${baudrate} baud...`);
        await device.open({ baudRate: baudrate });
        await device.setSignals({ dataTerminalReady: false, requestToSend: false });
        
        currentBaudRate = baudrate;
        startMonitor();
        
        if (eventCallbacks.onConnected) eventCallbacks.onConnected(device);
        return true;
    } catch (error) {
        logger.error(`Connection failed: ${error.message}`);
        throw error;
    }
}

async function disconnect() {
    try {
        await stopMonitor();
        if (device) {
            await device.close();
            device = null;
        }
        logger.info("Device disconnected.");
        if (eventCallbacks.onDisconnected) eventCallbacks.onDisconnected();
    } catch (error) {
        logger.error(`Disconnect error: ${error.message}`);
    }
}

async function startMonitor() {
    if (keepReading) await stopMonitor();
    if (!device || !device.readable) return;
    
    keepReading = true;
    readLoop();
}

async function stopMonitor() {
    keepReading = false;
    if (monitorReader) {
        try {
            await monitorReader.cancel();
        } catch(e) {}
        monitorReader = null;
    }
}

async function readLoop() {
    while (device && device.readable && keepReading) {
        try {
            monitorReader = device.readable.getReader();
            while (true) {
                const { value, done } = await monitorReader.read();
                if (done) break;
                if (value) serialMonitorTerminal.write(value);
            }
        } catch (error) {
            console.error("Monitor read error:", error);
            break;
        } finally {
            if (monitorReader) {
                monitorReader.releaseLock();
                monitorReader = null;
            }
        }
    }
}

async function sendData(data) {
    if (!device || !device.writable) return;
    const encoder = new TextEncoder();
    const writer = device.writable.getWriter();
    try {
        await writer.write(encoder.encode(data));
    } finally {
        writer.releaseLock();
    }
}

async function flash(firmwareVersion, eraseFlash, flashBaudRate) {
    if (!device) throw new Error("No device connected");

    const monitorBaud = currentBaudRate;
    logger.log("Preparing to flash...");
    await stopMonitor();
    await device.close();

    try {
        transport = new Transport(device, true);
        const flashOptions = {
            transport,
            baudrate: flashBaudRate,
            terminal: {
                clean: () => term.clear(),
                writeLine: (d) => logger.raw(d + '\n'),
                write: (d) => logger.raw(d)
            },
            debugLogging: false,
            flashSize: "detect",
        };
        
        esploader = new ESPLoader(flashOptions);
        const chip = await esploader.main();
        logger.info(`Detected chip: ${chip}`);

        if (eraseFlash) {
            logger.log("Erasing flash memory...");
            await esploader.eraseFlash();
        }

        logger.log("Fetching firmware...");
        const manifestPath = firmwareVersion.manifest_path;
        const basePath = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
        const manifest = await (await fetch(manifestPath)).json();

        const fileArray = [];
        for (const build of manifest.builds) {
            for (const part of build.parts) {
                const binaryData = await (await fetch(`${basePath}${part.path}`)).arrayBuffer();
                const binaryString = Array.from(new Uint8Array(binaryData), b => String.fromCharCode(b)).join('');
                fileArray.push({ data: binaryString, address: part.offset });
            }
        }

        logger.log(`Starting flash for ${fileArray.length} parts...`);
        
        await esploader.writeFlash({
            fileArray,
            flashSize: "detect",
            eraseAll: false,
            compress: true,
            flashMode: "dio",
            flashFreq: "40m",
            reportProgress: (idx, written, total) => {
                if (eventCallbacks.onProgress) {
                    eventCallbacks.onProgress(idx, written, total, fileArray.length);
                }
            },
            calculateMD5Hash: (image) => window.CryptoJS.MD5(window.CryptoJS.enc.Latin1.parse(image)).toString(),
        });

        logger.log("\r\n\x1b[32mFlash successful!\x1b[0m");

    } finally {
        if (transport) {
            await transport.disconnect();
            transport = null;
            esploader = null;
        }

        try {
            logger.info("Restarting device...");
            await device.open({ baudRate: monitorBaud });
            await hardReset();
            startMonitor();
        } catch (e) {
            logger.error("Failed to restore monitor.");
        }
    }
}

// Initialization
function initTerminals(logEl, monitorEl) {
    term.open(logEl);
    serialMonitorTerminal.open(monitorEl);
    fitAddon.fit();
    monitorFitAddon.fit();
}

export {
    initTerminals,
    connect,
    disconnect,
    flash,
    sendData,
    term,
    serialMonitorTerminal,
    fitAddon,
    monitorFitAddon,
    eventCallbacks,
    hardReset
};
