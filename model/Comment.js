import mongoose from 'mongoose';
const { Schema } = mongoose;

const commentSchema = new Schema({
    video: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now }
});

const Comment = mongoose.model('Comment', commentSchema);
export default Comment;
