const mongoose = require('mongoose');

const strokeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  points: [{
    x: Number,
    y: Number,
    z: Number
  }],
  color: {
    type: String,
    default: '#000000'
  },
  width: {
    type: Number,
    default: 2
  },
  tool: {
    type: String,
    enum: ['pen', 'marker', 'eraser'],
    default: 'pen'
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
  }
}, {
  timestamps: true
});

strokeSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('DrawingStroke', strokeSchema);