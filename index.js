import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import connectDB from './connection/dbConnnection.js';

import videoRoutes from './routes/videoRoutes.js';
import userRoutes from './routes/userRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import likeRoutes from './routes/likeRoutes.js';

dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import Video from './model/Video.js';

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/videos', videoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/likes', likeRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler - must be last middleware
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Socket.io setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Real-time views tracking
io.on('connection', (socket) => {
  // Join a room for a specific video
  socket.on('joinVideo', (videoId) => {
    socket.join(videoId);
  });

  // When a user views a video
  socket.on('viewVideo', async (videoId) => {
    try {
      // Atomically increment views in MongoDB
      const video = await Video.findByIdAndUpdate(
        videoId,
        { $inc: { views: 1 } },
        { new: true }
      );
      if (video) {
        // Broadcast updated views count to all clients in the room
        io.to(videoId).emit('viewsUpdate', { videoId, views: video.views });
      }
    } catch (err) {
      // Optionally emit error
      socket.emit('viewsError', { error: err.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
