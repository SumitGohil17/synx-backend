import express from 'express';
import multer from 'multer';
const router = express.Router();
import { createShort, getShorts, getShortById} from "../controller/shortsController.js";

const upload = multer({ dest: "uploads/" });

router.post('/createshort', upload.single('video'), createShort);
router.get('/allshorts', getShorts);
router.get('/:id', getShortById);

export default router;