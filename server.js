import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import bodyParser from 'body-parser';
import { connectMongoDB, writeData, updateData, readData, refreshData } from './src/db/mongoConnection.js';
import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();
connectMongoDB();
const currentTime = moment().tz('Asia/Manila').format('YYYY-MM-DD-HH:mm:ss');
const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: process.env.FRONTEND_URL, credentials: true } });

const transporter = nodemailer.createTransport({
    service: "gmail",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_ADDRESS,
        pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false,
    },
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const authorize = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Missing Authorization header.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token || token !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid token.' });
  }

  next();
};

app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Welcome to the Health Monitoring API!' });
});

app.post('/api/v1/test', authorize, async (req, res) => {
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

app.post('/api/v1/users/register', authorize, async (req, res) => {
  const { firstName, lastName, email, age, contactNumber, gender } = req.body;

  if (!firstName || !lastName || !email || !age || !contactNumber || !gender) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  try {
    const userData = {
      userId: uuidv4(),
      data: {
        firstName,
        lastName,
        email,
        age,
        contactNumber,
        gender,
        healthStatus: { heartRate: null, SpO2: null, weight: null },
      },
      created_at: currentTime,
      updated_at: currentTime,
    };

    await writeData('users', userData);
    await refreshData();

    return res.status(201).json({ success: true, message: 'User registered.', data: userData });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/v1/users/:userId', authorize, async (req, res) => {
  const { userId } = req.params;
  const { heartRate, SpO2, weight } = req.body;

  try {
    const users = await readData('users', { userId });
    const user = users?.[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const updatedData = {
      data: {
        ...user.data,
        healthStatus: {
          heartRate: heartRate || user.data.healthStatus.heartRate,
          SpO2: SpO2 || user.data.healthStatus.SpO2,
          weight: weight || user.data.healthStatus.weight,
        },
      },
      created_at: user.created_at,
      updated_at: getCurrentTime(),
    };

    await updateData('users', { userId }, updatedData);
    await refreshData();

    return res.status(200).json({ success: true, message: 'User updated.', data: updatedData });
  } catch (err) {
    console.error('Update error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

httpServer.listen(PORT, () => {
  console.log(`Server (with Socket.IO) is running on port ${PORT}`);
});
