import mongoose from 'mongoose';
const { Schema } = mongoose;

const likeSchema = new Schema({
    video: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
});

const Like = mongoose.model('Like', likeSchema);
export default Like;
