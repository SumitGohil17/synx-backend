import express from 'express';
import {
    subscribe,
    unsubscribe,
    getSubscriberCount,
    checkSubscribed,
} from '../controller/subscribeController.js';

const router = express.Router();

router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);
router.get('/count/:userId', getSubscriberCount);
router.get('/check', checkSubscribed);

export default router;