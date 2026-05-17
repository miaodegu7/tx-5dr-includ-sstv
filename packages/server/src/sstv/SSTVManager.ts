import { EventEmitter } from 'eventemitter3';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as nodeWav from 'node-wav';
import type {
  SSTVDecoderEvent,
  SSTVDecoderStatus,
  SSTVModeName,
  SSTVTxPreparePayload,
} from '@tx5dr/contracts';
import { createLogger } from '../utils/logger.js';
import type { AudioStreamManager } from '../audio/AudioStreamManager.js';
import { SSTVModeRecognizer, type VISDetection } from './SSTVModeRecognizer.js';

const logger = createLogger('SSTVManager');
const require = createRequire(import.meta.url);
const SSTV_CLI_PATH = require.resolve('sstv/dist/bin.js');
const CODEC_TEMP_DIR = path.join(os.tmpdir(), 'tx5dr-sstv-codec');

const TX_MODE_MAP: Record<SSTVModeName, string> = {
  MartinM1: 'Martin 1',
  MartinM2: 'Martin 2',
  ScottieS1: 'Scottie 1',
  ScottieS2: 'Scottie 2',
  ScottieDX: 'Scottie DX',
  Robot36: 'Robot 36',
  Robot72: 'Robot 72',
  PD90: 'PD 90',
  PD120: 'PD 120',
  PD180: 'PD 180',
  PD240: 'PD 240',
  Unknown: 'Martin 1',
};

const RX_CAPTURE_DURATION_MS: Partial<Record<SSTVModeName, number>> = {
  MartinM1: 114_000,
  MartinM2: 58_000,
  ScottieS1: 110_000,
  ScottieS2: 71_000,
  ScottieDX: 270_000,
  Robot36: 40_000,
  Robot72: 80_000,
  PD90: 90_000,
  PD120: 126_000,
  PD180: 187_000,
  PD240: 248_000,
};

const RX_CAPTURE_HEADROOM_MS = 8_000;
const RX_CAPTURE_MAX_MS = 300_000;
const RX_CAPTURE_DEFAULT_MS = 130_000;

type DecoderState = SSTVDecoderStatus['state'];

interface SSTVManagerEvents {
  sstvDecoderStatusChanged: (status: SSTVDecoderStatus) => void;
  sstvDecoderEvent: (event: SSTVDecoderEvent) => void;
}

export interface PreparedTxState {
  mode: SSTVModeName;
  callsign: string;
  preparedAt: number;
  sampleRate: number;
  durationMs: number;
}

export interface SSTVTxAudioPayload extends PreparedTxState {
  samples: Float32Array;
}

interface RxCaptureState {
  mode: SSTVModeName;
  confidence: number;
  sampleRate: number;
  startedAt: number;
  requiredSamples: number;
  bufferedSamples: number;
  chunks: Float32Array[];
}

export interface SSTVManagerOptions {
  onTransmitAudio?: (payload: SSTVTxAudioPayload) => Promise<void>;
}

export class SSTVManager extends EventEmitter<SSTVManagerEvents> {
  private readonly recognizer = new SSTVModeRecognizer();
  private enabled = false;
  private status: SSTVDecoderStatus = {
    enabled: false,
    state: 'stopped',
    backend: 'vis-heuristic+sstv-cli',
    lastDetectedMode: null,
    lastVisCode: null,
    confidence: 0,
    signalHz: null,
    lastDetectedAt: null,
    lastError: null,
  };
  private readonly audioDataHandler = (samples: Float32Array, sampleRate: number) => {
    this.handleAudioData(samples, sampleRate);
  };
  private attached = false;
  private preparedTxState: PreparedTxState | null = null;
  private txInProgress = false;
  private rxDecodeInProgress = false;
  private rxCapture: RxCaptureState | null = null;
  private readonly onTransmitAudio: (payload: SSTVTxAudioPayload) => Promise<void>;

  constructor(
    private readonly audioStreamManager: AudioStreamManager,
    options: SSTVManagerOptions = {},
  ) {
    super();
    this.onTransmitAudio = options.onTransmitAudio ?? (async () => {});
  }

  start(): void {
    if (!this.attached) {
      this.audioStreamManager.on('audioData', this.audioDataHandler);
      this.attached = true;
    }
    if (this.status.state === 'error') {
      this.setStatus({ ...this.status, state: 'stopped', lastError: null });
    }
  }

  stop(): void {
    if (this.attached) {
      this.audioStreamManager.off('audioData', this.audioDataHandler);
      this.attached = false;
    }
    this.enabled = false;
    this.txInProgress = false;
    this.rxDecodeInProgress = false;
    this.rxCapture = null;
    this.recognizer.reset();
    this.setStatus({
      ...this.status,
      enabled: false,
      state: 'stopped',
      confidence: 0,
      signalHz: null,
    });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (!enabled) {
      this.recognizer.reset();
      this.rxCapture = null;
      this.rxDecodeInProgress = false;
      this.setStatus({
        ...this.status,
        enabled: false,
        state: 'stopped',
        confidence: 0,
        signalHz: null,
      });
      return;
    }

    this.setStatus({
      ...this.status,
      enabled: true,
      state: 'running',
      lastError: null,
    });
  }

  getStatus(): SSTVDecoderStatus {
    return { ...this.status };
  }

  async prepareTx(payload: SSTVTxPreparePayload): Promise<PreparedTxState> {
    if (this.txInProgress) {
      throw new Error('SSTV transmission is already in progress');
    }

    const callsign = (payload.callsign ?? '').trim();
    const mode = payload.mode ?? 'MartinM1';
    const preparedAt = Date.now();
    const encoded = await this.encodeTxPayload(payload.imageDataUrl, mode, callsign, preparedAt);
    this.preparedTxState = {
      mode,
      callsign,
      preparedAt,
      sampleRate: encoded.sampleRate,
      durationMs: encoded.durationMs,
    };

    this.emit('sstvDecoderEvent', {
      type: 'tx_prepared',
      mode,
      callsign,
      durationMs: encoded.durationMs,
      sampleRate: encoded.sampleRate,
      timestamp: preparedAt,
    });

    this.txInProgress = true;
    this.emit('sstvDecoderEvent', {
      type: 'tx_started',
      mode,
      callsign,
      durationMs: encoded.durationMs,
      timestamp: Date.now(),
    });

    try {
      await this.onTransmitAudio(encoded);
      this.emit('sstvDecoderEvent', {
        type: 'tx_completed',
        mode,
        callsign,
        success: true,
        durationMs: encoded.durationMs,
        timestamp: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('sstvDecoderEvent', {
        type: 'tx_completed',
        mode,
        callsign,
        success: false,
        error: message,
        durationMs: encoded.durationMs,
        timestamp: Date.now(),
      });
      throw error;
    } finally {
      this.txInProgress = false;
    }

    return { ...this.preparedTxState };
  }

  getPreparedTxState(): PreparedTxState | null {
    return this.preparedTxState ? { ...this.preparedTxState } : null;
  }

  private handleAudioData(samples: Float32Array, sampleRate: number): void {
    if (!this.enabled || this.status.state !== 'running') {
      return;
    }

    try {
      const detection = this.recognizer.push(samples, sampleRate, Date.now());
      if (detection) {
        this.onVisDetected(detection, sampleRate);
      }
      this.appendRxSamples(samples, sampleRate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('SSTV decode stream processing failed', { error: message });
      this.rxCapture = null;
      this.rxDecodeInProgress = false;
      this.setStatus({
        ...this.status,
        state: 'error',
        lastError: message,
      });
      this.emit('sstvDecoderEvent', {
        type: 'error',
        error: message,
        recoverable: true,
        timestamp: Date.now(),
      });
    }
  }

  private onVisDetected(detection: VISDetection, sampleRate: number): void {
    this.setStatus({
      ...this.status,
      enabled: true,
      state: 'running',
      lastDetectedMode: detection.mode,
      lastVisCode: detection.visCode,
      confidence: detection.confidence,
      signalHz: detection.signalHz,
      lastDetectedAt: detection.timestamp,
      lastError: null,
    });

    this.emit('sstvDecoderEvent', {
      type: 'vis_detected',
      mode: detection.mode,
      visCode: detection.visCode,
      confidence: detection.confidence,
      signalHz: detection.signalHz,
      timestamp: detection.timestamp,
    });

    this.beginRxCapture(detection.mode, detection.confidence, sampleRate, detection.timestamp);
  }

  private beginRxCapture(mode: SSTVModeName, confidence: number, sampleRate: number, now: number): void {
    if (mode === 'Unknown') {
      return;
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      return;
    }

    const baseDurationMs = RX_CAPTURE_DURATION_MS[mode] ?? RX_CAPTURE_DEFAULT_MS;
    const captureMs = Math.min(RX_CAPTURE_MAX_MS, baseDurationMs + RX_CAPTURE_HEADROOM_MS);
    const requiredSamples = Math.max(1, Math.round((captureMs / 1000) * sampleRate));

    this.rxCapture = {
      mode,
      confidence,
      sampleRate,
      startedAt: now,
      requiredSamples,
      bufferedSamples: 0,
      chunks: [],
    };

    logger.info('SSTV RX capture started', {
      mode,
      sampleRate,
      requiredSamples,
      captureMs,
    });
  }

  private appendRxSamples(samples: Float32Array, sampleRate: number): void {
    const capture = this.rxCapture;
    if (!capture || this.rxDecodeInProgress) {
      return;
    }

    if (capture.sampleRate !== sampleRate) {
      this.rxCapture = null;
      this.emit('sstvDecoderEvent', {
        type: 'error',
        error: `SSTV RX sample-rate changed unexpectedly (${capture.sampleRate} -> ${sampleRate})`,
        recoverable: true,
        timestamp: Date.now(),
      });
      return;
    }

    capture.chunks.push(Float32Array.from(samples));
    capture.bufferedSamples += samples.length;
    if (capture.bufferedSamples >= capture.requiredSamples) {
      void this.finalizeRxCapture(capture);
    }
  }

  private async finalizeRxCapture(capture: RxCaptureState): Promise<void> {
    if (this.rxDecodeInProgress || this.rxCapture !== capture) {
      return;
    }

    this.rxDecodeInProgress = true;
    this.rxCapture = null;
    const merged = this.mergeChunks(capture.chunks, capture.bufferedSamples);

    try {
      const decoded = await this.decodeCapturedImage(
        merged,
        capture.sampleRate,
        capture.mode,
        capture.confidence,
      );
      this.emit('sstvDecoderEvent', decoded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('SSTV image decode failed', { error: message, mode: capture.mode });
      this.emit('sstvDecoderEvent', {
        type: 'error',
        error: message,
        recoverable: true,
        timestamp: Date.now(),
      });
    } finally {
      this.rxDecodeInProgress = false;
    }
  }

  private async encodeTxPayload(
    imageDataUrl: string,
    mode: SSTVModeName,
    callsign: string,
    preparedAt: number,
  ): Promise<SSTVTxAudioPayload> {
    const sessionId = `tx-${preparedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPngPath = path.join(CODEC_TEMP_DIR, `${sessionId}.png`);
    const outputWavPath = path.join(CODEC_TEMP_DIR, `${sessionId}.wav`);

    await fs.mkdir(CODEC_TEMP_DIR, { recursive: true });

    try {
      const imageBuffer = dataUrlToBuffer(imageDataUrl);
      await fs.writeFile(inputPngPath, imageBuffer);

      const modeName = TX_MODE_MAP[mode] ?? TX_MODE_MAP.MartinM1;
      await this.runSstvCli(['-e', inputPngPath, '-o', outputWavPath, '-m', modeName], 120_000);

      const wavBuffer = await fs.readFile(outputWavPath);
      const decoded = nodeWav.decode(wavBuffer);
      const firstChannel = decoded.channelData[0];
      if (!firstChannel || firstChannel.length === 0) {
        throw new Error('SSTV encoder produced empty WAV channel');
      }

      const samples = Float32Array.from(firstChannel);
      const sampleRate = Math.max(1, Math.round(decoded.sampleRate));
      const durationMs = Math.round((samples.length / sampleRate) * 1000);

      return {
        mode,
        callsign,
        preparedAt,
        sampleRate,
        durationMs,
        samples,
      };
    } finally {
      await Promise.allSettled([
        fs.unlink(inputPngPath),
        fs.unlink(outputWavPath),
      ]);
    }
  }

  private async decodeCapturedImage(
    samples: Float32Array,
    sampleRate: number,
    mode: SSTVModeName,
    confidence: number,
  ): Promise<SSTVDecoderEvent> {
    const sessionId = `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputWavPath = path.join(CODEC_TEMP_DIR, `${sessionId}.wav`);
    const outputPngPath = path.join(CODEC_TEMP_DIR, `${sessionId}.png`);
    await fs.mkdir(CODEC_TEMP_DIR, { recursive: true });

    try {
      await this.writeFloatWav(inputWavPath, samples, sampleRate);
      await this.runSstvCli(['-d', inputWavPath, '-o', outputPngPath], 180_000);

      const pngBuffer = await fs.readFile(outputPngPath);
      const imageDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      const size = readPngDimensions(pngBuffer);
      return {
        type: 'rx_image_decoded',
        mode,
        imageDataUrl,
        width: size?.width,
        height: size?.height,
        confidence,
        timestamp: Date.now(),
      };
    } finally {
      await Promise.allSettled([
        fs.unlink(inputWavPath),
        fs.unlink(outputPngPath),
      ]);
    }
  }

  private async writeFloatWav(filePath: string, samples: Float32Array, sampleRate: number): Promise<void> {
    const normalized = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index] ?? 0;
      normalized[index] = value > 1 ? 1 : (value < -1 ? -1 : value);
    }

    const wavBuffer = nodeWav.encode([normalized], {
      sampleRate: Math.max(1, Math.round(sampleRate)),
      float: true,
      bitDepth: 32,
    });
    await fs.writeFile(filePath, wavBuffer);
  }

  private runSstvCli(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SSTV_CLI_PATH, ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`sstv codec command timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        reject(new Error(details ? `sstv codec failed: ${details}` : `sstv codec exited with code ${code}`));
      });
    });
  }

  private mergeChunks(chunks: Float32Array[], totalLength: number): Float32Array {
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  private setStatus(next: SSTVDecoderStatus): void {
    const shouldEmit = this.hasStatusChanged(this.status, next);
    this.status = next;
    if (shouldEmit) {
      this.emit('sstvDecoderStatusChanged', this.getStatus());
    }
  }

  private hasStatusChanged(current: SSTVDecoderStatus, next: SSTVDecoderStatus): boolean {
    return current.enabled !== next.enabled
      || current.state !== next.state
      || current.lastDetectedMode !== next.lastDetectedMode
      || current.lastVisCode !== next.lastVisCode
      || Math.abs(current.confidence - next.confidence) > 1e-3
      || current.signalHz !== next.signalHz
      || current.lastDetectedAt !== next.lastDetectedAt
      || current.lastError !== next.lastError;
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Invalid image data URL');
  }
  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  if (/;base64/i.test(metadata)) {
    return Buffer.from(payload, 'base64');
  }
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) {
    return null;
  }
  const isPng = buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
  if (!isPng) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
