const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    socketId: String,
    joinedAt: Date,
    leftAt: Date,
    position: {
      x: Number,
      y: Number,
      z: Number
    },
    isVoiceActive: Boolean,
    avatar: {
      color: String,
      model: String
    }
  }],
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  duration: Number, // in minutes
  totalInteractions: Number,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

sessionSchema.index({ workspaceId: 1, startedAt: -1 });
sessionSchema.index({ sessionId: 1 });

module.exports = mongoose.model('Session', sessionSchema);