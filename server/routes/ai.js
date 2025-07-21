const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Note = require('../models/Note');
const Workspace = require('../models/Workspace');
const Session = require('../models/Session');
const verifyToken = require('../middleware/auth');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Summarize workspace session
router.post('/summarize-session', verifyToken, async (req, res) => {
  try {
    const { workspaceId, sessionId } = req.body;
    
    // Verify access
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    // Get session data
    const session = await Session.findOne({ sessionId })
      .populate('participants.userId', 'username email')
      .populate('workspaceId', 'name description');
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    // Get notes created during session
    const sessionNotes = await Note.find({
      workspaceId,
      createdAt: {
        $gte: session.startedAt,
        $lte: session.endedAt || new Date()
      }
    }).populate('createdBy', 'username');
    
    // Prepare context for AI
    const context = {
      workspace: {
        name: session.workspaceId.name,
        description: session.workspaceId.description
      },
      session: {
        duration: session.duration,
        participants: session.participants.map(p => ({
          username: p.userId.username,
          joinedAt: p.joinedAt,
          leftAt: p.leftAt
        }))
      },
      content: {
        notes: sessionNotes.map(note => ({
          text: note.text,
          createdBy: note.createdBy.username,
          createdAt: note.createdAt
        }))
      }
    };
    
    const prompt = `
Please provide a comprehensive summary of this collaborative workspace session:

Workspace: ${context.workspace.name}
Description: ${context.workspace.description}
Session Duration: ${context.session.duration} minutes
Participants: ${context.session.participants.map(p => p.username).join(', ')}

Content Created:
${context.content.notes.map(note => 
  `- "${note.text}" (by ${note.createdBy})`
).join('\n')}

Please provide:
1. A brief executive summary
2. Key discussion points and decisions
3. Action items identified
4. Participant contributions
5. Suggested next steps

Keep the summary professional and actionable.
`;
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const summary = result.response.text();
    
    res.json({
      success: true,
      data: {
        summary,
        sessionData: context,
        generatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('AI summarize error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate summary' });
  }
});

// Get content suggestions
router.post('/suggest-content', verifyToken, async (req, res) => {
  try {
    const { workspaceId, context = '', type = 'brainstorm' } = req.body;
    
    // Verify access
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    
    // Get existing notes for context
    const existingNotes = await Note.find({ workspaceId })
      .sort({ createdAt: -1 })
      .limit(20);
    
    const existingContent = existingNotes.map(note => note.text).join('\n');
    
    let prompt = '';
    
    switch (type) {
      case 'brainstorm':
        prompt = `
Based on the existing content in this workspace, suggest 5-7 new ideas or discussion points:

Workspace: ${workspace.name}
Description: ${workspace.description}
Context: ${context}

Existing content:
${existingContent}

Please provide creative, relevant suggestions that build upon the existing ideas.
Format as a simple numbered list.
`;
        break;
        
      case 'organize':
        prompt = `
Analyze the content in this workspace and suggest how to organize it better:

Workspace: ${workspace.name}
Current content:
${existingContent}

Please suggest:
1. How to group related ideas
2. What categories or themes emerge
3. What might be missing
4. Suggested workspace structure

Keep suggestions practical and actionable.
`;
        break;
        
      case 'next-steps':
        prompt = `
Based on the discussion in this workspace, suggest concrete next steps and action items:

Workspace: ${workspace.name}
Content:
${existingContent}

Please provide:
1. Immediate action items
2. Follow-up tasks
3. People or roles who should be involved
4. Timeline suggestions

Format as actionable bullets.
`;
        break;
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const suggestions = result.response.text();
    
    res.json({
      success: true,
      data: {
        suggestions,
        type,
        generatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('AI suggest error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate suggestions' });
  }
});

// Smart note creation from voice/text
router.post('/create-smart-note', verifyToken, async (req, res) => {
  try {
    const { workspaceId, input, position } = req.body;
    
    const prompt = `
Convert this input into a concise, well-formatted sticky note:

Input: "${input}"

Please:
1. Make it concise but clear
2. Use bullet points if multiple ideas
3. Maintain key information
4. Format for easy reading
5. Keep under 200 characters if possible

Return only the formatted note text, no explanations.
`;
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const formattedText = result.response.text().trim();
    
    // Create the note
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const note = new Note({
      id: noteId,
      text: formattedText,
      position: position || { x: 0, y: 0, z: 0 },
      workspaceId,
      createdBy: req.user.userId,
      lastModifiedBy: req.user.userId
    });
    
    await note.save();
    await note.populate('createdBy', 'username email');
    
    // Emit to workspace
    req.io.to(workspaceId).emit('noteCreated', {
      note: note.toObject(),
      createdBy: note.createdBy,
      isAIGenerated: true
    });
    
    res.json({
      success: true,
      data: {
        note,
        originalInput: input,
        formattedText
      }
    });
  } catch (error) {
    console.error('Smart note creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create smart note' });
  }
});

module.exports = router;
