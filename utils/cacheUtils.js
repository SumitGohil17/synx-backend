import redis from '../connection/redisConnection.js';

export const CACHE_TTL = {
    VIDEO: 600,              
    VIDEO_LIST: 300,         // 5 minutes
    VIDEO_BY_USER: 300,      // 5 minutes
    COMMENTS: 300,           // 5 minutes
    REPLIES: 300,            // 5 minutes
    LIKES: 180,              // 3 minutes
    LIKE_STATUS: 300,        // 5 minutes
    USER: 900,               // 15 minutes
    USER_PROFILE: 600,       // 10 minutes
    SUBSCRIBERS: 300,        // 5 minutes
    SUBSCRIPTION_STATUS: 300,// 5 minutes
    SHORTS: 300,             // 5 minutes
    WATCH_HISTORY: 180,      // 3 minutes
    VIEW_COUNT: 60,          // 1 minute (frequent updates)
    TRENDING: 300,           // 5 minutes
    SEARCH: 180,             // 3 minutes
};

export const CACHE_KEYS = {
    VIDEO: 'video:',
    VIDEO_LIST: 'videos:list:',
    VIDEO_BY_USER: 'videos:user:',
    VIDEO_TRENDING: 'videos:trending',

    COMMENTS: 'comments:video:',
    REPLIES: 'replies:comment:',
    
    LIKES_COUNT: 'likes:count:',
    LIKE_STATUS: 'like:status:',
    USER_LIKES: 'likes:user:',
    
    USER: 'user:',
    USER_BY_SUPABASE: 'user:supabase:',
    USER_PROFILE: 'profile:',
    
    SUBSCRIBER_COUNT: 'subscribers:count:',
    SUBSCRIPTION_STATUS: 'subscription:',
    SUBSCRIBERS_LIST: 'subscribers:list:',
    
    SHORTS_LIST: 'shorts:list',
    SHORT: 'short:',
    
    WATCH_HISTORY: 'watchhistory:',
    
    VIEW_COUNT: 'views:',
    VIEW_PENDING: 'views:pending:',
    
    SEARCH: 'search:',
};

export const getCache = async (key) => {
    try {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Cache GET error:', key, error.message);
        return null;
    }
};

export const setCache = async (key, data, ttl = 300) => {
    try {
        await redis.setex(key, ttl, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Cache SET error:', key, error.message);
        return false;
    }
};

export const deleteCache = async (key) => {
    try {
        await redis.del(key);
        return true;
    } catch (error) {
        console.error('Cache DELETE error:', key, error.message);
        return false;
    }
};

export const deleteCachePattern = async (pattern) => {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
            console.log(`Deleted ${keys.length} cache keys matching: ${pattern}`);
        }
        return true;
    } catch (error) {
        console.error('Cache PATTERN DELETE error:', pattern, error.message);
        return false;
    }
};

export const getCacheOrFetch = async (key, fetchFn, ttl = 300) => {
    try {
        const cached = await getCache(key);
        if (cached !== null) {
            return { data: cached, fromCache: true };
        }
        
        const data = await fetchFn();
        if (data !== null && data !== undefined) {
            await setCache(key, data, ttl);
        }
        return { data, fromCache: false };
    } catch (error) {
        console.error('getCacheOrFetch error:', error.message);
        const data = await fetchFn();
        return { data, fromCache: false };
    }
};

export const incrementCounter = async (key, ttl = 3600) => {
    try {
        const result = await redis.incr(key);
        if (result === 1) {
            await redis.expire(key, ttl);
        }
        return result;
    } catch (error) {
        console.error('Increment error:', error.message);
        return null;
    }
};

export const getCounter = async (key) => {
    try {
        const value = await redis.get(key);
        return value ? parseInt(value) : 0;
    } catch (error) {
        console.error('Get counter error:', error.message);
        return 0;
    }
};

export const invalidateVideoCache = async (videoId) => {
    await deleteCache(`${CACHE_KEYS.VIDEO}${videoId}`);
    await deleteCachePattern(`${CACHE_KEYS.VIDEO_LIST}*`);
    await deleteCache(CACHE_KEYS.VIDEO_TRENDING);
};

export const invalidateUserVideos = async (userId) => {
    await deleteCachePattern(`${CACHE_KEYS.VIDEO_BY_USER}${userId}*`);
    await deleteCachePattern(`${CACHE_KEYS.VIDEO_LIST}*`);
};

export const invalidateCommentCache = async (videoId) => {
    await deleteCachePattern(`${CACHE_KEYS.COMMENTS}${videoId}*`);
};

export const invalidateReplyCache = async (commentId) => {
    await deleteCache(`${CACHE_KEYS.REPLIES}${commentId}`);
};

export const invalidateLikeCache = async (videoId, userId = null) => {
    await deleteCache(`${CACHE_KEYS.LIKES_COUNT}${videoId}`);
    if (userId) {
        await deleteCache(`${CACHE_KEYS.LIKE_STATUS}${userId}:${videoId}`);
        await deleteCachePattern(`${CACHE_KEYS.USER_LIKES}${userId}*`);
    }
    await invalidateVideoCache(videoId);
};

export const invalidateUserCache = async (userId, supabaseId = null) => {
    await deleteCache(`${CACHE_KEYS.USER}${userId}`);
    if (supabaseId) {
        await deleteCache(`${CACHE_KEYS.USER_BY_SUPABASE}${supabaseId}`);
    }
    await deleteCachePattern(`${CACHE_KEYS.USER_PROFILE}${userId}*`);
};

export const invalidateSubscriberCache = async (userId, subscribedToId) => {
    await deleteCache(`${CACHE_KEYS.SUBSCRIBER_COUNT}${subscribedToId}`);
    await deleteCache(`${CACHE_KEYS.SUBSCRIPTION_STATUS}${userId}:${subscribedToId}`);
    await deleteCachePattern(`${CACHE_KEYS.SUBSCRIBERS_LIST}${subscribedToId}*`);
};

export const invalidateShortsCache = async (shortId = null) => {
    await deleteCache(CACHE_KEYS.SHORTS_LIST);
    if (shortId) {
        await deleteCache(`${CACHE_KEYS.SHORT}${shortId}`);
    }
};

export const invalidateWatchHistoryCache = async (userId) => {
    await deleteCachePattern(`${CACHE_KEYS.WATCH_HISTORY}${userId}*`);
};

export const queueViewUpdate = async (videoId) => {
    try {
        await redis.hincrby('pending_views', videoId, 1);
    } catch (error) {
        console.error('Queue view update error:', error.message);
    }
};

export const getPendingViews = async () => {
    try {
        const pending = await redis.hgetall('pending_views');
        await redis.del('pending_views');
        return pending;
    } catch (error) {
        console.error('Get pending views error:', error.message);
        return {};
    }
};

export const checkRedisHealth = async () => {
    try {
        await redis.ping();
        return { status: 'healthy', connected: true };
    } catch (error) {
        return { status: 'unhealthy', connected: false, error: error.message };
    }
};