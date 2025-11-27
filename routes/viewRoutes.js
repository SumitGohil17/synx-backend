import express from 'express';
import {
    countView,
    getViewStats,
    checkViewStatus,
    syncViewCounts,
    getViewConfig
} from '../controller/viewController.js';

const router = express.Router();


router.post('/:id', countView);
router.get('/:id/stats', getViewStats);

router.get('/:id/status', checkViewStatus);

router.get('/config', getViewConfig);

router.post('/sync', syncViewCounts);

export default router;
