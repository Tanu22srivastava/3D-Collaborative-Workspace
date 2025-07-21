const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const Workspace = require('../models/Workspace');
const verifyToken = require('../middleware/auth');
const { noteValidation, validateRequest } = require('../middleware/validation');

// Get all notes for a workspace
router.get('/workspace/:workspaceId', verifyToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { page = 1, limit = 100, search } = req.query;
    
    // Verify user has access to workspace
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    // Check if user is participant
    const isParticipant = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId
    ) || workspace.createdBy.toString() === req.user.userId;
    
    if (!isParticipant && !workspace.settings.isPublic) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Build query
    let query = { workspaceId };
    if (search) {
      query.text = { $regex: search, $options: 'i' };
    }
    
    const notes = await Note.find(query)
      .populate('createdBy', 'username email')
      .populate('lastModifiedBy', 'username email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Note.countDocuments(query);
    
    res.json({
      success: true,
      data: notes,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new note
router.post('/', verifyToken, validateRequest(noteValidation.create), async (req, res) => {
  try {
    const { text, position, color, workspaceId } = req.body;
    
    // Verify workspace exists and user has access
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const note = new Note({
      id: noteId,
      text,
      position,
      color,
      workspaceId,
      createdBy: req.user.userId,
      lastModifiedBy: req.user.userId
    });
    
    await note.save();
    await note.populate('createdBy', 'username email');
    
    // Update workspace last activity
    await Workspace.findByIdAndUpdate(workspaceId, { 
      lastActivity: new Date() 
    });
    
    // Emit to workspace participants
    req.io.to(workspaceId).emit('noteCreated', {
      note: note.toObject(),
      createdBy: note.createdBy
    });
    
    res.status(201).json({
      success: true,
      data: note
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update note
router.put('/:noteId', verifyToken, validateRequest(noteValidation.update), async (req, res) => {
  try {
    const { noteId } = req.params;
    const updates = req.body;
    
    const note = await Note.findOne({ id: noteId })
      .populate('createdBy', 'username email');
    
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    
    // Check if note is locked by another user
    if (note.isLocked && note.lockedBy.toString() !== req.user.userId) {
      return res.status(423).json({ 
        success: false, 
        message: 'Note is locked by another user',
        lockedBy: note.lockedBy
      });
    }
    
    // Update note
    Object.assign(note, updates);
    note.lastModifiedBy = req.user.userId;
    note.version += 1;
    
    await note.save();
    await note.populate('lastModifiedBy', 'username email');
    
    // Emit update to workspace
    req.io.to(note.workspaceId.toString()).emit('noteUpdated', {
      note: note.toObject(),
      updatedBy: note.lastModifiedBy
    });
    
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Lock/Unlock note for editing
router.post('/:noteId/lock', verifyToken, async (req, res) => {
  try {
    const { noteId } = req.params;
    const { lock = true } = req.body;
    
    const note = await Note.findOne({ id: noteId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    
    if (lock) {
      if (note.isLocked && note.lockedBy.toString() !== req.user.userId) {
        return res.status(423).json({ 
          success: false, 
          message: 'Note already locked by another user' 
        });
      }
      
      note.isLocked = true;
      note.lockedBy = req.user.userId;
      note.lockedAt = new Date();
    } else {
      if (note.lockedBy.toString() !== req.user.userId) {
        return res.status(403).json({ 
          success: false, 
          message: 'Cannot unlock note locked by another user' 
        });
      }
      
      note.isLocked = false;
      note.lockedBy = null;
      note.lockedAt = null;
    }
    
    await note.save();
    
    // Emit lock status to workspace
    req.io.to(note.workspaceId.toString()).emit('noteLockChanged', {
      noteId: note.id,
      isLocked: note.isLocked,
      lockedBy: note.lockedBy
    });
    
    res.json({
      success: true,
      data: { isLocked: note.isLocked, lockedBy: note.lockedBy }
    });
  } catch (error) {
    console.error('Lock note error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete note
router.delete('/:noteId', verifyToken, async (req, res) => {
  try {
    const { noteId } = req.params;
    
    const note = await Note.findOne({ id: noteId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    
    // Check permissions (creator or workspace admin)
    const workspace = await Workspace.findById(note.workspaceId);
    const isCreator = note.createdBy.toString() === req.user.userId;
    const isWorkspaceOwner = workspace.createdBy.toString() === req.user.userId;
    const isAdmin = workspace.participants.some(p => 
      p.userId.toString() === req.user.userId && p.role === 'admin'
    );
    
    if (!isCreator && !isWorkspaceOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    await Note.deleteOne({ id: noteId });
    
    // Emit deletion to workspace
    req.io.to(note.workspaceId.toString()).emit('noteDeleted', {
      noteId: note.id,
      deletedBy: req.user.userId
    });
    
    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;