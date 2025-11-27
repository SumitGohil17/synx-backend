import prisma from '../connection/prismaConnection.js';
import crypto from 'crypto';

// ============================================
// SCALABLE VIEW COUNTING SYSTEM
// ============================================
// Features:
// - In-memory cache with TTL for fast duplicate detection
// - Database-backed view tracking for persistence
// - Fingerprint-based user identification
// - Minimum watch time validation (configurable)
// - Cooldown period per user per video (1 hour default)
// - Batch updates for scalability
// - Supports both authenticated and anonymous users
// ============================================

// Configuration
const CONFIG = {
    MINIMUM_WATCH_TIME: 1,           // Minimum seconds to count as a view
    VIEW_COOLDOWN_MS: 60 * 60 * 1000, // 1 hour cooldown between views from same user
    CACHE_CLEANUP_INTERVAL: 5 * 60 * 1000, // Clean cache every 5 minutes
    CACHE_MAX_SIZE: 100000,          // Maximum cache entries before cleanup
    BATCH_UPDATE_THRESHOLD: 10,      // Batch update views after this many pending
    BATCH_UPDATE_INTERVAL: 30 * 1000 // Batch update every 30 seconds
};

// In-memory cache for fast duplicate detection
// Structure: Map<fingerprint:videoId, { timestamp, counted }>
const viewCache = new Map();

// Pending view count updates (for batch processing)
const pendingViewUpdates = new Map(); // videoId -> count

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique fingerprint for view deduplication
 * Combines IP, User-Agent, and userId (if available)
 */
function generateFingerprint(req, userId = null) {
    const ip = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const userIdentifier = userId || 'anonymous';
    
    const data = `${ip}:${userAgent}:${userIdentifier}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Get client IP address (handles proxies)
 */
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.ip || 
           'unknown';
}

/**
 * Check if a view was recently counted (in-memory cache)
 */
function isRecentlyViewed(videoId, fingerprint) {
    const cacheKey = `${videoId}:${fingerprint}`;
    const cached = viewCache.get(cacheKey);
    
    if (cached) {
        const elapsed = Date.now() - cached.timestamp;
        if (elapsed < CONFIG.VIEW_COOLDOWN_MS) {
            return true;
        }
        // Expired, remove from cache
        viewCache.delete(cacheKey);
    }
    return false;
}

/**
 * Mark view as counted in cache
 */
function markViewCounted(videoId, fingerprint) {
    const cacheKey = `${videoId}:${fingerprint}`;
    viewCache.set(cacheKey, {
        timestamp: Date.now(),
        counted: true
    });
}

/**
 * Clean up expired cache entries
 */
function cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of viewCache.entries()) {
        if (now - value.timestamp > CONFIG.VIEW_COOLDOWN_MS) {
            viewCache.delete(key);
            cleaned++;
        }
    }
    
    // If cache is still too large, remove oldest entries
    if (viewCache.size > CONFIG.CACHE_MAX_SIZE) {
        const entries = Array.from(viewCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = entries.slice(0, viewCache.size - CONFIG.CACHE_MAX_SIZE);
        toRemove.forEach(([key]) => viewCache.delete(key));
        cleaned += toRemove.length;
    }
    
    if (cleaned > 0) {
        console.log(`[ViewCache] Cleaned ${cleaned} expired entries. Cache size: ${viewCache.size}`);
    }
}

/**
 * Queue a view update for batch processing
 */
function queueViewUpdate(videoId) {
    const current = pendingViewUpdates.get(videoId) || 0;
    pendingViewUpdates.set(videoId, current + 1);
    
    // If threshold reached, process immediately
    if (pendingViewUpdates.size >= CONFIG.BATCH_UPDATE_THRESHOLD) {
        processPendingViewUpdates();
    }
}

/**
 * Process all pending view updates in batch
 */
async function processPendingViewUpdates() {
    if (pendingViewUpdates.size === 0) return;
    
    const updates = new Map(pendingViewUpdates);
    pendingViewUpdates.clear();
    
    try {
        // Process all updates in parallel
        const promises = Array.from(updates.entries()).map(([videoId, count]) =>
            prisma.video.update({
                where: { id: videoId },
                data: { views: { increment: count } }
            }).catch(err => {
                console.error(`[ViewBatch] Failed to update views for ${videoId}:`, err.message);
                // Re-queue failed updates
                const current = pendingViewUpdates.get(videoId) || 0;
                pendingViewUpdates.set(videoId, current + count);
            })
        );
        
        await Promise.all(promises);
        console.log(`[ViewBatch] Updated views for ${updates.size} videos`);
    } catch (error) {
        console.error('[ViewBatch] Batch update failed:', error);
    }
}

// Start periodic cache cleanup
setInterval(cleanupCache, CONFIG.CACHE_CLEANUP_INTERVAL);

// Start periodic batch updates
setInterval(processPendingViewUpdates, CONFIG.BATCH_UPDATE_INTERVAL);

// ============================================
// MAIN VIEW COUNTING FUNCTION
// ============================================

/**
 * Count a video view with deduplication
 * 
 * Request body:
 * - watchTime: number (seconds watched)
 * - userId: string (optional, for authenticated users)
 * 
 * Response:
 * - success: boolean
 * - counted: boolean (whether this view was counted)
 * - views: number (current view count)
 * - message: string
 */
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
            return res.status(404).json({
                success: false,
                counted: false,
                message: 'Video not found'
            });
        }
        
        // Check minimum watch time
        if (watchTime < CONFIG.MINIMUM_WATCH_TIME) {
            return res.status(200).json({
                success: true,
                counted: false,
                views: video.views,
                message: `Watch at least ${CONFIG.MINIMUM_WATCH_TIME} seconds to count as a view`,
                minimumWatchTime: CONFIG.MINIMUM_WATCH_TIME
            });
        }
        
        // Generate fingerprint for this viewer
        let actualUserId = userId;
        if (userId) {
            // Try to find user by id or supabaseId
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: userId },
                        { supabaseId: userId }
                    ]
                },
                select: { id: true }
            });
            actualUserId = user?.id || null;
        }
        
        const fingerprint = generateFingerprint(req, actualUserId);
        
        // Check in-memory cache first (fastest)
        if (isRecentlyViewed(videoId, fingerprint)) {
            return res.status(200).json({
                success: true,
                counted: false,
                views: video.views,
                message: 'View already counted recently',
                cooldownRemaining: Math.ceil(CONFIG.VIEW_COOLDOWN_MS / 1000 / 60) + ' minutes'
            });
        }
        
        // Check database for existing view (for persistence across restarts)
        const existingView = await prisma.videoView.findUnique({
            where: {
                videoId_fingerprint: {
                    videoId,
                    fingerprint
                }
            },
            select: { viewedAt: true }
        });
        
        if (existingView) {
            const elapsed = Date.now() - existingView.viewedAt.getTime();
            if (elapsed < CONFIG.VIEW_COOLDOWN_MS) {
                // Update cache
                markViewCounted(videoId, fingerprint);
                
                return res.status(200).json({
                    success: true,
                    counted: false,
                    views: video.views,
                    message: 'View already counted recently',
                    cooldownRemaining: Math.ceil((CONFIG.VIEW_COOLDOWN_MS - elapsed) / 1000 / 60) + ' minutes'
                });
            }
            
            // Cooldown expired, update the existing record
            await prisma.videoView.update({
                where: {
                    videoId_fingerprint: {
                        videoId,
                        fingerprint
                    }
                },
                data: {
                    viewedAt: new Date(),
                    watchDuration: watchTime,
                    userId: actualUserId
                }
            });
        } else {
            // Create new view record
            await prisma.videoView.create({
                data: {
                    videoId,
                    fingerprint,
                    userId: actualUserId,
                    watchDuration: watchTime,
                    ipAddress: getClientIP(req).substring(0, 45), // Truncate for privacy
                    userAgent: (req.headers['user-agent'] || '').substring(0, 255)
                }
            });
        }
        
        // Mark in cache
        markViewCounted(videoId, fingerprint);
        
        // Increment view count (using batch for scalability)
        queueViewUpdate(videoId);
        
        // For immediate response, increment optimistically
        const newViews = video.views + 1;
        
        return res.status(200).json({
            success: true,
            counted: true,
            views: newViews,
            message: 'View counted successfully'
        });
        
    } catch (error) {
        console.error('[ViewCount] Error:', error);
        return res.status(500).json({
            success: false,
            counted: false,
            message: 'Error counting view',
            error: error.message
        });
    }
};

/**
 * Get view statistics for a video
 */
export const getViewStats = async (req, res) => {
    try {
        const { id: videoId } = req.params;
        
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { 
                id: true, 
                views: true,
                createdAt: true
            }
        });
        
        if (!video) {
            return res.status(404).json({
                success: false,
                message: 'Video not found'
            });
        }
        
        // Get view analytics
        const [totalViews, uniqueViewers, recentViews] = await Promise.all([
            prisma.videoView.count({
                where: { videoId }
            }),
            prisma.videoView.groupBy({
                by: ['fingerprint'],
                where: { videoId },
                _count: true
            }),
            prisma.videoView.count({
                where: {
                    videoId,
                    viewedAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                    }
                }
            })
        ]);
        
        // Calculate average watch time
        const avgWatchTime = await prisma.videoView.aggregate({
            where: { videoId },
            _avg: { watchDuration: true }
        });
        
        return res.status(200).json({
            success: true,
            stats: {
                totalViews: video.views,
                trackedViews: totalViews,
                uniqueViewers: uniqueViewers.length,
                viewsLast24Hours: recentViews,
                averageWatchTime: Math.round(avgWatchTime._avg?.watchDuration || 0),
                videoCreatedAt: video.createdAt
            }
        });
        
    } catch (error) {
        console.error('[ViewStats] Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching view stats',
            error: error.message
        });
    }
};

/**
 * Check if current user has viewed a video (for UI indicators)
 */
export const checkViewStatus = async (req, res) => {
    try {
        const { id: videoId } = req.params;
        const { userId } = req.query;
        
        let actualUserId = userId;
        if (userId) {
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: userId },
                        { supabaseId: userId }
                    ]
                },
                select: { id: true }
            });
            actualUserId = user?.id || null;
        }
        
        const fingerprint = generateFingerprint(req, actualUserId);
        
        // Check cache first
        if (isRecentlyViewed(videoId, fingerprint)) {
            return res.status(200).json({
                success: true,
                hasViewed: true,
                canViewAgain: false
            });
        }
        
        // Check database
        const existingView = await prisma.videoView.findUnique({
            where: {
                videoId_fingerprint: {
                    videoId,
                    fingerprint
                }
            },
            select: { viewedAt: true }
        });
        
        if (existingView) {
            const elapsed = Date.now() - existingView.viewedAt.getTime();
            const canViewAgain = elapsed >= CONFIG.VIEW_COOLDOWN_MS;
            
            return res.status(200).json({
                success: true,
                hasViewed: true,
                canViewAgain,
                lastViewedAt: existingView.viewedAt,
                cooldownRemaining: canViewAgain ? 0 : Math.ceil((CONFIG.VIEW_COOLDOWN_MS - elapsed) / 1000)
            });
        }
        
        return res.status(200).json({
            success: true,
            hasViewed: false,
            canViewAgain: true
        });
        
    } catch (error) {
        console.error('[CheckViewStatus] Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error checking view status',
            error: error.message
        });
    }
};

/**
 * Sync view counts (admin utility)
 * Recalculates view count from VideoView records
 */
export const syncViewCounts = async (req, res) => {
    try {
        // Get all videos with their tracked view counts
        const viewCounts = await prisma.videoView.groupBy({
            by: ['videoId'],
            _count: true
        });
        
        // Update each video's view count
        const updates = viewCounts.map(({ videoId, _count }) =>
            prisma.video.update({
                where: { id: videoId },
                data: { views: _count }
            })
        );
        
        await Promise.all(updates);
        
        return res.status(200).json({
            success: true,
            message: `Synced view counts for ${viewCounts.length} videos`
        });
        
    } catch (error) {
        console.error('[SyncViewCounts] Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error syncing view counts',
            error: error.message
        });
    }
};

// Export configuration for testing/debugging
export const getViewConfig = (req, res) => {
    res.status(200).json({
        success: true,
        config: {
            minimumWatchTime: CONFIG.MINIMUM_WATCH_TIME,
            viewCooldownMinutes: CONFIG.VIEW_COOLDOWN_MS / 1000 / 60,
            cacheSize: viewCache.size,
            pendingUpdates: pendingViewUpdates.size
        }
    });
};

// ============================================
// SOCKET.IO VERSION - For real-time view counting
// ============================================

/**
 * Generate fingerprint from raw data (for Socket.io)
 */
function generateFingerprintRaw(ip, userAgent, userId = null) {
    const userIdentifier = userId || 'anonymous';
    const data = `${ip}:${userAgent}:${userIdentifier}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Count a video view via Socket.io
 * This version doesn't use req/res objects
 * 
 * @param {string} videoId - The video ID
 * @param {Object} options - { userId, watchTime, ip, userAgent }
 * @returns {Object} - { success, counted, views, message }
 */
export const countViewSocket = async (videoId, options = {}) => {
    try {
        const { userId, watchTime = 5, ip = 'unknown', userAgent = 'unknown' } = options;
        
        // Validate video exists
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, views: true }
        });
        
        if (!video) {
            return {
                success: false,
                counted: false,
                message: 'Video not found'
            };
        }
        
        // Check minimum watch time
        if (watchTime < CONFIG.MINIMUM_WATCH_TIME) {
            return {
                success: true,
                counted: false,
                views: video.views,
                message: `Watch at least ${CONFIG.MINIMUM_WATCH_TIME} seconds to count as a view`
            };
        }
        
        // Resolve user ID
        let actualUserId = userId;
        if (userId) {
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: userId },
                        { supabaseId: userId }
                    ]
                },
                select: { id: true }
            });
            actualUserId = user?.id || null;
        }
        
        // Generate fingerprint
        const fingerprint = generateFingerprintRaw(ip, userAgent, actualUserId);
        
        // Check in-memory cache first (fastest)
        if (isRecentlyViewed(videoId, fingerprint)) {
            return {
                success: true,
                counted: false,
                views: video.views,
                message: 'View already counted recently'
            };
        }
        
        // Check database for existing view
        const existingView = await prisma.videoView.findUnique({
            where: {
                videoId_fingerprint: {
                    videoId,
                    fingerprint
                }
            },
            select: { viewedAt: true }
        });
        
        if (existingView) {
            const elapsed = Date.now() - existingView.viewedAt.getTime();
            if (elapsed < CONFIG.VIEW_COOLDOWN_MS) {
                markViewCounted(videoId, fingerprint);
                return {
                    success: true,
                    counted: false,
                    views: video.views,
                    message: 'View already counted recently'
                };
            }
            
            // Cooldown expired, update existing record
            await prisma.videoView.update({
                where: {
                    videoId_fingerprint: {
                        videoId,
                        fingerprint
                    }
                },
                data: {
                    viewedAt: new Date(),
                    watchDuration: watchTime,
                    userId: actualUserId
                }
            });
        } else {
            // Create new view record
            await prisma.videoView.create({
                data: {
                    videoId,
                    fingerprint,
                    userId: actualUserId,
                    watchDuration: watchTime,
                    ipAddress: ip.substring(0, 45),
                    userAgent: userAgent.substring(0, 255)
                }
            });
        }
        
        // Mark in cache and queue update
        markViewCounted(videoId, fingerprint);
        queueViewUpdate(videoId);
        
        return {
            success: true,
            counted: true,
            views: video.views + 1,
            message: 'View counted successfully'
        };
        
    } catch (error) {
        console.error('[ViewCountSocket] Error:', error);
        return {
            success: false,
            counted: false,
            message: 'Error counting view',
            error: error.message
        };
    }
};
