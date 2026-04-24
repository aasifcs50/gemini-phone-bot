require('dotenv').config();
console.log('GEMINI_API_KEY set:', !!process.env.GEMINI_API_KEY);
console.log('PORT:', process.env.PORT);
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');
const { mulawToPCM16, pcm16ToMulaw, upsample8kTo16k, downsample16kTo8k } = require('./audioUtils');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Health check
app.get('/', (req, res) => {
  res.send('Gemini Phone Bot is running');
});

// Test Gemini API key
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

// TwiML webhook - Twilio calls this when a call comes in
app.post('/twiml', (req, res) => {
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/twilio-stream"/>
  </Connect>
</Response>`);
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', async (twilioWs) => {
  console.log('Twilio media stream connected');

  let geminiSession = null;
  let streamSid = null;

  // Start Gemini Live session
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
          console.log('Gemini Live session opened');
        },
        onmessage: async (message) => {
          try {
            if (
              message.serverContent &&
              message.serverContent.modelTurn &&
              message.serverContent.modelTurn.parts
            ) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const pcm16Buffer = Buffer.from(part.inlineData.data, 'base64');
                  const downsampled = downsample16kTo8k(pcm16Buffer);
                  const mulawBuffer = pcm16ToMulaw(downsampled);
                  const payload = mulawBuffer.toString('base64');

                  if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
                    twilioWs.send(JSON.stringify({
                      event: 'media',
                      streamSid: streamSid,
                      media: { payload }
                    }));
                  }
                }
              }
            }
          } catch (err) {
            console.error('Error processing Gemini audio:', err);
          }
        },
        onerror: (error) => {
          console.error('Gemini Live error:', error);
        },
        onclose: () => {
          console.log('Gemini Live session closed');
        }
      }
    });

    console.log('Gemini Live session created successfully');
  } catch (error) {
    console.error('Failed to connect to Gemini Live:', error);
    twilioWs.close();
    return;
  }

  // Handle messages from Twilio
  twilioWs.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.event) {
      case 'connected':
        console.log('Twilio stream connected event received');
        break;

      case 'start':
        streamSid = data.start.streamSid;
        console.log('Twilio stream started, streamSid:', streamSid);
        break;

      case 'media':
        try {
          if (geminiSession) {
            const mulawBuffer = Buffer.from(data.media.payload, 'base64');
            const pcm16Buffer = mulawToPCM16(mulawBuffer);
            const upsampled = upsample8kTo16k(pcm16Buffer);

            geminiSession.sendRealtimeInput({
              audio: {
                data: upsampled.toString('base64'),
                mimeType: 'audio/pcm;rate=16000'
              }
            });
          }
        } catch (err) {
          console.error('Error sending audio to Gemini:', err);
        }
        break;

      case 'stop':
        console.log('Twilio stream stopped');
        if (geminiSession) {
          geminiSession.close();
        }
        break;
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio media stream disconnected');
    if (geminiSession) {
      geminiSession.close();
    }
  });

  twilioWs.on('error', (err) => {
    console.error('Twilio WebSocket error:', err);
  });
});

const PORT = process.env.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});