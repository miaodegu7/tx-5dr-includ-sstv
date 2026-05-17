import type { SSTVModeName } from '@tx5dr/contracts';

const VIS_WINDOW_MS = 30;
const MIN_LEADER_WINDOWS = 7;
const HISTORY_LIMIT = 140;

type ToneSymbol = '1100' | '1200' | '1300' | '1900' | 'unknown';

interface SymbolPoint {
  tone: ToneSymbol;
  confidence: number;
  timestamp: number;
}

export interface VISDetection {
  mode: SSTVModeName;
  visCode: number;
  confidence: number;
  signalHz: number | null;
  timestamp: number;
}

const VIS_MODE_MAP: Record<number, SSTVModeName> = {
  8: 'Robot36',
  12: 'Robot72',
  40: 'MartinM2',
  44: 'MartinM1',
  56: 'ScottieS2',
  60: 'ScottieS1',
  76: 'ScottieDX',
  95: 'PD120',
  96: 'PD180',
  97: 'PD240',
  99: 'PD90',
};

function visToMode(visCode: number): SSTVModeName {
  return VIS_MODE_MAP[visCode] ?? 'Unknown';
}

function toBit(symbol: ToneSymbol): 0 | 1 | null {
  if (symbol === '1300') return 0;
  if (symbol === '1100') return 1;
  return null;
}

function computeDominantTone(samples: Float32Array, sampleRate: number): { tone: ToneSymbol; confidence: number; signalHz: number | null } {
  if (samples.length < 8 || sampleRate <= 0) {
    return { tone: 'unknown', confidence: 0, signalHz: null };
  }

  const candidates = [1100, 1200, 1300, 1900] as const;
  const energies = candidates.map((freq) => ({ freq, energy: goertzelEnergy(samples, sampleRate, freq) }));
  energies.sort((a, b) => b.energy - a.energy);

  const best = energies[0];
  const second = energies[1];
  const floor = 1e-9;
  const confidence = Math.max(0, Math.min(1, (best.energy - second.energy) / Math.max(best.energy, floor)));

  if (!Number.isFinite(best.energy) || best.energy < 1e-8 || confidence < 0.08) {
    return { tone: 'unknown', confidence: 0, signalHz: null };
  }

  return {
    tone: String(best.freq) as ToneSymbol,
    confidence,
    signalHz: best.freq,
  };
}

function goertzelEnergy(samples: Float32Array, sampleRate: number, targetHz: number): number {
  const normalized = targetHz / sampleRate;
  const omega = 2 * Math.PI * normalized;
  const cosine = Math.cos(omega);
  const coefficient = 2 * cosine;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    q0 = coefficient * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - coefficient * q1 * q2;
}

export class SSTVModeRecognizer {
  private symbolHistory: SymbolPoint[] = [];
  private leftover = new Float32Array(0);
  private lastDetectedVisCode: number | null = null;
  private lastDetectedAt = 0;

  reset(): void {
    this.symbolHistory = [];
    this.leftover = new Float32Array(0);
    this.lastDetectedVisCode = null;
    this.lastDetectedAt = 0;
  }

  push(samples: Float32Array, sampleRate: number, baseTimestamp = Date.now()): VISDetection | null {
    if (samples.length === 0 || sampleRate <= 0) {
      return null;
    }

    const windowSize = Math.max(64, Math.round((VIS_WINDOW_MS / 1000) * sampleRate));
    const merged = new Float32Array(this.leftover.length + samples.length);
    merged.set(this.leftover, 0);
    merged.set(samples, this.leftover.length);

    let offset = 0;
    while (offset + windowSize <= merged.length) {
      const slice = merged.subarray(offset, offset + windowSize);
      const { tone, confidence, signalHz } = computeDominantTone(slice, sampleRate);
      const timestamp = baseTimestamp - Math.round(((merged.length - offset) / sampleRate) * 1000);
      this.symbolHistory.push({ tone, confidence, timestamp: Math.max(0, timestamp) });
      if (this.symbolHistory.length > HISTORY_LIMIT) {
        this.symbolHistory.splice(0, this.symbolHistory.length - HISTORY_LIMIT);
      }

      const detection = this.tryDetectVIS(signalHz);
      if (detection) {
        return detection;
      }

      offset += windowSize;
    }

    this.leftover = merged.subarray(offset);
    return null;
  }

  private tryDetectVIS(signalHz: number | null): VISDetection | null {
    const symbols = this.symbolHistory;
    if (symbols.length < 28) {
      return null;
    }

    const scanStart = Math.max(0, symbols.length - 90);
    for (let i = scanStart; i <= symbols.length - 12; i += 1) {
      if (symbols[i].tone !== '1900') {
        continue;
      }

      const firstLeader = this.countRun(symbols, i, '1900');
      if (firstLeader < MIN_LEADER_WINDOWS) {
        continue;
      }

      const breakIdx = i + firstLeader;
      if (breakIdx >= symbols.length || symbols[breakIdx].tone !== '1200') {
        continue;
      }

      const secondLeaderStart = breakIdx + 1;
      const secondLeader = this.countRun(symbols, secondLeaderStart, '1900');
      if (secondLeader < MIN_LEADER_WINDOWS) {
        continue;
      }

      const visStart = secondLeaderStart + secondLeader;
      const visEnd = visStart + 10;
      if (visEnd > symbols.length) {
        continue;
      }

      const vis = symbols.slice(visStart, visEnd);
      const startBit = vis[0];
      const stopBit = vis[9];
      if (startBit.tone !== '1200' || stopBit.tone !== '1200') {
        continue;
      }

      const dataBits: Array<0 | 1> = [];
      let visConfidence = startBit.confidence + stopBit.confidence;
      for (let bitIdx = 1; bitIdx <= 7; bitIdx += 1) {
        const value = toBit(vis[bitIdx].tone);
        if (value === null) {
          dataBits.length = 0;
          break;
        }
        dataBits.push(value);
        visConfidence += vis[bitIdx].confidence;
      }
      if (dataBits.length !== 7) {
        continue;
      }

      const parityBit = toBit(vis[8].tone);
      if (parityBit === null) {
        continue;
      }
      visConfidence += vis[8].confidence;

      const ones = dataBits.reduce<number>((sum, bit) => sum + bit, 0);
      const evenParityBit = (ones % 2 === 0) ? 0 : 1;
      if (parityBit !== evenParityBit) {
        continue;
      }

      let visCode = 0;
      for (let bitIdx = 0; bitIdx < dataBits.length; bitIdx += 1) {
        if (dataBits[bitIdx] === 1) {
          visCode |= (1 << bitIdx);
        }
      }

      const timestamp = vis[9].timestamp;
      if (this.lastDetectedVisCode === visCode && (timestamp - this.lastDetectedAt) < 1500) {
        continue;
      }

      this.lastDetectedVisCode = visCode;
      this.lastDetectedAt = timestamp;
      const normalizedConfidence = Math.max(0, Math.min(1, visConfidence / 10));

      return {
        mode: visToMode(visCode),
        visCode,
        confidence: normalizedConfidence,
        signalHz,
        timestamp,
      };
    }

    return null;
  }

  private countRun(symbols: SymbolPoint[], start: number, tone: ToneSymbol): number {
    let count = 0;
    for (let i = start; i < symbols.length; i += 1) {
      if (symbols[i].tone !== tone) {
        break;
      }
      count += 1;
    }
    return count;
  }
}

