const alawmulaw = require('alawmulaw');

// Convert mulaw buffer (from Twilio 8kHz) to PCM16 buffer
function mulawToPCM16(mulawBuffer) {
  const samples = alawmulaw.mulaw.decode(mulawBuffer);
  const pcm16 = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    pcm16.writeInt16LE(samples[i], i * 2);
  }
  return pcm16;
}

// Convert PCM16 buffer to mulaw buffer (for Twilio 8kHz)
function pcm16ToMulaw(pcm16Buffer) {
  const samples = [];
  for (let i = 0; i < pcm16Buffer.length / 2; i++) {
    samples.push(pcm16Buffer.readInt16LE(i * 2));
  }
  return Buffer.from(alawmulaw.mulaw.encode(samples));
}

// Upsample PCM16 from 8kHz to 16kHz for Gemini
function upsample8kTo16k(buffer) {
  const output = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length / 2; i++) {
    const sample = buffer.readInt16LE(i * 2);
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(sample, i * 4 + 2);
  }
  return output;
}

// Downsample PCM16 from 24kHz to 8kHz for Twilio
function downsample24kTo8k(buffer) {
  const inputSamples = buffer.length / 2;
  const outputSamples = Math.floor(inputSamples / 3);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const s1 = buffer.readInt16LE(i * 6);
    const s2 = buffer.readInt16LE(i * 6 + 2);
    const s3 = buffer.readInt16LE(i * 6 + 4);
    const avg = Math.round((s1 + s2 + s3) / 3);
    output.writeInt16LE(avg, i * 2);
  }

  return output;
}

module.exports = {
  mulawToPCM16,
  pcm16ToMulaw,
  upsample8kTo16k,
  downsample24kTo8k
};