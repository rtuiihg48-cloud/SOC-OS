import fs from "fs";
import os from "os";

interface CpuSample {
  idle: number;
  total: number;
}

function readCpuSample(): CpuSample {
  try {
    const stat = fs.readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n")[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return { idle: 0, total: 1 };
  }
}

let lastSample: CpuSample | null = null;
let lastSampleTime = 0;

async function getCpuPercent(): Promise<number> {
  const now = Date.now();
  const sample1 = readCpuSample();

  if (lastSample && now - lastSampleTime < 10_000) {
    const idleDelta = sample1.idle - lastSample.idle;
    const totalDelta = sample1.total - lastSample.total;
    lastSample = sample1;
    lastSampleTime = now;
    if (totalDelta === 0) return 0;
    return Math.round((1 - idleDelta / totalDelta) * 100 * 10) / 10;
  }

  // Take two samples 100ms apart for a fresh reading
  return new Promise((resolve) => {
    const s1 = readCpuSample();
    setTimeout(() => {
      const s2 = readCpuSample();
      const idleDelta = s2.idle - s1.idle;
      const totalDelta = s2.total - s1.total;
      lastSample = s2;
      lastSampleTime = Date.now();
      if (totalDelta === 0) {
        resolve(0);
        return;
      }
      resolve(Math.round((1 - idleDelta / totalDelta) * 100 * 10) / 10);
    }, 100);
  });
}

function getMemoryStats(): { usedMb: number; totalMb: number; percent: number } {
  try {
    const mem = fs.readFileSync("/proc/meminfo", "utf8");
    const parse = (key: string): number => {
      const match = mem.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1], 10) * 1024 : 0;
    };
    const total = parse("MemTotal");
    const free = parse("MemFree");
    const buffers = parse("Buffers");
    const cached = parse("Cached");
    const sReclaimable = parse("SReclaimable");
    const used = total - free - buffers - cached - sReclaimable;
    const totalMb = Math.round(total / 1024 / 1024);
    const usedMb = Math.max(0, Math.round(used / 1024 / 1024));
    return { usedMb, totalMb, percent: totalMb ? Math.round((usedMb / totalMb) * 100) : 0 };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const totalMb = Math.round(total / 1024 / 1024);
    const usedMb = Math.round(used / 1024 / 1024);
    return { usedMb, totalMb, percent: Math.round((usedMb / totalMb) * 100) };
  }
}

function getLoadAvg(): [number, number, number] {
  try {
    const load = fs.readFileSync("/proc/loadavg", "utf8");
    const parts = load.trim().split(/\s+/);
    return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
  } catch {
    const load = os.loadavg();
    return [load[0], load[1], load[2]];
  }
}

function getUptime(): number {
  try {
    const uptime = fs.readFileSync("/proc/uptime", "utf8");
    return parseFloat(uptime.trim().split(/\s+/)[0]);
  } catch {
    return os.uptime();
  }
}

export async function getSystemMetrics() {
  const [cpuPercent, mem, [la1, la5, la15], uptimeSeconds] = await Promise.all([
    getCpuPercent(),
    Promise.resolve(getMemoryStats()),
    Promise.resolve(getLoadAvg()),
    Promise.resolve(getUptime()),
  ]);

  return {
    cpuPercent,
    memPercent: mem.percent,
    memUsedMb: mem.usedMb,
    memTotalMb: mem.totalMb,
    loadAvg1m: la1,
    loadAvg5m: la5,
    loadAvg15m: la15,
    uptimeSeconds,
  };
}
