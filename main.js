const socket = io('http://localhost:3000', { transports: ['websocket'] });

let editingNote = null;
const editBoxContainer = document.getElementById('editBoxContainer');
const editBox = document.getElementById('editBox');

const otherUsers = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enableDamping = true;
// controls.target.copy(avatar.position);

const gridHelper = new THREE.GridHelper(50, 50);
scene.add(gridHelper);
scene.background = new THREE.Color(0xf0f0f0);

const planegem = new THREE.PlaneGeometry(50, 50);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
const plane = new THREE.Mesh(planegem, planeMaterial);
plane.rotation.x = -Math.PI / 2;
scene.add(plane);

const avtarGeo = new THREE.SphereGeometry(0.2, 32, 32);
const avtarmaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
const avatar = new THREE.Mesh(avtarGeo, avtarmaterial);
scene.add(avatar);
avatar.position.y = 0.2;

let moveX = 0, moveZ = 0;

document.addEventListener('keydown', (e) => {
    if (e.key == 'ArrowUp') moveZ = -0.05;
    if (e.key == 'ArrowDown') moveZ = 0.05;
    if (e.key == "ArrowLeft") moveX = -0.05;
    if (e.key == 'ArrowRight') moveX = 0.05;

    if (e.key === 's' && e.ctrlKey) {
        e.preventDefault();
        saveWorkspace(); // Ctrl+S to save
    }
    if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        loadWorkspace('YOUR_WORKSPACE_ID'); // Replace with your saved _id
    }
});

document.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.key)) moveZ = 0;
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) moveX = 0;
});

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light);

const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

camera.position.set(3, 3, 5);

const stickyNotes = {};

function animate() {
    requestAnimationFrame(animate);
    avatar.position.x += moveX;
    avatar.position.z += moveZ;
    camera.position.x = avatar.position.x + 3;
    camera.position.z = avatar.position.z + 5;
    camera.lookAt(avatar.position);

    Object.values(stickyNotes).forEach(note => {
    note.mesh.lookAt(camera.position);
    });

    // controls.update();
    socket.emit('updatePosition', {
        x: avatar.position.x,
        y: avatar.position.y,
        z: avatar.position.z
    });
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

socket.on('existingUsers', (users) => {
    for (const id in users) {
        if (id === socket.id) continue;
        createOtherUser(id, users[id]);
    }
});

socket.on('newUser', (data) => {
    createOtherUser(data.id, data);
});

socket.on('userMoved', ({ id, position }) => {
    const user = otherUsers[id];
    if (user) {
        user.position.set(position.x, position.y, position.z);
    }
});

socket.on('userDisconnected', (id) => {
    if (otherUsers[id]) {
        scene.remove(otherUsers[id]);
        delete otherUsers[id];
    }
});

function createOtherUser(id, userData) {
    const geometry = new THREE.SphereGeometry(0.2, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: userData.color || 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
        userData.position?.x || 0,
        userData.position?.y || 0.2,
        userData.position?.z || 0
    );
    scene.add(mesh);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent background

    ctx.fillStyle = 'white'; // Or another color for contrast
    ctx.font = 'bold 96px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id.substring(0, 5), canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 1, 1); // Make it much bigger
    sprite.position.set(0, 0.6, 0);

    mesh.add(sprite);
    otherUsers[id] = mesh;
}



class StickyNote {
    constructor(position, text = "New Note", id = null) {
        this.id = id || crypto.randomUUID();
        this.text = text;
        this.position = position.clone();
        this.mesh = null;
        this.canvas = null;
        this.texture = null;
        
        this.createMesh();
        this.updateVisual();
        
        scene.add(this.mesh);
        stickyNotes[this.id] = this;
        
        console.log(`Created StickyNote ${this.id} with text: "${this.text}"`);
    }
    
    createMesh() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024; // Higher resolution
        this.canvas.height = 632;
        
        const ctx = this.canvas.getContext('2d');
        // Use a large font size
        ctx.font = '72px Arial'; // Try 72px or higher
        ctx.fillStyle = '#000';
        ctx.fillText(this.text, 40, 120); // Use larger coordinates

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({ 
            map: this.texture, 
            side: THREE.DoubleSide,
            transparent: true
        });
        const geometry = new THREE.PlaneGeometry(2, 1.2); // Larger note
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.4;
        // If you want the note to always face the camera:
        this.mesh.lookAt(camera.position);
        
        this.mesh.userData.stickyNote = this;
        this.mesh.userData.id = this.id;
    }
    
    updateVisual() {
        console.log(` updateVisual() called for ${this.id} with text: "${this.text}"`);
        const ctx = this.canvas.getContext('2d');

        this.canvas.width = 512;
        this.canvas.height = 320;
        
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.fillStyle = '#ffff88';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.strokeStyle = '#e6d55a';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);
        
        ctx.fillStyle = '#000';
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(this.text, 40, 120);
        
        this.texture.needsUpdate = true;
        
        if (this.mesh && this.mesh.material) {
            this.mesh.material.needsUpdate = true;
        }
        
        setTimeout(() => {
            if (this.texture) {
                this.texture.needsUpdate = true;
            }
        }, 10);
        
        console.log(`Updated visual for StickyNote ${this.id} with text: "${this.text}"`);
    }
    
    setText(newText) {
        console.log(`StickyNote.setText() called for ${this.id}: "${this.text}" -> "${newText}"`);
        this.text = newText;
        
        if (this.texture) {
            this.texture.dispose();
        }
        
        this.updateVisual();
        
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.needsUpdate = true;
        
        if (this.mesh && this.mesh.material) {
            this.mesh.material.map = this.texture;
            this.mesh.material.needsUpdate = true;
        }
        
        console.log(`StickyNote.setText() completed for ${this.id}, text is now: "${this.text}"`);
    }
    
    setPosition(newPosition) {
        console.log(`StickyNote.setPosition() called for ${this.id}, current text: "${this.text}"`);
        this.position.copy(newPosition);
        this.mesh.position.copy(newPosition);
        this.mesh.position.y += 0.4;

        this.updateVisual();
        console.log(`StickyNote.setPosition() completed for ${this.id}, text still: "${this.text}"`);
    }
    
    getText() {
        return this.text;
    }
    
    destroy() {
        if (this.mesh) {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            if (this.texture) {
                this.texture.dispose();
            }
        }
        delete stickyNotes[this.id];
    }

    setPosition(newPosition) {
    console.log(`StickyNote.setPosition() called for ${this.id}, text: "${this.text}"`);
    this.position.copy(newPosition);
    this.mesh.position.copy(newPosition);
    this.mesh.position.y += 0.4;

}

}

function getStickyNoteFromMesh(mesh) {
    return mesh.userData.stickyNote;
}

function createStickyNote(position, text = "New Note", id = null) {
    return new StickyNote(position, text, id);
}

// Edit functionality
editBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveNoteEdit();
    }
});

function saveNoteEdit() {
    const newText = editBox.value.trim();
    if (editingNote && newText) {
        const stickyNote = getStickyNoteFromMesh(editingNote);
        if (stickyNote) {
            console.log(`BEFORE setText: StickyNote ${stickyNote.id} text is "${stickyNote.getText()}"`);
            stickyNote.setText(newText);
            console.log(`AFTER setText: StickyNote ${stickyNote.id} text is "${stickyNote.getText()}"`);
            
            // Emit text update to other users
            socket.emit('updateStickyText', {
                id: stickyNote.id,
                text: newText
            });
            
            console.log(`Emitted updateStickyText for ${stickyNote.id} with text: "${newText}"`);
        }
    }

    editBoxContainer.style.display = 'none';
    editingNote = null;
}

document.addEventListener('click', (e) => {
    if (editingNote && !editBoxContainer.contains(e.target)) {
        saveNoteEdit();
    }
});

// Interaction system
let draggingNote = null;
let isDragging = false;
let dragStartTime = 0;
let dragStartPosition = { x: 0, y: 0 };

window.addEventListener('mousedown', (e) => {
    if (editBoxContainer.contains(e.target)) return;
    
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Object.values(stickyNotes).map(note => note.mesh);
    const intersects = raycaster.intersectObjects(meshes);
    
    if (intersects.length > 0) {
        draggingNote = intersects[0].object;
        dragStartTime = Date.now();
        dragStartPosition = { x: e.clientX, y: e.clientY };
        
        const stickyNote = getStickyNoteFromMesh(draggingNote);
        console.log(`Mouse down on StickyNote ${stickyNote.id} with text: "${stickyNote.getText()}"`);
        e.preventDefault();
    }
});

window.addEventListener('mousemove', (e) => {
    if (!draggingNote) return;
    
    const dragDistance = Math.sqrt(
        Math.pow(e.clientX - dragStartPosition.x, 2) + 
        Math.pow(e.clientY - dragStartPosition.y, 2)
    );
    
    if (dragDistance > 5 && !isDragging) {
        isDragging = true;
        const stickyNote = getStickyNoteFromMesh(draggingNote);
        console.log(`Started dragging StickyNote ${stickyNote.id}`);
    }
    
    if (!isDragging) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(plane);
    if (intersects.length > 0) {
        const point = intersects[0].point;
        const stickyNote = getStickyNoteFromMesh(draggingNote);
        
        stickyNote.setPosition(point);


        socket.emit('moveSticky', {
            id: stickyNote.id,
            position: { x: point.x, y: point.y, z: point.z }
        });
    }
});
let dragJustEnded = false;


window.addEventListener('mouseup', (e) => {
    if (draggingNote) {
        if (isDragging) {
            const stickyNote = getStickyNoteFromMesh(draggingNote);
            console.log(`Stopped dragging StickyNote ${stickyNote.id}, text preserved: "${stickyNote.getText()}"`);
            dragJustEnded = true; 
        }
        isDragging = false;
        draggingNote = null;
    }
});

window.addEventListener('dblclick', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Object.values(stickyNotes).map(note => note.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const mesh = intersects[0].object;
        const stickyNote = getStickyNoteFromMesh(mesh);
        if (!stickyNote) return;

        editingNote = mesh;

        editBox.value = stickyNote.getText();
        editBoxContainer.style.display = 'block';

        editBoxContainer.style.left = e.clientX + 'px';
        editBoxContainer.style.top = e.clientY + 'px';

        editBox.focus();

        console.log(`Double-clicked StickyNote ${stickyNote.id} for editing, current text: "${stickyNote.getText()}"`);
    }
});



window.addEventListener('click', (e) => {
    if (isDragging || draggingNote || dragJustEnded || editBoxContainer.contains(e.target)) {
        dragJustEnded = false; 
        return;
    }

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Object.values(stickyNotes).map(note => note.mesh);
    const noteIntersects = raycaster.intersectObjects(meshes);

    if (noteIntersects.length === 0) {
        const planeIntersects = raycaster.intersectObject(plane);
        if (planeIntersects.length > 0) {
            const point = planeIntersects[0].point;
            const noteId = crypto.randomUUID();

            createStickyNote(point, "New Note", noteId);

            if (socket && socket.connected) {
                socket.emit('newSticky', {
                    id: noteId,
                    position: { x: point.x, y: point.y, z: point.z },
                    text: "New Note"
                });
            }
        }
    }
});


window.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Object.values(stickyNotes).map(note => note.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const stickyNote = getStickyNoteFromMesh(intersects[0].object);
        if (!stickyNote) return;

        const confirmDelete = confirm(`Delete sticky note?\n"${stickyNote.getText()}"`);
        if (confirmDelete) {
            // Delete locally
            stickyNote.destroy();

            // Notify server
            socket.emit('deleteSticky', { id: stickyNote.id });
        }
    }
});


function saveWorkspace(name) {
    const notes = Object.values(stickyNotes).map(note => ({
        id: note.id,
        text: note.text,
        position: note.position
    }));

    const usersArray = Object.entries(otherUsers).map(([id, mesh]) => ({
        id,
        position: mesh.position,
        color: mesh.material.color.getHex()
    }));

    fetch('http://localhost:3000/api/workspace/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name || "Untitled Workspace",
            notes,
            users: usersArray
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert(` Workspace saved! ID: ${data.id}`);
        } else {
            alert(" Error saving workspace.");
        }
    })
    .catch(err => {
        console.error(" Save error:", err);
        alert(" Save failed.");
    });
}



const loadWorkspace = async (id) => {
  console.log('loadWorkspace called with id:', id);
  try {
    const response = await fetch(`http://localhost:3000/api/workspace/${id}`);
    const data = await response.json();
    console.log('Raw response data:', data);

    const ws = data.workspace;
    console.log('Loaded workspace:', ws);

    if (!ws || !ws.notes) {
      alert(data.error || "Workspace not found.");
      return;
    }

    // Clear existing sticky notes
    Object.values(stickyNotes).forEach(note => note.destroy());
    Object.keys(stickyNotes).forEach(key => delete stickyNotes[key]);

    ws.notes.forEach(note => {
      const pos = new THREE.Vector3(note.position.x, note.position.y, note.position.z);
      createStickyNote(pos, note.text, note.id);
    });

    alert(" Workspace loaded.");
  } catch (err) {
    console.error(" Load failed", err);
    alert("Error loading workspace.");
  }
};






socket.on('stickyDeleted', ({ id }) => {
    const stickyNote = stickyNotes[id];
    if (stickyNote) {
        stickyNote.destroy();
        console.log(`StickyNote ${id} deleted by another user`);
    }
});



socket.on('addSticky', (data) => {
    console.log(`Received addSticky event:`, data);
    const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    createStickyNote(pos, data.text, data.id);
});

socket.on('stickyMoved', (data) => {
    console.log(`Received stickyMoved event for note ${data.id}`);
    const stickyNote = stickyNotes[data.id];
    if (stickyNote) {
        const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        stickyNote.position.copy(pos);
        stickyNote.mesh.position.copy(pos);
        stickyNote.mesh.position.y += 0.4;
        console.log(`StickyNote ${data.id} moved, text preserved: "${stickyNote.getText()}"`);
    }
});

socket.on('stickyTextUpdated', (data) => {
    console.log(`Received stickyTextUpdated event:`, data);
    const stickyNote = stickyNotes[data.id];
    if (stickyNote) {
        stickyNote.setText(data.text);
    }
});


document.getElementById('saveBtn').addEventListener('click', async () => {
    const notes = Object.values(stickyNotes).map(note => ({
        id: note.id,
        text: note.getText(),
        position: {
            x: note.position.x,
            y: note.position.y,
            z: note.position.z
        }
    }));

    const usersPayload = Object.entries(otherUsers).map(([id, mesh]) => ({
        id,
        position: {
            x: mesh.position.x,
            y: mesh.position.y,
            z: mesh.position.z
        },
        color: mesh.material.color.getHex()
    }));

    const payload = {
        name: "My 3D Workspace",
        notes,
        users: usersPayload
    };

    try {
        const res = await fetch('http://localhost:3000/api/workspace/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        alert(`Saved! Workspace ID:\n${result.id}`);
    } catch (err) {
        console.error(" Save failed", err);
        alert("Error saving workspace.");
    }
});


document.getElementById('loadBtn').addEventListener('click', async () => {
    const id = document.getElementById('workspaceId').value.trim();
    if (!id) return alert("Enter workspace ID!");

    try {
        const res = await fetch(`http://localhost:3000/api/workspace/${id}`);
        const data = await res.json();

        // Clear current scene sticky notes
        Object.values(stickyNotes).forEach(note => note.destroy());
        Object.keys(stickyNotes).forEach(key => delete stickyNotes[key]);

        const ws = data.workspace; 
        console.log('Loaded workspace:', ws);

        if (!ws || !ws.notes) {
          alert(data.error || "Workspace not found.");
          return;
        }

        ws.notes.forEach(note => {
            const pos = new THREE.Vector3(note.position.x, note.position.y, note.position.z);
            createStickyNote(pos, note.text, note.id);
        });

        alert(" Workspace loaded.");
    } catch (err) {
        console.error(" Load failed", err);
        alert("Error loading workspace.");
    }
});

document.getElementById('viewAllBtn').addEventListener('click', async () => {
    const listDiv = document.getElementById('workspaceList');
    listDiv.style.display = listDiv.style.display === 'none' ? 'block' : 'none';

    if (listDiv.innerHTML !== '') return; // already loaded once

    try {
        const res = await fetch('http://localhost:3000/api/workspace/all');
        const result = await res.json();

        if (!result.success) return alert(" Failed to load workspaces");

        result.data.forEach(ws => {
            const entry = document.createElement('div');
            entry.innerHTML = `
                <strong>${ws.name}</strong> (${ws._id})
                <button onclick="loadWorkspace('${ws._id}')"> Load</button>
                <hr/>
            `;
            listDiv.appendChild(entry);
        });
    } catch (err) {
        console.error(" Error loading workspace list:", err);
        alert("Error loading workspace list.");
    }
});



