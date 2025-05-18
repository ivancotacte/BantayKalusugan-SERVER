import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import bodyParser from 'body-parser';
import { connectMongoDB, writeData, updateData, readData, refreshData } from './src/db/mongoConnection.js';
import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import nodemailer from 'nodemailer';
import OpenAI from "openai";

connectMongoDB();
const currentTime = moment().tz('Asia/Manila').format('YYYY-MM-DD-HH:mm:ss');
const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
});

// Queue management
let queue = {
  activeUser: null,
  waitingUsers: [],
  maxActiveUsers: 1
};

const processQueue = () => {
  if (queue.activeUser === null && queue.waitingUsers.length > 0) {
    queue.activeUser = queue.waitingUsers.shift();
    io.emit('queueUpdate', {
      userId: queue.activeUser,
      canProceed: true
    });
  }
};

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

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

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

app.post('/api/v1/queue/status', authorize, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  if (queue.activeUser === userId) {
    return res.status(200).json({ 
      success: true, 
      data: { 
        canProceed: true,
        position: 0,
        totalInQueue: queue.waitingUsers.length,
        currentUser: queue.activeUser
      } 
    });
  }

  const position = queue.waitingUsers.indexOf(userId) + 1;
  if (position > 0) {
    return res.status(200).json({ 
      success: true, 
      data: { 
        canProceed: false,
        position,
        totalInQueue: queue.waitingUsers.length,
        currentUser: queue.activeUser
      } 
    });
  }

  if (queue.activeUser === null && queue.waitingUsers.length === 0) {
    queue.activeUser = userId;
    return res.status(200).json({ 
      success: true, 
      data: { 
        canProceed: true,
        position: 0,
        totalInQueue: 0,
        currentUser: userId
      } 
    });
  }

  if (!queue.waitingUsers.includes(userId)) {
    queue.waitingUsers.push(userId);
  }

  const newPosition = queue.waitingUsers.indexOf(userId) + 1;
  return res.status(200).json({ 
    success: true, 
    data: { 
      canProceed: false,
      position: newPosition,
      totalInQueue: queue.waitingUsers.length,
      currentUser: queue.activeUser
    } 
  });
});

app.post('/api/v1/queue/complete', authorize, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  if (queue.activeUser === userId) {
    queue.activeUser = null;
    processQueue();
    return res.status(200).json({ success: true, message: 'Session completed.' });
  }

  return res.status(400).json({ success: false, message: 'User is not the active user.' });
});

app.post('/api/v1/queue/leave', authorize, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  if (queue.activeUser === userId) {
    queue.activeUser = null;
    processQueue();
    return res.status(200).json({ 
      success: true, 
      message: 'User left monitoring page.',
      data: {
        nextUserCanProceed: queue.waitingUsers.length > 0
      }
    });
  }

  const userIndex = queue.waitingUsers.indexOf(userId);
  if (userIndex !== -1) {
    queue.waitingUsers.splice(userIndex, 1);
    return res.status(200).json({ 
      success: true, 
      message: 'User removed from queue.',
      data: {
        nextUserCanProceed: false
      }
    });
  }

  return res.status(200).json({ 
    success: true, 
    message: 'User was not in queue.',
    data: {
      nextUserCanProceed: false
    }
  });
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

app.post('/api/v1/users', authorize, async (req, res) => {
  const { heartRate, SpO2, weight, userId } = req.body;

  try {
    const users = await readData('users', { userId });
    const user = users?.[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const openai = new OpenAI({
      baseURL: process.env.DEEPSEEK_BASE_URL,
      apiKey: process.env.DEEPSEEK_API_KEY,
    });

    const completion = await openai.chat.completions.create(
      {
        messages: [
          { role: 'user', content: `Given the following health data, provide a brief analysis:\nHeart Rate: ${heartRate}\nSpO2: ${SpO2}\nWeight: ${weight}` },
        ],
        model: 'deepseek/deepseek-prover-v2:free',
      }
    );

    const response = completion.choices[0].message.content;

    const mailOptions = {
      from: '"ICCT SAN MATEO 👻" <cotactearmenion@gmail.com>',
      to: user.data.email,
      subject: 'Health Monitoring Update',
      text: `Hello ${user.data.firstName},\n\nHere is your health data analysis:\n\n${response}\n\nBest regards,\nICCT Health Monitoring Team`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
        return res.status(500).json({ success: false, message: 'Error sending email.' });
      }
      console.log('Email sent:', info.response);
    });

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
      updated_at: currentTime,
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