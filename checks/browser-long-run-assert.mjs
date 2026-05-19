import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const options = {
    minSamples: 2,
    minCurrentTimeAdvanceSec: 1,
    maxDroppedFrameRatio: 0.2,
    maxMemoryGrowthMb: 256,
    maxDomVideoGrowth: 0,
    maxDomAudioGrowth: 0,
    maxDomUiShellGrowth: 0,
    maxErrorEvents: 0,
    maxStallSamples: 3,
    expectLive: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;

    if (!arg.startsWith('--')) {
      if (!options.reportPath) {
        options.reportPath = arg;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const readValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;
      return value;
    };
    const readNumber = () => {
      const value = Number(readValue());
      if (!Number.isFinite(value)) throw new Error(`Invalid number for --${key}`);
      return value;
    };

    switch (key) {
      case 'report':
        options.reportPath = readValue();
        break;
      case 'require-tech':
        options.requireTech = readValue();
        break;
      case 'min-samples':
        options.minSamples = readNumber();
        break;
      case 'min-duration-sec':
        options.minDurationSec = readNumber();
        break;
      case 'min-current-time-advance-sec':
        options.minCurrentTimeAdvanceSec = readNumber();
        break;
      case 'max-dropped-frame-ratio':
        options.maxDroppedFrameRatio = readNumber();
        break;
      case 'max-memory-growth-mb':
        options.maxMemoryGrowthMb = readNumber();
        break;
      case 'max-dom-video-growth':
        options.maxDomVideoGrowth = readNumber();
        break;
      case 'max-dom-audio-growth':
        options.maxDomAudioGrowth = readNumber();
        break;
      case 'max-dom-ui-shell-growth':
        options.maxDomUiShellGrowth = readNumber();
        break;
      case 'max-error-events':
        options.maxErrorEvents = readNumber();
        break;
      case 'max-fatal-network-events':
        options.maxFatalNetworkEvents = readNumber();
        break;
      case 'max-stall-samples':
        options.maxStallSamples = readNumber();
        break;
      case 'expect-live':
        options.expectLive = true;
        break;
      case 'help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option --${key}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node checks/browser-long-run-assert.mjs REPORT [options]
  node checks/browser-long-run-assert.mjs --report .fyra-long-run/hls-edge-30m.json

Options:
  --require-tech hls               Require at least one observed Tech
  --expect-live                    Fail if final video ended or currentTime stalls
  --min-samples 150                Minimum collected sample count
  --min-duration-sec 1740          Minimum sampled elapsed duration
  --min-current-time-advance-sec 60
                                   Minimum media time advance
  --max-dropped-frame-ratio 0.2    Maximum dropped-frame ratio, using deltas
  --max-memory-growth-mb 256       Maximum JS heap growth when memory is available
  --max-dom-video-growth 0         Maximum video element count growth
  --max-dom-audio-growth 0         Maximum audio element count growth
  --max-dom-ui-shell-growth 0      Maximum UI shell count growth
  --max-error-events 0             Maximum public error event count
  --max-fatal-network-events 0     Optional cap for fatal network events
  --max-stall-samples 3            Consecutive non-advancing live samples allowed
`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pickVideo(sample) {
  return sample?.video || null;
}

function pickDom(sample) {
  return sample?.dom || null;
}

function normalizeReport(raw) {
  if (Array.isArray(raw)) {
    const samples = raw;
    const lastSample = samples[samples.length - 1] || null;
    return {
      startedAt: samples[0]?.ts || null,
      finishedAt: lastSample?.ts || null,
      requestedSource: lastSample?.source || null,
      durationMs: (lastSample?.elapsedSec || 0) * 1000,
      state: lastSample?.state || null,
      quality: lastSample?.quality || null,
      events: [],
      errors: [],
      samples,
      finalVideo: pickVideo(lastSample),
      dom: pickDom(lastSample)
    };
  }

  return {
    ...raw,
    events: asArray(raw.events),
    errors: asArray(raw.errors),
    samples: asArray(raw.samples)
  };
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function getCurrentTime(sample) {
  return pickVideo(sample)?.currentTime;
}

function getFrameStats(samples, finalVideo) {
  const withFrames = samples.filter((sample) =>
    Number.isFinite(pickVideo(sample)?.totalFrames) &&
    Number.isFinite(pickVideo(sample)?.droppedFrames)
  );
  const first = withFrames[0]?.video || null;
  const last = withFrames[withFrames.length - 1]?.video || finalVideo || null;

  const totalDelta = first && last ? Math.max(0, last.totalFrames - first.totalFrames) : null;
  const droppedDelta = first && last ? Math.max(0, last.droppedFrames - first.droppedFrames) : null;
  const ratio = totalDelta && droppedDelta !== null
    ? droppedDelta / totalDelta
    : Number.isFinite(last?.totalFrames) && last.totalFrames > 0
      ? last.droppedFrames / last.totalFrames
      : null;

  return {
    totalFrames: last?.totalFrames ?? null,
    droppedFrames: last?.droppedFrames ?? null,
    totalFrameDelta: totalDelta,
    droppedFrameDelta: droppedDelta,
    droppedFrameRatio: ratio
  };
}

function getMemoryStats(samples) {
  const values = samples
    .map((sample) => sample?.memory?.usedJSHeapSize)
    .filter((value) => Number.isFinite(value));
  const start = values[0] ?? null;
  const end = values[values.length - 1] ?? null;
  const max = values.length ? Math.max(...values) : null;
  const delta = start !== null && end !== null ? end - start : null;
  return {
    start,
    end,
    max,
    delta,
    deltaMb: delta !== null ? delta / (1024 * 1024) : null
  };
}

function getDomStats(samples, finalDom) {
  const keys = ['video', 'audio', 'uiShell'];
  const stats = {};
  for (const key of keys) {
    const values = samples
      .map((sample) => pickDom(sample)?.[key])
      .filter((value) => Number.isFinite(value));
    if (!values.length && finalDom && Number.isFinite(finalDom[key])) values.push(finalDom[key]);
    stats[key] = {
      start: values[0] ?? null,
      end: values[values.length - 1] ?? null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      growth: values.length ? values[values.length - 1] - values[0] : null
    };
  }
  return stats;
}

function getElapsedSec(samples, report) {
  const firstElapsed = samples[0]?.elapsedSec;
  const lastElapsed = samples[samples.length - 1]?.elapsedSec;
  if (Number.isFinite(firstElapsed) && Number.isFinite(lastElapsed)) {
    return Math.max(0, lastElapsed - firstElapsed);
  }
  if (Number.isFinite(report.durationMs)) return report.durationMs / 1000;
  return null;
}

function getLongestStallRun(samples) {
  let longest = 0;
  let current = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prevTime = getCurrentTime(samples[i - 1]);
    const nextTime = getCurrentTime(samples[i]);
    const ended = !!pickVideo(samples[i])?.ended;
    if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && !ended && nextTime <= prevTime + 0.05) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function collectTechs(report, samples) {
  const techs = new Set();
  for (const sample of samples) {
    if (sample?.tech) techs.add(sample.tech);
    if (sample?.quality?.tech) techs.add(sample.quality.tech);
    if (sample?.lastStats?.tech) techs.add(sample.lastStats.tech);
  }
  if (report.quality?.tech) techs.add(report.quality.tech);
  if (report.summary?.tech) techs.add(report.summary.tech);
  return Array.from(techs).sort();
}

function buildCheck(name, ok, detail) {
  return { name, ok: !!ok, detail };
}

function assertReport(report, options) {
  const samples = report.samples;
  const firstSample = samples[0] || null;
  const lastSample = samples[samples.length - 1] || null;
  const finalVideo = report.finalVideo || pickVideo(lastSample) || null;
  const finalDom = report.dom || pickDom(lastSample) || null;
  const firstTime = firstDefined([getCurrentTime(firstSample), report.startedCurrentTime, 0]) || 0;
  const lastTime = firstDefined([getCurrentTime(lastSample), finalVideo?.currentTime, firstTime]) || firstTime;
  const currentTimeAdvanceSec = Math.max(0, lastTime - firstTime);
  const events = asArray(report.events);
  const errorEvents = events.filter((event) => event.name === 'error');
  const fatalNetworkEvents = events.filter((event) =>
    event.name === 'network' && (event.payload?.fatal || event.payload?.severity === 'fatal')
  );
  const state = report.state || lastSample?.state || null;
  const finalReadyState = finalVideo?.readyState ?? null;
  const ended = !!finalVideo?.ended || state === 'ended';
  const frameStats = getFrameStats(samples, finalVideo);
  const memoryStats = getMemoryStats(samples);
  const domStats = getDomStats(samples, finalDom);
  const elapsedSec = getElapsedSec(samples, report);
  const longestStallRun = getLongestStallRun(samples);
  const techs = collectTechs(report, samples);
  const playable = (finalReadyState ?? 0) >= 2
    && (currentTimeAdvanceSec >= options.minCurrentTimeAdvanceSec || ended || (frameStats.totalFrameDelta ?? 0) > 0);
  const unresolvedFatal = fatalNetworkEvents.length > 0 && (state === 'error' || !playable);

  const checks = [
    buildCheck('sample-count', samples.length >= options.minSamples, `${samples.length} >= ${options.minSamples}`),
    buildCheck('playable-final-state', playable, `state=${state || 'unknown'}, readyState=${finalReadyState ?? 'unknown'}`),
    buildCheck(
      'current-time-advanced',
      currentTimeAdvanceSec >= options.minCurrentTimeAdvanceSec || ended,
      `${currentTimeAdvanceSec.toFixed(3)}s >= ${options.minCurrentTimeAdvanceSec}s`
    ),
    buildCheck('unresolved-fatal-network', !unresolvedFatal, `${fatalNetworkEvents.length} fatal network event(s), state=${state || 'unknown'}`),
    buildCheck('error-events', errorEvents.length <= options.maxErrorEvents, `${errorEvents.length} <= ${options.maxErrorEvents}`)
  ];

  if (options.requireTech) {
    checks.push(buildCheck('required-tech', techs.includes(options.requireTech), `observed=${techs.join(',') || 'none'}, required=${options.requireTech}`));
  }

  if (Number.isFinite(options.minDurationSec)) {
    checks.push(buildCheck('sampled-duration', elapsedSec !== null && elapsedSec >= options.minDurationSec, `${elapsedSec ?? 'unknown'}s >= ${options.minDurationSec}s`));
  }

  if (frameStats.droppedFrameRatio !== null && Number.isFinite(options.maxDroppedFrameRatio)) {
    checks.push(buildCheck(
      'dropped-frame-ratio',
      frameStats.droppedFrameRatio <= options.maxDroppedFrameRatio,
      `${frameStats.droppedFrameRatio.toFixed(4)} <= ${options.maxDroppedFrameRatio}`
    ));
  }

  if (memoryStats.deltaMb !== null && Number.isFinite(options.maxMemoryGrowthMb)) {
    checks.push(buildCheck(
      'memory-growth',
      memoryStats.deltaMb <= options.maxMemoryGrowthMb,
      `${memoryStats.deltaMb.toFixed(2)} MiB <= ${options.maxMemoryGrowthMb} MiB`
    ));
  }

  checks.push(buildCheck('dom-video-growth', (domStats.video.growth ?? 0) <= options.maxDomVideoGrowth, `${domStats.video.growth ?? 'unknown'} <= ${options.maxDomVideoGrowth}`));
  checks.push(buildCheck('dom-audio-growth', (domStats.audio.growth ?? 0) <= options.maxDomAudioGrowth, `${domStats.audio.growth ?? 'unknown'} <= ${options.maxDomAudioGrowth}`));
  checks.push(buildCheck('dom-ui-shell-growth', (domStats.uiShell.growth ?? 0) <= options.maxDomUiShellGrowth, `${domStats.uiShell.growth ?? 'unknown'} <= ${options.maxDomUiShellGrowth}`));

  if (Number.isFinite(options.maxFatalNetworkEvents)) {
    checks.push(buildCheck('fatal-network-events', fatalNetworkEvents.length <= options.maxFatalNetworkEvents, `${fatalNetworkEvents.length} <= ${options.maxFatalNetworkEvents}`));
  }

  if (options.expectLive) {
    checks.push(buildCheck('live-not-ended', !ended, `ended=${ended}`));
    checks.push(buildCheck('live-stall-run', longestStallRun <= options.maxStallSamples, `${longestStallRun} <= ${options.maxStallSamples}`));
  }

  return {
    reportPath: resolve(options.reportPath),
    source: report.requestedSource || lastSample?.source || null,
    startedAt: report.startedAt || null,
    finishedAt: report.finishedAt || null,
    durationMs: report.durationMs ?? null,
    sampledElapsedSec: elapsedSec,
    sampleCount: samples.length,
    state,
    techs,
    finalReadyState,
    currentTimeStart: firstTime,
    currentTimeEnd: lastTime,
    currentTimeAdvanceSec,
    ended,
    frameStats,
    memoryStats,
    domStats,
    errorEventCount: errorEvents.length,
    fatalNetworkEventCount: fatalNetworkEvents.length,
    longestStallRun,
    checks,
    pass: checks.every((check) => check.ok)
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.reportPath) {
    throw new Error('Missing report path. Pass a positional REPORT or --report.');
  }

  const reportPath = resolve(options.reportPath);
  const raw = JSON.parse(readFileSync(reportPath, 'utf8'));
  const summary = assertReport(normalizeReport(raw), options);
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.pass) {
    const failed = summary.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
    console.error(`Long-run assertion failed:\n- ${failed.join('\n- ')}`);
    process.exitCode = 1;
  }
}

main();
