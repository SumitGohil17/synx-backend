# Synx Backend 🎥

A scalable, feature-rich video streaming platform backend built with Node.js, Express, PostgreSQL, Redis, and Socket.IO. This backend powers a YouTube-like experience with video uploads, transcoding, real-time features, and advanced caching.

## 🌟 Features

### Core Features
- **Video Management**: Upload, transcode, and stream videos with HLS adaptive bitrate streaming
- **Shorts Support**: short-form video uploads and playback
- **User Authentication**: User registration and OAuth integration with Supabase
- **Social Features**: Like, comment, subscribe functionality
- **Watch History**: watch history with continue watching support
- **Real-time Video Rooms**: Watch videos together with friends using Socket.IO
- **AI-Powered Video Analysis**: Automatic video content analysis using Google Gemini AI
- **Advanced Caching**: Redis-based caching for performance optimization
- **View Counting**: YouTube-style reliable view counting with deduplication
- **Scalable Architecture**: Designed for horizontal scaling and high performance

### Technical Highlights
- **HLS Adaptive Streaming**: Multiple quality levels (360p, 480p, 720p, 1080p)
- **FFmpeg Video Processing**: Advanced video transcoding and frame extraction
- **AWS S3 Storage**: Cloud storage for video assets
- **PostgreSQL Database**: Robust relational database with Prisma ORM
- **Redis Caching**: Fast in-memory caching for frequently accessed data
- **Socket.IO**: Real-time bidirectional communication
- **Docker Support**: Containerized deployment ready

## 🏗️ Architecture

### Tech Stack
- **Runtime**: Node.js 18.x
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL 15 with Prisma ORM
- **Cache**: Redis (Upstash)
- **Storage**: AWS S3
- **Video Processing**: FFmpeg
- **AI**: Google Gemini AI
- **Real-time**: Socket.IO
- **Deployment**: Docker, Vercel

### Project Structure
```
synx-backend/
├── config/                 # Configuration files
├── connection/            # Database connections
│   ├── prismaConnection.js    # PostgreSQL (Prisma)
│   ├── redisConnection.js     # Redis cache
│   └── dbConnection.js        # MongoDB (legacy)
├── controller/            # Business logic
│   ├── videoControllerPostgres.js
│   ├── shortsController.js
│   ├── userControllerPostgres.js
│   ├── commentControllerPostgres.js
│   ├── likeControllerPostgres.js
│   ├── subscribeController.js
│   ├── watchHistoryController.js
��   ├── viewController.js
│   └── videoRoomController.js
├── middleware/            # Express middleware
│   ├── upload.js              # Multer file upload
│   └── validation.js          # Input validation
├── prisma/               # Prisma schema & migrations
│   ├── schema.prisma
│   └── migrations/
├── routes/               # API routes
│   ├── videoRoutes.js
│   ├── shortsRoutes.js
│   ├── userRoutes.js
│   ├── commentRoutes.js
│   ├── likeRoutes.js
│   ├── subscribeRoutes.js
│   ├── watchHistoryRoutes.js
│   ├── viewRoutes.js
│   └── videoRoomRoutes.js
├── sockets/              # Socket.IO handlers
│   └── videoRoomSocket.js
├── utils/                # Utility functions
│   └── cacheUtils.js          # Redis cache helpers
├── uploads/              # Temporary upload directory
├── index.js              # Application entry point
├── package.json
├── docker-compose.yml
├── dockerfile
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18.x or higher
- PostgreSQL 15
- Redis
- FFmpeg
- AWS S3 account
- Google Gemini API key (for AI features)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/SumitGohil17/synx-backend.git
cd synx-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/synx_backend

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# AWS S3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Google Gemini AI
GEMINI_API_KEY=your-gemini-api-key
```

4. **Run database migrations**
```bash
npx prisma generate
npx prisma migrate deploy
```

5. **Start the server**
```bash
# Development
npm run dev

# Production
npm start
```

The server will start at `http://localhost:5000`

### 🐳 Docker Deployment

1. **Build and run with Docker Compose**
```bash
docker-compose up -d
```

This will start:
- PostgreSQL database on port 5432
- Backend API on port 5000

2. **Check service health**
```bash
curl http://localhost:5000/health
```

## 📡 API Endpoints

### Videos
- `POST /api/videos/upload` - Upload a video
- `GET /api/videos/allvideo` - Get all videos
- `GET /api/videos/:id` - Get video by ID
- `PUT /api/videos/:id` - Update video
- `DELETE /api/videos/:id` - Delete video
- `POST /api/videos/:id/reliable-view` - Count video view
- `POST /api/videos/analyze` - Analyze video with AI

### Shorts
- `POST /api/shorts/createshort` - Create short video
- `GET /api/shorts/allshorts` - Get all shorts
- `GET /api/shorts/:id` - Get short by ID

### Users
- `POST /api/users/sync` - Sync user from Supabase

### Comments
- `POST /api/comments/add` - Add comment
- `GET /api/comments/:videoId` - Get video comments
- `POST /api/comments/reply` - Reply to comment
- `GET /api/comments/replies/:commentId` - Get comment replies

### Likes
- `POST /api/likes/like` - Like a video
- `POST /api/likes/unlike` - Unlike a video

### Subscriptions
- `POST /api/subscribes/subscribe` - Subscribe to channel
- `POST /api/subscribes/unsubscribe` - Unsubscribe from channel
- `GET /api/subscribes/count/:userId` - Get subscriber count
- `GET /api/subscribes/check` - Check subscription status

### Watch History
- `POST /api/watch-history` - Add to watch history
- `GET /api/watch-history/user/:userId` - Get user watch history
- `GET /api/watch-history/user/:userId/continue-watching` - Get continue watching
- `GET /api/watch-history/user/:userId/statistics` - Get watch statistics
- `POST /api/watch-history/user/:userId/remove` - Remove from history

### Video Rooms (Real-time Watch Party)
- `POST /api/rooms/create` - Create a watch room
- `POST /api/rooms/join` - Join a room
- `GET /api/rooms/:roomCode` - Get room details
- `POST /api/rooms/close` - Close a room
- `GET /api/rooms/:roomId/messages` - Get room messages

### Views
- `POST /api/views/:id` - Count view
- `GET /api/views/:id/stats` - Get view statistics
- `POST /api/views/sync` - Sync view counts

### Health Check
- `GET /health` - Server health status

## 🔌 WebSocket Events (Socket.IO)

### Video Rooms Namespace: `/video-rooms`

**Client → Server Events:**
- `join-room` - Join a video room
- `send-message` - Send chat message
- `share-timestamp` - Share video timestamp
- `video-control` - Control video playback (play, pause, seek)
- `disconnect` - Leave room

**Server → Client Events:**
- `user-joined` - New user joined
- `user-left` - User left room
- `new-message` - New chat message
- `timestamp-shared` - Timestamp shared
- `video-control-broadcast` - Video control update
- `participants-update` - Participants list updated

### Main Namespace (View Tracking)
- `joinVideo` - Join video view tracking
- `viewVideo` - Track video view with deduplication

## 🗄️ Database Schema

### Key Models (Prisma)

**User**
- Authentication and profile information
- Subscriber tracking
- Relationships with videos, comments, likes

**Video**
- Video metadata (title, description, category, tags)
- HLS streaming URLs
- View count, likes, duration
- AI-generated content analysis

**shortsVideo**
- Short-form video content
- Similar structure to regular videos

**Comment**
- Nested comment system
- Parent-child relationships for replies

**Like**
- Video likes tracking
- Composite unique constraint (userId + videoId)

**subscribers**
- User subscription relationships

**VideoRoom**
- Watch party rooms
- Real-time synchronization

**WatchHistory**
- User watch tracking
- Progress tracking

**VideoView**
- Deduplicated view counting
- Fingerprint-based tracking

## ⚡ Performance Optimization

### Caching Strategy
- **Video Lists**: 15 minutes TTL
- **Comments**: 5 minutes TTL
- **User Data**: 15 minutes TTL
- **View Counts**: 1 minute TTL (frequent updates)
- **Trending Content**: 5 minutes TTL

### View Counting System
- **Deduplication**: IP + User Agent + User ID fingerprinting
- **Cooldown**: 1 hour between duplicate views
- **Batch Processing**: Views aggregated every 30 seconds
- **Redis-based**: High-performance view tracking

### Video Processing
- **Multi-quality HLS**: 360p, 480p, 720p, 1080p
- **Adaptive Bitrate Streaming**: Automatic quality switching
- **Cloud Storage**: S3 for scalable storage
- **Frame Extraction**: For thumbnails and AI analysis

## 🤖 AI Features

### Video Analysis (Google Gemini)
- Automatic content categorization
- Video topic detection
- Highlight timestamps
- Content summarization
- Tag suggestions

## 🔒 Security

- **Helmet.js**: HTTP header security
- **CORS**: Configured cross-origin requests
- **Input Validation**: Express-validator middleware
- **File Upload Limits**: 500MB max file size
- **SQL Injection Protection**: Prisma ORM parameterized queries
- **Environment Variables**: Sensitive data protection


## 🛠️ Development

### Scripts
```bash
npm run dev       # Start development server with nodemon
npm start         # Start production server
npm run build     # Generate Prisma Client
npm test          # Run tests (to be implemented)
```

### Database Migrations
```bash
# Create migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

## 🚢 Deployment

### Vercel Deployment
The project includes `vercel.json` for serverless deployment.

### Docker Deployment
```bash
# Build image
docker build -t synx-backend .

# Run container
docker run -p 5000:5000 --env-file .env synx-backend

# Or use docker-compose
docker-compose up -d
```

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 5000) |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_HOST` | Redis host | Yes |
| `REDIS_PORT` | Redis port | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `AWS_ACCESS_KEY_ID` | AWS access key | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Yes |
| `AWS_REGION` | AWS region | Yes |
| `S3_BUCKET_NAME` | S3 bucket name | Yes |
| `GEMINI_API_KEY` | Google Gemini API key | Yes |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 👤 Author

**Sumit Gohil**
- GitHub: [@SumitGohil17](https://github.com/SumitGohil17)

## 🐛 Issues

Report bugs or request features at: https://github.com/SumitGohil17/synx-backend/issues

## 🙏 Acknowledgments

- Express.js for the robust web framework
- Prisma for the excellent ORM
- Socket.IO for real-time capabilities
- FFmpeg for video processing
- Google Gemini AI for intelligent video analysis
