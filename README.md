# Synx Backend - Video Platform API

A comprehensive Node.js/Express backend for a video platform with advanced features including video upload, processing, real-time view counting, comments, likes, and user subscriptions.

## 🚀 Features

### Video Management
- ✅ Video upload with metadata (title, description, category, tags, author)
- ✅ Multiple video format support (MP4, AVI, MOV, WebM, MKV, FLV)
- ✅ Video compression and encoding with FFmpeg
- ✅ Adaptive streaming (HLS) support
- ✅ Cloud storage integration (Vercel Blob, AWS S3)
- ✅ Video CRUD operations

### Real-Time Features
- ✅ Socket.io integration for live view counting
- ✅ YouTube-style view validation (minimum watch time, cooldown, anti-spam)
- ✅ Real-time view count broadcasting

### Social Features
- ✅ User authentication and management
- ✅ Comments system (add, view comments per video)
- ✅ Likes/Unlike functionality
- ✅ Subscribe/Unsubscribe to users
- ✅ Supabase OAuth user sync

### Security & Performance
- ✅ Helmet.js security headers
- ✅ CORS enabled
- ✅ Request validation with express-validator
- ✅ Rate limiting and anti-spam measures
- ✅ MongoDB indexing for optimized queries

## 📋 Prerequisites

- Node.js (v18+)
- MongoDB (local or cloud)
- FFmpeg (for video processing)
- Docker (for containerized deployment)
- AWS Account (for S3 storage)
- Vercel Account (for Vercel Blob storage)

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/SumitGohil17/synx-backend.git
cd synx-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Install FFmpeg
**Windows:**
```bash
choco install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get install ffmpeg
```

### 4. Environment Configuration

Create a `.env` file in the root directory:

```env
# Server
PORT=5000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/synx_backend
# Or MongoDB Atlas:
# MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/synx_backend


# AWS S3 Configuration 
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Cloudinary 
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## ⚙️ AWS S3 Configuration

### Step 1: Create an S3 Bucket
1. Log in to [AWS Console](https://console.aws.amazon.com/)
2. Navigate to S3 service
3. Click "Create bucket"
4. Choose a unique bucket name (e.g., `synx-video-storage`)
5. Select your preferred region
6. Uncheck "Block all public access" if you want public video access
7. Click "Create bucket"

### Step 2: Configure Bucket Permissions
Add the following CORS configuration to your bucket:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### Step 3: Create IAM User
1. Navigate to IAM service
2. Click "Users" → "Add user"
3. Choose a username (e.g., `synx-backend-user`)
4. Select "Programmatic access"
5. Attach policy: `AmazonS3FullAccess` (or create custom policy)
6. Save the **Access Key ID** and **Secret Access Key**

### Step 4: Add AWS Credentials to .env
```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG...
AWS_REGION=us-east-1
S3_BUCKET_NAME=synx-video-storage
```

### Custom IAM Policy (Recommended)
For better security, create a custom policy with minimal permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::synx-video-storage/*",
        "arn:aws:s3:::synx-video-storage"
      ]
    }
  ]
}
```

## 🐳 Docker Setup

### Build Docker Image
```bash
docker build -t synx-backend .
```

### Run Container
```bash
docker run -p 5000:5000 --env-file .env synx-backend
```

### Docker Compose
```bash
docker-compose up -d
```

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

Server will run on `http://localhost:5000`

## 📡 API Endpoints

### Video APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/upload` | Upload a video with metadata |
| GET | `/api/videos/allvideo` | Get all videos |
| GET | `/api/videos/:id` | Get video by ID |
| PUT | `/api/videos/:id` | Update video metadata |
| DELETE | `/api/videos/:id` | Delete video |
| POST | `/api/videos/:id/views` | Increment views (legacy) |
| POST | `/api/videos/:id/reliable-view` | YouTube-style view counting |

### User APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users/sync` | Sync user from Supabase OAuth |
| POST | `/api/users/subscribe` | Subscribe to a user |
| POST | `/api/users/unsubscribe` | Unsubscribe from a user |

### Comment APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/comments/add` | Add comment to video |
| GET | `/api/comments/:videoId` | Get all comments for a video |

### Like APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/likes/like` | Like a video |
| POST | `/api/likes/unlike` | Unlike a video |

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health status |

## 📝 API Usage Examples

### Upload Video
```bash
POST /api/videos/upload
Content-Type: multipart/form-data

Form Data:
- video: <file>
- title: "My Awesome Video"
- description: "This is a great video"
- category: "education"
- author: "John Doe"
- tags: ["tutorial", "nodejs"]
```

## 🔌 Socket.io Events

### Client → Server
- `joinVideo(videoId)` - Join a video room
- `viewVideo(videoId)` - Notify server of video view

### Server → Client
- `viewsUpdate({ videoId, views })` - Broadcast updated view count
- `viewsError({ error })` - View counting error

### Frontend Socket.io Example
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

// Join video room
socket.emit('joinVideo', videoId);

// Listen for view updates
socket.on('viewsUpdate', ({ videoId, views }) => {
  console.log(`Video ${videoId} now has ${views} views`);
});

// After 30 seconds of watching, count the view
setTimeout(() => {
  socket.emit('viewVideo', videoId);
}, 30000);
```

## 🗂️ Project Structure

```
synx_backend/
├── connection/
│   └── dbConnnection.js      # MongoDB connection
├── controller/
│   ├── videoController.js     # Video CRUD & view logic
│   ├── userController.js      # User & subscription logic
│   ├── commentController.js   # Comment logic
│   └── likeController.js      # Like/unlike logic
├── middleware/
│   ├── upload.js              # Multer file upload config
│   └── validation.js          # Express-validator rules
├── model/
│   ├── Video.js               # Video schema
│   ├── User.js                # User schema
│   ├── Comment.js             # Comment schema
│   └── Like.js                # Like schema
├── routes/
│   ├── videoRoutes.js         # Video API routes
│   ├── userRoutes.js          # User API routes
│   ├── commentRoutes.js       # Comment API routes
│   └── likeRoutes.js          # Like API routes
├── uploads/                   # Temporary file storage
├── .env                       # Environment variables
├── .env.example               # Example env file
├── dockerfile                 # Docker configuration
├── index.js                   # Main app entry point
├── package.json               # Dependencies
└── README.md                  # This file
```

### Deploy to AWS EC2
1. Launch EC2 instance (Ubuntu 20.04)
2. Install Node.js and FFmpeg
3. Clone repository
4. Set up environment variables
5. Use PM2 for process management:
```bash
npm install -g pm2
pm2 start index.js --name synx-backend
pm2 save
pm2 startup
```

### Deploy with Docker
```bash
docker-compose up -d
```

## 📊 MongoDB Schema

### Video Schema
```javascript
{
  title: String,
  url: String,
  description: String,
  thumbnail: String,
  tags: [String],
  category: String,
  author: String,
  duration: Number,
  views: Number,
  likes: Number,
  fileSize: Number,
  mimeType: String,
  uploadedAt: Date
}
```

### User Schema
```javascript
{
  supabaseId: String,
  email: String,
  username: String,
  password: String,
  subscribers: [ObjectId],
  subscriptions: [ObjectId],
  createdAt: Date
}
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

ISC License

## 👨‍💻 Author

**Sumit Gohil**
- GitHub: [@SumitGohil17](https://github.com/SumitGohil17)

## 🙏 Acknowledgments

- Express.js team
- MongoDB team
- Socket.io team
- FFmpeg community

---
