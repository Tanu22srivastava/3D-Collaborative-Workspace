const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Model3D = require('../models/Model3D');
const Workspace = require('../models/Workspace');
const verifyToken = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../uploads/models');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

// File filter for 3D models
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.gltf', '.glb', '.obj'];
  const extension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(extension)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only GLTF, GLB, and OBJ files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload 3D model
router.post('/upload', verifyToken, upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    const { workspaceId, name } = req.body;
    
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is required' });
    }
    
    // Verify workspace exists and user has access
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    // Check if user is participant or creator
    const isParticipant = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId
    ) || workspace.createdBy.toString() === req.user.userId;
    
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Get file info
    const extension = path.extname(req.file.originalname).toLowerCase();
    const fileType = extension.substring(1); // Remove the dot
    
    // Generate unique model ID
    const modelId = `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create model record
    const model = new Model3D({
      id: modelId,
      name: name || req.file.originalname,
      fileName: req.file.originalname,
      filePath: `/api/models/file/${modelId}`, // API endpoint to serve the file
      fileSize: req.file.size,
      fileType: fileType,
      position: { x: 0, y: 1, z: 0 }, // Default position
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      workspaceId: workspaceId,
      uploadedBy: req.user.userId,
      metadata: {
        vertices: 0, // Will be calculated client-side if needed
        faces: 0,
        materials: []
      }
    });
    
    // Store the actual file path for serving
    model.actualFilePath = req.file.path;
    
    await model.save();
    
    // Update workspace last activity
    await Workspace.findByIdAndUpdate(workspaceId, { 
      lastActivity: new Date() 
    });
    
    console.log(`✅ Model uploaded: ${model.name} by ${req.user.userId}`);
    
    res.status(201).json({
      success: true,
      data: {
        id: model.id,
        name: model.name,
        fileName: model.fileName,
        filePath: model.filePath,
        fileType: model.fileType,
        fileSize: model.fileSize,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        uploadedBy: model.uploadedBy,
        createdAt: model.createdAt
      }
    });
  } catch (error) {
    console.error('Model upload error:', error);
    
    // Clean up uploaded file if database save failed
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        message: 'File too large. Maximum size is 50MB.' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Failed to upload model' });
  }
});

// Serve model files
router.get('/file/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    
    const model = await Model3D.findOne({ id: modelId });
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }
    
    // Get the actual file path from the uploads directory
    const uploadsPath = path.join(__dirname, '../uploads/models');
    const files = fs.readdirSync(uploadsPath);
    const modelFile = files.find(file => file.includes(modelId.split('_')[1]));
    
    if (!modelFile) {
      return res.status(404).json({ success: false, message: 'Model file not found' });
    }
    
    const filePath = path.join(uploadsPath, modelFile);
    
    // Set appropriate headers
    res.setHeader('Content-Type', getContentType(model.fileType));
    res.setHeader('Content-Disposition', `inline; filename="${model.fileName}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Error serving model file:', error);
    res.status(500).json({ success: false, message: 'Error serving file' });
  }
});

// Get all models for a workspace
router.get('/workspace/:workspaceId', verifyToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    
    // Verify workspace access
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    const isParticipant = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId
    ) || workspace.createdBy.toString() === req.user.userId;
    
    if (!isParticipant && !workspace.settings.isPublic) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    const models = await Model3D.find({ workspaceId })
      .populate('uploadedBy', 'username email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: models.map(model => ({
        id: model.id,
        name: model.name,
        fileName: model.fileName,
        filePath: model.filePath,
        fileType: model.fileType,
        fileSize: model.fileSize,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        uploadedBy: model.uploadedBy,
        createdAt: model.createdAt,
        metadata: model.metadata
      }))
    });
  } catch (error) {
    console.error('Get models error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update model transform (position, rotation, scale)
router.put('/:modelId/transform', verifyToken, async (req, res) => {
  try {
    const { modelId } = req.params;
    const { position, rotation, scale } = req.body;
    
    const model = await Model3D.findOne({ id: modelId });
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }
    
    // Verify workspace access
    const workspace = await Workspace.findById(model.workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    const isParticipant = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId
    ) || workspace.createdBy.toString() === req.user.userId;
    
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Update transform properties
    if (position) {
      model.position = { ...model.position, ...position };
    }
    if (rotation) {
      model.rotation = { ...model.rotation, ...rotation };
    }
    if (scale) {
      model.scale = { ...model.scale, ...scale };
    }
    
    await model.save();
    
    // Emit update to workspace participants
    if (req.io) {
      req.io.to(model.workspaceId.toString()).emit('modelMoved', {
        modelId: model.id,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        updatedBy: req.user.userId
      });
    }
    
    res.json({
      success: true,
      data: {
        id: model.id,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale
      }
    });
  } catch (error) {
    console.error('Update model transform error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete model
router.delete('/:modelId', verifyToken, async (req, res) => {
  try {
    const { modelId } = req.params;
    
    const model = await Model3D.findOne({ id: modelId });
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }
    
    // Check permissions (uploader, workspace owner, or admin)
    const workspace = await Workspace.findById(model.workspaceId);
    const isUploader = model.uploadedBy.toString() === req.user.userId;
    const isWorkspaceOwner = workspace.createdBy.toString() === req.user.userId;
    const isAdmin = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId && p.role === 'admin'
    );
    
    if (!isUploader && !isWorkspaceOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Delete the file from filesystem
    try {
      const uploadsPath = path.join(__dirname, '../uploads/models');
      const files = fs.readdirSync(uploadsPath);
      const modelFile = files.find(file => file.includes(modelId.split('_')[1]));
      
      if (modelFile) {
        const filePath = path.join(uploadsPath, modelFile);
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted model file: ${filePath}`);
      }
    } catch (fileError) {
      console.error('Error deleting model file:', fileError);
      // Continue with database deletion even if file deletion fails
    }
    
    // Delete from database
    await Model3D.deleteOne({ id: modelId });
    
    // Emit deletion to workspace participants
    if (req.io) {
      req.io.to(model.workspaceId.toString()).emit('modelDeleted', {
        modelId: model.id,
        deletedBy: req.user.userId
      });
    }
    
    res.json({
      success: true,
      message: 'Model deleted successfully'
    });
  } catch (error) {
    console.error('Delete model error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get model details
router.get('/:modelId', verifyToken, async (req, res) => {
  try {
    const { modelId } = req.params;
    
    const model = await Model3D.findOne({ id: modelId })
      .populate('uploadedBy', 'username email');
    
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }
    
    // Verify workspace access
    const workspace = await Workspace.findById(model.workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    const isParticipant = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId
    ) || workspace.createdBy.toString() === req.user.userId;
    
    if (!isParticipant && !workspace.settings.isPublic) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    res.json({
      success: true,
      data: {
        id: model.id,
        name: model.name,
        fileName: model.fileName,
        filePath: model.filePath,
        fileType: model.fileType,
        fileSize: model.fileSize,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        uploadedBy: model.uploadedBy,
        createdAt: model.createdAt,
        metadata: model.metadata
      }
    });
  } catch (error) {
    console.error('Get model error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper function to get content type based on file extension
function getContentType(fileType) {
  const contentTypes = {
    'gltf': 'model/gltf+json',
    'glb': 'model/gltf-binary',
    'obj': 'text/plain'
  };
  
  return contentTypes[fileType] || 'application/octet-stream';
}

module.exports = router;