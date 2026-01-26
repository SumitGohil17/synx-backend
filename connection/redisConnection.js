import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    tls: {
        rejectUnauthorized: false  // Required for Upstash
    },
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
        if (times > 3) {
            console.error('❌ Redis connection failed after 3 retries');
            return null;
        }
        return Math.min(times * 200, 2000);
    }
});

redis.on('connect', () => console.log('✅ Redis connecting...'));
redis.on('ready', () => console.log('✅ Redis connected and ready!'));
redis.on('error', (err) => console.error('❌ Redis error:', err.message));
redis.on('close', () => console.log('⚠️ Redis connection closed'));

export default redis;