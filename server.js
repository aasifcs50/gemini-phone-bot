require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');
const alawmulaw = require('alawmulaw');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

console.log('GEMINI_API_KEY set:', !!process.env.GEMINI_API_KEY);
console.log('PORT:', process.env.PORT);

app.get('/', (req, res) => {
  res.send('Gemini Phone Bot is running');
});

app.get('/test-gemini', async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Say hello in one sentence.'
    });
    res.send('Gemini connected: ' + response.text);
  } catch (error) {
    res.status(500).send('Gemini error: ' + error.message);
  }
});

app.post('/twiml', (req, res) => {
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/twilio-stream"/>
  </Connect>
</Response>`);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/twilio-stream' });

wss.on('connection', async (twilioWs) => {
  console.log('Twilio connected');

  let geminiSession = null;
  let streamSid = null;
  let audioQueue = [];
  let geminiReady = false;

  // Convert mulaw 8kHz (from Twilio) to PCM16 16kHz (for Gemini)
  function twilioToPCM16(mulawBuffer) {
    const samples = alawmulaw.mulaw.decode(mulawBuffer);
    const upsampled = new Int16Array(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      upsampled[i * 2] = samples[i];
      upsampled[i * 2 + 1] = samples[i];
    }
    return Buffer.from(upsampled.buffer);
  }

  // Convert PCM16 24kHz (from Gemini) to mulaw 8kHz (for Twilio)
  function pcm16ToTwilio(pcm16Buffer) {
    const inputSamples = pcm16Buffer.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    const downsampled = new Int16Array(outputSamples);
    for (let i = 0; i < outputSamples; i++) {
      const s1 = pcm16Buffer.readInt16LE(i * 6);
      const s2 = pcm16Buffer.readInt16LE(i * 6 + 2);
      const s3 = pcm16Buffer.readInt16LE(i * 6 + 4);
      downsampled[i] = Math.round((s1 + s2 + s3) / 3);
    }
    const encoded = alawmulaw.mulaw.encode(downsampled);
    return Buffer.from(encoded);
  }

  // Start Gemini session
  try {
    geminiSession = await ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-latest',
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }
          }
        },
        systemInstruction: {
          parts: [{
            text: 'You are a helpful and friendly phone assistant. Keep your responses concise and conversational.'
          }]
        }
      },
      callbacks: {
        onopen: () => {
          console.log('Gemini session opened');
        },
        onmessage: (message) => {
          // Handle setup complete
          if (message.setupComplete !== undefined) {
            console.log('Gemini setup complete, sending greeting');
            geminiReady = true;

            try {
              geminiSession.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ text: 'Please greet the caller warmly and ask how you can help them today.' }]
                }],
                turnComplete: true
              });
              console.log('Greeting sent');

              // Flush queued audio
              if (audioQueue.length > 0) {
                console.log('Flushing', audioQueue.length, 'queued audio chunks');
                audioQueue.forEach(chunk => {
                  geminiSession.sendRealtimeInput({
                    audio: {
                      data: chunk,
                      mimeType: 'audio/pcm;rate=16000'
                    }
                  });
                });
                audioQueue = [];
              }
            } catch (err) {
              console.error('Error sending greeting:', err);
            }
          }

          // Handle audio from Gemini
          if (
            message.serverContent &&
            message.serverContent.modelTurn &&
            message.serverContent.modelTurn.parts
          ) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData && part.inlineData.data) {
                try {
                  const pcm16Buffer = Buffer.from(part.inlineData.data, 'base64');
                  const mulawBuffer = pcm16ToTwilio(pcm16Buffer);
                  const payload = mulawBuffer.toString('base64');

                  console.log('Sending audio to Twilio, bytes:', mulawBuffer.length, 'streamSid:', streamSid);

                  if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
                    twilioWs.send(JSON.stringify({
                      event: 'media',
                      streamSid: streamSid,
                      media: { payload }
                    }));
                  }
                } catch (err) {
                  console.error('Error converting Gemini audio:', err);
                }
              }
            }
          }

          // Send mark when generation is complete
          if (message.serverContent && message.serverContent.generationComplete) {
            console.log('Gemini finished speaking, sending mark');
            if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
              twilioWs.send(JSON.stringify({
                event: 'mark',
                streamSid: streamSid,
                mark: { name: 'done' }
              }));
            }
          }
        },
        onerror: (error) => {
          console.error('Gemini error:', error);
        },
        onclose: () => {
          console.log('Gemini session closed');
        }
      }
    });

    console.log('Gemini session created');
  } catch (error) {
    console.error('Failed to create Gemini session:', error);
    twilioWs.close();
    return;
  }

  // Handle Twilio messages
 twilioWs.on('message', (message) => {
    try {
      const raw = message.toString();
      const data = JSON.parse(raw);
      console.log('Twilio event:', data.event);

      switch (data.event) {
        case 'connected':
          console.log('Twilio stream connected');
          break;

        case 'start':
  console.log('Start event data:', JSON.stringify(data));
  streamSid = data.start.streamSid;
  console.log('Stream started, SID:', streamSid);
  break;

        case 'media':
          const mulawBuffer = Buffer.from(data.media.payload, 'base64');
          const pcm16Buffer = twilioToPCM16(mulawBuffer);
          const audioData = pcm16Buffer.toString('base64');

          if (!geminiReady) {
            audioQueue.push(audioData);
          } else {
            geminiSession.sendRealtimeInput({
              audio: {
                data: audioData,
                mimeType: 'audio/pcm;rate=16000'
              }
            });
          }
          break;

        case 'stop':
          console.log('Stream stopped');
          if (geminiSession) geminiSession.close();
          break;
      }
    } catch (err) {
      console.error('Error handling Twilio message:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio disconnected');
    if (geminiSession) geminiSession.close();
  });

  twilioWs.on('error', (err) => {
    console.error('Twilio WebSocket error:', err);
  });
});

const PORT = process.env.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});