"use client";

import { useEffect, useState } from "react";

async function playPrometheusSting() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return false;

  const audio = new AudioContextClass();
  await audio.resume();

  const start = audio.currentTime + 0.04;
  const master = audio.createGain();
  master.gain.value = 0.24;
  master.connect(audio.destination);

  // Soft cinematic bass impact.
  const impact = audio.createOscillator();
  const impactGain = audio.createGain();
  impact.type = "sine";
  impact.frequency.setValueAtTime(78, start);
  impact.frequency.exponentialRampToValueAtTime(38, start + 0.9);
  impactGain.gain.setValueAtTime(0.001, start);
  impactGain.gain.linearRampToValueAtTime(0.42, start + 0.025);
  impactGain.gain.exponentialRampToValueAtTime(0.001, start + 1.7);
  impact.connect(impactGain);
  impactGain.connect(master);
  impact.start(start);
  impact.stop(start + 1.15);

  // Airy rising sweep, made from generated noise and a moving filter.
  const noiseLength = Math.floor(audio.sampleRate * 3.2);
  const noiseBuffer = audio.createBuffer(1, noiseLength, audio.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLength * 0.35);
  }

  const noise = audio.createBufferSource();
  const sweepFilter = audio.createBiquadFilter();
  const sweepGain = audio.createGain();
  noise.buffer = noiseBuffer;
  sweepFilter.type = "lowpass";
  sweepFilter.frequency.setValueAtTime(180, start);
  sweepFilter.frequency.exponentialRampToValueAtTime(1800, start + 2.2);
  sweepGain.gain.setValueAtTime(0.001, start);
  sweepGain.gain.linearRampToValueAtTime(0.11, start + 1.35);
  sweepGain.gain.exponentialRampToValueAtTime(0.001, start + 3.1);
  noise.connect(sweepFilter);
  sweepFilter.connect(sweepGain);
  sweepGain.connect(master);
  noise.start(start);
  noise.stop(start + 3.2);

  // Warm, sustained chord to resolve the sting.
  [110, 164.81, 220].forEach((frequency, index) => {
    const tone = audio.createOscillator();
    const toneGain = audio.createGain();
    const chordStart = start + 0.7;
    tone.type = "triangle";
    tone.frequency.setValueAtTime(frequency, chordStart);
    toneGain.gain.setValueAtTime(0.001, chordStart);
    toneGain.gain.linearRampToValueAtTime([0.12, 0.075, 0.05][index], chordStart + 0.5);
    toneGain.gain.setValueAtTime([0.12, 0.075, 0.05][index], chordStart + 1.9);
    toneGain.gain.exponentialRampToValueAtTime(0.001, chordStart + 3.8);
    tone.connect(toneGain);
    toneGain.connect(master);
    tone.start(chordStart);
    tone.stop(chordStart + 3.9);
  });

  window.setTimeout(() => void audio.close(), 5000);
  return true;
}

export default function PrometheusLaunchIntro() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("prometheus-launch-seen") === "1") {
        const timer = window.setTimeout(() => setVisible(false), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {}

    void playPrometheusSting().catch(() => {});
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem("prometheus-launch-seen", "1");
      } catch {}
      setVisible(false);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);


  if (!visible) return null;

  return (
    <div className="prometheus-launch" role="status" aria-label="Prometheus is ready">
      <div className="prometheus-launch-content">
        <div className="prometheus-launch-symbol" aria-hidden="true">
          <span className="prometheus-launch-frame"><i /></span>
          <span className="prometheus-launch-line" />
        </div>
        <div className="prometheus-launch-wordmark">PROMETHEUS</div>
        <p>A private cinema, made for home.</p>

      </div>
    </div>
  );
}
