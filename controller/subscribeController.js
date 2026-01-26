import prisma from '../connection/prismaConnection.js';
import { 
    getCache, setCache, getCacheOrFetch,
    invalidateSubscriberCache, invalidateUserCache,
    CACHE_KEYS, CACHE_TTL 
} from '../utils/cacheUtils.js';

const findUserWithCache = async (userId) => {
    // Try by ID first
    let cacheKey = `${CACHE_KEYS.USER}${userId}`;
    let user = await getCache(cacheKey);
    
    if (!user) {
        user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            // Try by supabaseId
            cacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${userId}`;
            user = await getCache(cacheKey);
            if (!user) {
                user = await prisma.user.findUnique({ where: { supabaseId: userId } });
            }
        }
        if (user) {
            await setCache(`${CACHE_KEYS.USER}${user.id}`, user, CACHE_TTL.USER);
            await setCache(`${CACHE_KEYS.USER_BY_SUPABASE}${user.supabaseId}`, user, CACHE_TTL.USER);
        }
    }
    return user;
};

export const subscribe = async (req, res) => {
    try {
        const { subscriberId, subscribedToId } = req.body;

        if (!subscriberId || !subscribedToId) {
            return res.status(400).json({ success: false, message: 'subscriberId and subscribedToId required' });
        }

        const subscriber = await findUserWithCache(subscriberId);
        if (!subscriber) {
            return res.status(404).json({ success: false, message: 'Subscriber user not found' });
        }

        const subscribedTo = await findUserWithCache(subscribedToId);
        if (!subscribedTo) {
            return res.status(404).json({ success: false, message: 'Channel user not found' });
        }

        if (subscriber.id === subscribedTo.id) {
            return res.status(400).json({ success: false, message: 'Cannot subscribe to yourself' });
        }

        const existing = await prisma.subscribers.findUnique({
            where: {
                subscriberId_subscribedToId: {
                    subscriberId: subscriber.id,
                    subscribedToId: subscribedTo.id
                }
            }
        });

        if (existing) {
            return res.status(400).json({ success: false, message: 'Already subscribed' });
        }

        await prisma.user.update({
            where: { id: subscribedTo.id },
            data: {
                subscriberIds: { push: subscriber.id },
                subscriberCount: { increment: 1 }
            }
        });

        const subscription = await prisma.subscribers.create({
            data: {
                subscriberId: subscriber.id,
                subscribedToId: subscribedTo.id
            }
        });

        // Invalidate caches
        await invalidateSubscriberCache(subscriber.id, subscribedTo.id);
        await invalidateUserCache(subscribedTo.id, subscribedTo.supabaseId);

        res.status(201).json({ success: true, subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const unsubscribe = async (req, res) => {
    try {
        const { subscriberId, subscribedToId } = req.body;

        if (!subscriberId || !subscribedToId) {
            return res.status(400).json({ success: false, message: 'subscriberId and subscribedToId required' });
        }

        const subscriber = await findUserWithCache(subscriberId);
        if (!subscriber) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const subscribedTo = await findUserWithCache(subscribedToId);
        if (!subscribedTo) {
            return res.status(404).json({ success: false, message: 'Channel not found' });
        }

        await prisma.subscribers.delete({
            where: {
                subscriberId_subscribedToId: {
                    subscriberId: subscriber.id,
                    subscribedToId: subscribedTo.id
                }
            }
        });

        // Invalidate caches
        await invalidateSubscriberCache(subscriber.id, subscribedTo.id);
        await invalidateUserCache(subscribedTo.id, subscribedTo.supabaseId);

        res.status(200).json({ success: true, message: 'Unsubscribed' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSubscriberCount = async (req, res) => {
    try {
        const { userId } = req.params;
        const cacheKey = `${CACHE_KEYS.SUBSCRIBER_COUNT}${userId}`;

        const { data: count, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                const user = await findUserWithCache(userId);
                if (!user) return 0;
                return await prisma.subscribers.count({
                    where: { subscribedToId: user.id }
                });
            },
            CACHE_TTL.SUBSCRIBERS
        );

        res.status(200).json({ success: true, count, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const checkSubscribed = async (req, res) => {
    try {
        const { subscriberId, subscribedToId } = req.query;

        if (!subscriberId || !subscribedToId) {
            return res.status(200).json({ success: true, subscribed: false });
        }

        const cacheKey = `${CACHE_KEYS.SUBSCRIPTION_STATUS}${subscriberId}:${subscribedToId}`;

        const { data, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                const subscriber = await findUserWithCache(subscriberId);
                const subscribedTo = await findUserWithCache(subscribedToId);

                if (!subscriber || !subscribedTo) {
                    return { subscribed: false };
                }

                const subscription = await prisma.subscribers.findUnique({
                    where: {
                        subscriberId_subscribedToId: {
                            subscriberId: subscriber.id,
                            subscribedToId: subscribedTo.id
                        }
                    }
                });
                return { subscribed: !!subscription };
            },
            CACHE_TTL.SUBSCRIPTION_STATUS
        );

        res.status(200).json({ success: true, ...data, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};