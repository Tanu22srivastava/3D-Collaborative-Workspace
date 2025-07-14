const mongoose= require('mongoose')

const stickyNotesSchema = new mongoose.Schema({
    id: String,
    text: String,
    position:{
        x: Number,
        y: Number,
        z: Number
    }
});

const workSpaceSchema= new mongoose.Schema({
    name: String,
    notes: [stickyNotesSchema],
    users:[{
        id: String,
        position:{
            x:Number,
            y:Number,
            z:Number
        },
        color: Number
    }],

    createdAt: {type: Date, default: Date.now}
});

module.exports= mongoose.model('workspace',workSpaceSchema);