import prisma from '../connection/prismaConnection.js';
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export const createShort = async (req, res) => {
    const videoUrl = req.file.path;
    const { title, description, authorName, authorId, tags, category } = req.body;

    try {

        if(!videoUrl) {
            return res.status(400).json({ success: false, message: 'Video file is required' });
        }
        if (!title || !authorId) {
            return res.status(400).json({ success: false, message: 'title, videoUrl, and userId are required' });
        }
        const user = await prisma.user.findUnique({ where: { supabaseId: authorId } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }

        let parsedTags = [];
        if (tags) {
            try {
                parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
                if (!Array.isArray(parsedTags)) parsedTags = [parsedTags];
            } catch {
                parsedTags = tags.split(',').map(t => t.trim());
            }
        }
        const short = await prisma.shortsVideo.create({
            data: { title: title, description: description, url: videoUrl, tags: parsedTags, category: category, author: authorName, authorId: user.id },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });
        res.status(201).json({ success: true, short });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating short', error: error.message });
    }
};

export const getShorts = async (req, res) => {
    try {
        const shorts = await prisma.shortsVideo.findMany({
            include: { authorUser: { select: { id: true, username: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, shorts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching shorts', error: error.message });
    }
};
export const getShortById = async (req, res) => {
    try {
        const { id } = req.params;
        const short = await prisma.shortsVideo.findUnique({
            where: { id },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });
        if (!short) {
            return res.status(404).json({ success: false, message: 'Short not found' });
        }
        res.status(200).json({ success: true, short });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching short', error: error.message });
    }
};