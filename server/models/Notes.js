const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 1000
  },
  position: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number, default: 0 }
  },
  color: {
    type: String,
    default: '#ffff88'
  },
  size: {
    width: { type: Number, default: 200 },
    height: { type: Number, default: 150 }
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lockedAt: Date,
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Index for efficient queries
noteSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('Note', noteSchema);