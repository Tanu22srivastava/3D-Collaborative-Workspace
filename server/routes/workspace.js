const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const verifyToken = require('../middleware/auth');

router.post('/save', async (req, res) => {
    try {
        const { name, notes, users } = req.body;

        const newWorkspace = new Workspace({
            name,
            notes,
            users
        });

        await newWorkspace.save();
        res.json({ success: true, id: newWorkspace._id });
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({ success: false, error: 'Failed to save workspace.' });
    }
});



router.get('/all', async (req, res) => {
    try {
        const workspaces = await Workspace.find();
        res.json({ success: true, data: workspaces });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Server Error" });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const workspace = await Workspace.findById(req.params.id);
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found.' });
        }
        res.json({ workspace });
    } catch (err) {
        console.error('Load Error:', err);
        res.status(500).json({ error: 'Failed to load workspace.' });
    }
});

module.exports = router;
