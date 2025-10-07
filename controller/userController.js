import User from '../model/User.js';

// Sync user from Supabase OAuth
export const syncUser = async (req, res) => {
    try {
        const { supabaseId, email, username } = req.body;
        let user = await User.findOne({ email });
        if (!user) {
            user = await User.create({ supabaseId, email, username, password: 'oauth' });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error syncing user', error: error.message });
    }
};

// Subscribe to a user
export const subscribe = async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        if (userId === targetUserId) return res.status(400).json({ success: false, message: 'Cannot subscribe to yourself.' });
        const user = await User.findById(userId);
        const targetUser = await User.findById(targetUserId);
        if (!user || !targetUser) return res.status(404).json({ success: false, message: 'User not found.' });
        if (user.subscriptions.includes(targetUserId)) return res.status(200).json({ success: false, message: 'Already subscribed.' });
        user.subscriptions.push(targetUserId);
        targetUser.subscribers.push(userId);
        await user.save();
        await targetUser.save();
        res.status(200).json({ success: true, message: 'Subscribed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error subscribing.', error: error.message });
    }
};

// Unsubscribe from a user
export const unsubscribe = async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        const user = await User.findById(userId);
        const targetUser = await User.findById(targetUserId);
        if (!user || !targetUser) return res.status(404).json({ success: false, message: 'User not found.' });
        user.subscriptions = user.subscriptions.filter(id => id.toString() !== targetUserId);
        targetUser.subscribers = targetUser.subscribers.filter(id => id.toString() !== userId);
        await user.save();
        await targetUser.save();
        res.status(200).json({ success: true, message: 'Unsubscribed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error unsubscribing.', error: error.message });
    }
};
