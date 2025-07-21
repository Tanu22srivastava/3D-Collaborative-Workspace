const mongoose = require('mongoose');

const model3DSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  fileName: String,
  filePath: String,
  fileSize: Number,
  fileType: {
    type: String,
    enum: ['gltf', 'glb', 'obj', 'stl'],
    required: true
  },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 }
  },
  rotation: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 }
  },
  scale: {
    x: { type: Number, default: 1 },
    y: { type: Number, default: 1 },
    z: { type: Number, default: 1 }
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    vertices: Number,
    faces: Number,
    materials: [String]
  }
}, {
  timestamps: true
});

model3DSchema.index({ workspaceId: 1 });

module.exports = mongoose.model('Model3D', model3DSchema);