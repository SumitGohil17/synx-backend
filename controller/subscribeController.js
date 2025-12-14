import prisma from '../connection/prismaConnection.js';

export const subscribe = async (req, res) => {
    try {
        const { subscriberId, subscribedToId } = req.body;

        if (!subscriberId || !subscribedToId) {
            return res.status(400).json({ success: false, message: 'subscriberId and subscribedToId required' });
        }

        let subscriber = await prisma.user.findUnique({ where: { id: subscriberId } });
        if (!subscriber) {
            subscriber = await prisma.user.findUnique({ where: { supabaseId: subscriberId } });
        }
        if (!subscriber) {
            return res.status(404).json({ success: false, message: 'Subscriber user not found' });
        }

        let subscribedTo = await prisma.user.findUnique({ where: { id: subscribedToId } });
        if (!subscribedTo) {
            subscribedTo = await prisma.user.findUnique({ where: { supabaseId: subscribedToId } });
        }
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

        // Find subscriber user
        let subscriber = await prisma.user.findUnique({ where: { id: subscriberId } });
        if (!subscriber) {
            subscriber = await prisma.user.findUnique({ where: { supabaseId: subscriberId } });
        }
        if (!subscriber) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let subscribedTo = await prisma.user.findUnique({ where: { id: subscribedToId } });
        if (!subscribedTo) {
            subscribedTo = await prisma.user.findUnique({ where: { supabaseId: subscribedToId } });
        }
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

        res.status(200).json({ success: true, message: 'Unsubscribed' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSubscriberCount = async (req, res) => {
    try {
        const { userId } = req.params;

        // Find user
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const count = await prisma.subscribers.count({
            where: { subscribedToId: user.id }
        });

        res.status(200).json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const checkSubscribed = async (req, res) => {
    try {
        const { subscriberId, subscribedToId } = req.query;

        if (!subscriberId || !subscribedToId) {
            return res.status(400).json({ success: false, subscribed: false });
        }

        let subscriber = await prisma.user.findUnique({ where: { id: subscriberId } });
        if (!subscriber) {
            subscriber = await prisma.user.findUnique({ where: { supabaseId: subscriberId } });
        }

        let subscribedTo = await prisma.user.findUnique({ where: { id: subscribedToId } });
        if (!subscribedTo) {
            subscribedTo = await prisma.user.findUnique({ where: { supabaseId: subscribedToId } });
        }

        if (!subscriber || !subscribedTo) {
            return res.status(200).json({ success: true, subscribed: false });
        }

        const subscription = await prisma.subscribers.findUnique({
            where: {
                subscriberId_subscribedToId: {
                    subscriberId: subscriber.id,
                    subscribedToId: subscribedTo.id
                }
            }
        });

        res.status(200).json({ success: true, subscribed: !!subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};