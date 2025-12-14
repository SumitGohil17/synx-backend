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
