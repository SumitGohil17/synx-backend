import express from 'express';
import { subscribe, unsubscribe, syncUser } from '../controller/userControllerPostgres.js';

const router = express.Router();

router.post('/sync', syncUser);
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

export default router;
