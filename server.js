require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Health check
app.get('/', (req, res) => {
  res.send('Gemini Phone Bot is running');
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
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
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
          console.log('Received message from Gemini');

          // We will handle sending audio back to Twilio in the next step
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
        // We will forward audio to Gemini in the next step
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});