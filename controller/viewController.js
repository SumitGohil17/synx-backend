import prisma from '../connection/prismaConnection.js';
import redis from '../connection/redisConnection.js';
import crypto from 'crypto';

// ============================================
// REDIS-BASED VIEW COUNTING SYSTEM
// ============================================

const CONFIG = {
    MINIMUM_WATCH_TIME: 1,
    VIEW_COOLDOWN_MS: 60 * 60 * 1000, // 1 hour
    BATCH_UPDATE_INTERVAL: 30 * 1000, // 30 seconds
    VIEW_CACHE_TTL: 3600, // 1 hour in Redis
};

// Generate fingerprint for view deduplication
function generateFingerprint(req, userId = null) {
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    const data = `${ip}:${ua}:${userId || 'anonymous'}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

// Check if view was recently counted (Redis-based)
async function isRecentlyViewed(videoId, fingerprint) {
    try {
        const key = `view:${videoId}:${fingerprint}`;
        const exists = await redis.exists(key);
        return exists === 1;
    } catch (error) {
        console.error('Redis isRecentlyViewed error:', error.message);
        return false;
    }
}

// Mark view as counted in Redis
async function markViewCounted(videoId, fingerprint) {
    try {
        const key = `view:${videoId}:${fingerprint}`;
        await redis.setex(key, CONFIG.VIEW_CACHE_TTL, '1');
    } catch (error) {
        console.error('Redis markViewCounted error:', error.message);
    }
}

// Queue view update for batch processing
async function queueViewUpdate(videoId) {
    try {
        await redis.hincrby('pending_views', videoId, 1);
    } catch (error) {
        console.error('Queue view error:', error.message);
    }
}

// Process pending view updates (batch)
async function processPendingViewUpdates() {
    try {
        const pending = await redis.hgetall('pending_views');
        if (Object.keys(pending).length === 0) return;

        await redis.del('pending_views');

        const updates = Object.entries(pending).map(([videoId, count]) =>
            prisma.video.update({
                where: { id: videoId },
                data: { views: { increment: parseInt(count) } }
            }).catch(err => console.error(`View update failed for ${videoId}:`, err.message))
        );

        await Promise.all(updates);
        console.log(`Processed ${Object.keys(pending).length} view updates`);
    } catch (error) {
        console.error('Batch view update error:', error.message);
    }
}

// Start batch processing interval
setInterval(processPendingViewUpdates, CONFIG.BATCH_UPDATE_INTERVAL);

// Main view counting function
export const countView = async (req, res) => {
    try {
        const { id: videoId } = req.params;
        const { watchTime = 0, userId } = req.body;

        // Validate video exists
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, views: true }
        });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        // Check minimum watch time
        if (watchTime < CONFIG.MINIMUM_WATCH_TIME) {
            return res.status(200).json({
                success: true,
                counted: false,
                views: video.views,
                message: `Watch at least ${CONFIG.MINIMUM_WATCH_TIME} seconds`
            });
        }

        const fingerprint = generateFingerprint(req, userId);

        // Check Redis for recent view
        if (await isRecentlyViewed(videoId, fingerprint)) {
            return res.status(200).json({
                success: true,
                counted: false,
                views: video.views,
                message: 'View already counted recently'
            });
        }

        // Mark view and queue update
        await markViewCounted(videoId, fingerprint);
        await queueViewUpdate(videoId);

        return res.status(200).json({
            success: true,
            counted: true,
            views: video.views + 1,
            message: 'View counted'
        });

    } catch (error) {
        console.error('View count error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get view statistics
export const getViewStats = async (req, res) => {
    try {
        const { id: videoId } = req.params;

        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { views: true, createdAt: true }
        });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        // Get pending views from Redis
        const pendingViews = await redis.hget('pending_views', videoId) || 0;

        res.status(200).json({
            success: true,
            views: video.views + parseInt(pendingViews),
            pendingViews: parseInt(pendingViews),
            createdAt: video.createdAt
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Socket.io version for real-time
export const countViewSocket = async (videoId, { userId, watchTime, ip, userAgent }) => {
    try {
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, views: true }
        });

        if (!video) {
            return { success: false, message: 'Video not found' };
        }

        if (watchTime < CONFIG.MINIMUM_WATCH_TIME) {
            return { success: true, counted: false, views: video.views };
        }

        const data = `${ip}:${userAgent}:${userId || 'anonymous'}`;
        const fingerprint = crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);

        if (await isRecentlyViewed(videoId, fingerprint)) {
            return { success: true, counted: false, views: video.views };
        }

        await markViewCounted(videoId, fingerprint);
        await queueViewUpdate(videoId);

        return { success: true, counted: true, views: video.views + 1 };
    } catch (error) {
        console.error('Socket view error:', error);
        return { success: false, message: error.message };
    }
};

// Force sync pending views
export const syncViewCounts = async (req, res) => {
    try {
        await processPendingViewUpdates();
        res.status(200).json({ success: true, message: 'Views synced' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getViewConfig = (req, res) => {
    res.status(200).json({
        success: true,
        config: {
            minimumWatchTime: CONFIG.MINIMUM_WATCH_TIME,
            cooldownMinutes: CONFIG.VIEW_COOLDOWN_MS / 1000 / 60
        }
    });
};