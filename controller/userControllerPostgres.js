import prisma from '../connection/prismaConnection.js';
import bcryptjs from 'bcryptjs';

export const syncUser = async (req, res) => {
    try {
        const { supabaseId, email, username } = req.body;
        let user = await prisma.user.findUnique({ where: { email } });
        
        if (!user) {
            const hashedPassword = await bcryptjs.hash('oauth', 10);
            user = await prisma.user.create({
                data: { supabaseId, email, username, password: hashedPassword }
            });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error syncing user', error: error.message });
    }
};

export const subscribe = async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        
        if (userId === targetUserId) {
            return res.status(400).json({ success: false, message: 'Cannot subscribe to yourself.' });
        }
        
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
        
        if (!user || !targetUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        await prisma.user.update({
            where: { id: userId },
            data: {
                subscriptions: { connect: { id: targetUserId } }
            }
        });
        
        res.status(200).json({ success: true, message: 'Subscribed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error subscribing.', error: error.message });
    }
};

export const unsubscribe = async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
        
        if (!user || !targetUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        
        await prisma.user.update({
            where: { id: userId },
            data: {
                subscriptions: { disconnect: { id: targetUserId } }
            }
        });
        
        res.status(200).json({ success: true, message: 'Unsubscribed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error unsubscribing.', error: error.message });
    }
};
