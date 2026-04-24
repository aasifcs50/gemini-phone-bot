require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

// Create WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Twilio media stream connected');

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.event) {
      case 'connected':
        console.log('Twilio stream connected event received');
        break;
      case 'start':
        console.log('Twilio stream started:', data.start);
        break;
      case 'media':
        console.log('Received audio chunk from Twilio');
        break;
      case 'stop':
        console.log('Twilio stream stopped');
        break;
    }
  });

  ws.on('close', () => {
    console.log('Twilio media stream disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});