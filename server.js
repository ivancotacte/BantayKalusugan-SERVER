import express from 'express';
import bodyParser from 'body-parser';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173', // Allowing your frontend URL
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/', (req, res) => {
    res.status(200).json({ success: true, message: 'Welcome to the Health Monitoring API!' });
});

app.post('/api/v1/test', async (req, res) => {
    const { heartRate, SpO2, weight } = req.body;
  
    if (weight) {
      const payload = { weight, timestamp: new Date().toISOString() };
      io.emit('healthData', payload);
      return res.status(200).json({ success: true, message: 'Weight received.', weight });
    }
  
    if (heartRate && SpO2) {
      const payload = { heartRate, SpO2, timestamp: new Date().toISOString() };
      io.emit('healthData', payload);
      return res.status(200).json({ success: true, message: 'Heart rate and SpO2 received.', heartRate, SpO2 });
    }
  
    return res.status(400).json({ success: false, message: 'Invalid data. Provide heart rate, SpO2, or weight.' });
});

httpServer.listen(PORT, () => {
    console.log(`Server (with Socket.IO) is running on port ${PORT}`);
});