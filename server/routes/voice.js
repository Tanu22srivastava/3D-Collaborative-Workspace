const express = require('express');
const router= express.Router();


router.post('/notes', (req, res) => {
    console.log("Body received:", req.body);
    const {text,position}= req.body;
    if(!text || !position){
        return res.status(400).json({ success: false, error: "Missing data" });
    }

    const newNote={
        id: crypto.randomUUID(),
        text,
        position
    };

    req.io.emit('addSticky', newNote);

    return res.json({ success: true, note: newNote });
});

module.exports= router;