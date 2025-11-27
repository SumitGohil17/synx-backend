import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import videoRoutes from './routes/videoRoutes.js';
import userRoutes from './routes/userRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import likeRoutes from './routes/likeRoutes.js';
import videoRoomRoutes from './routes/videoRoomRoutes.js';
import watchHistoryRoutes from './routes/watchHistoryRoutes.js';
import viewRoutes from './routes/viewRoutes.js';

dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import prisma from './connection/prismaConnection.js';
import { setupVideoRoomSocket } from './sockets/videoRoomSocket.js';
import { countViewSocket } from './controller/viewController.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors(
  {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true
  }
));

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
app.use('/api/rooms', videoRoomRoutes);
app.use('/api/watch-history', watchHistoryRoutes);
app.use('/api/views', viewRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'OK',
      message: 'Server is running',
      database: 'PostgreSQL Connected',
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed',
      database: 'PostgreSQL Disconnected',
      error: error.message
    });
  }
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

// Real-time views tracking with deduplication
io.on('connection', (socket) => {
  // Join a room for a specific video
  socket.on('joinVideo', (videoId) => {
    socket.join(videoId);
  });

  // When a user views a video - uses scalable deduplication
  socket.on('viewVideo', async (data) => {
    try {
      const { videoId, userId, watchTime } = typeof data === 'object' 
        ? data 
        : { videoId: data, userId: null, watchTime: 5 };

      // Get IP and User-Agent from socket handshake
      const ip = socket.handshake.headers['x-forwarded-for'] || 
                 socket.handshake.address || 
                 'unknown';
      const userAgent = socket.handshake.headers['user-agent'] || 'unknown';

      // Use the scalable view counting system
      const result = await countViewSocket(videoId, {
        userId,
        watchTime: watchTime || 5,
        ip,
        userAgent
      });

      if (result.success) {
        // Get current view count
        const video = await prisma.video.findUnique({
          where: { id: videoId },
          select: { views: true }
        });
        
        if (video) {
          // Broadcast updated views count to all clients in the room
          io.to(videoId).emit('viewsUpdate', { 
            videoId, 
            views: video.views,
            counted: result.counted,
            message: result.message
          });
        }
      } else {
        socket.emit('viewsInfo', { 
          videoId, 
          message: result.message,
          counted: false
        });
      }
    } catch (err) {
      socket.emit('viewsError', { error: err.message });
    }
  });
});

// Setup video room WebSocket handlers
setupVideoRoomSocket(io);

server.listen(PORT, async () => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    console.log(`Server is running on http://localhost:${PORT}`);

  } catch (error) {
    console.error('❌ Database Connection Failed:', error.message);
    console.error('Please check your DATABASE_URL in .env file');
    process.exit(1);
  }
});
