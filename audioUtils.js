// Convert mulaw (from Twilio) to PCM16 (for Gemini)
function mulawToPCM16(mulawBuffer) {
  const pcm16 = Buffer.alloc(mulawBuffer.length * 2);
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    const mulaw = ~mulawBuffer[i];
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0f;
    let sample = ((mantissa << 1) + 33) << exponent;
    sample -= 33;
    if (sign) sample = -sample;
    pcm16.writeInt16LE(sample, i * 2);
  }
  
  return pcm16;
}

// Convert PCM16 (from Gemini) to mulaw (for Twilio)
function pcm16ToMulaw(pcm16Buffer) {
  const mulaw = Buffer.alloc(pcm16Buffer.length / 2);
  
  for (let i = 0; i < mulaw.length; i++) {
    let sample = pcm16Buffer.readInt16LE(i * 2);
    const sign = sample < 0 ? 0x80 : 0x00;
    if (sample < 0) sample = -sample;
    if (sample > 32767) sample = 32767;
    sample += 33;
    let exponent = 7;
    let expMask = 0x4000;
    while (exponent > 0 && (sample & expMask) === 0) {
      exponent--;
      expMask >>= 1;
    }
    const mantissa = (sample >> (exponent + 1)) & 0x0f;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa);
  }
  
  return mulaw;
}

// Resample PCM16 from 8kHz to 16kHz (upsample for Gemini)
function upsample8kTo16k(buffer) {
  const output = Buffer.alloc(buffer.length * 2);
  for (let i = 0; i < buffer.length / 2; i++) {
    const sample = buffer.readInt16LE(i * 2);
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(sample, i * 4 + 2);
  }
  return output;
}

// Resample PCM16 from 16kHz to 8kHz (downsample for Twilio)
function downsample16kTo8k(buffer) {
  const output = Buffer.alloc(buffer.length / 2);
  for (let i = 0; i < output.length / 2; i++) {
    const sample = buffer.readInt16LE(i * 4);
    output.writeInt16LE(sample, i * 2);
  }
  return output;
}

module.exports = {
  mulawToPCM16,
  pcm16ToMulaw,
  upsample8kTo16k,
  downsample16kTo8k
};