const socket = io('http://localhost:3000');
const otherUsers = {};

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const gridHelper = new THREE.GridHelper(10, 10);
scene.add(gridHelper);
scene.background = new THREE.Color(0xf0f0f0);

const planegem = new THREE.PlaneGeometry(10, 10);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
const plane = new THREE.Mesh(planegem, planeMaterial);
plane.rotation.x = -Math.PI / 2;
scene.add(plane);

const avtarGeo = new THREE.SphereGeometry(0.2, 32, 32);
const avtarmaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
const avatar = new THREE.Mesh(avtarGeo, avtarmaterial);
scene.add(avatar);

avatar.position.y = 0.2;

let moveX = 0;
let moveZ = 0;

document.addEventListener('keydown', (e) => {
    if (e.key == 'ArrowUp') moveZ = -0.05;
    if (e.key == 'ArrowDown') moveZ = 0.05;
    if (e.key == "ArrowLeft") moveX = -0.05;
    if (e.key == 'ArrowRight') moveX = 0.05;
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

function animate() {
    requestAnimationFrame(animate);
    
    avatar.position.x += moveX;
    avatar.position.z += moveZ;

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
    otherUsers[id] = mesh;
}

// Fixed variable name
const stickyNotes = {};

function createStickyNote(position, text = "New Note", id = null) {
    const width = 1;
    const height = 0.6;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 158;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffff88';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = '20px Arial';
    ctx.fillText(text, 10, 50);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(width, height);
    const note = new THREE.Mesh(geometry, material);

    note.position.copy(position);
    note.position.y += 0.4;
    scene.add(note);

    const noteId = id || crypto.randomUUID();
    stickyNotes[noteId] = note;
    note.userData.id = noteId;
    
    return note;
}

let draggingNote = null;
let isDragging = false;

window.addEventListener('mousedown', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const notes = Object.values(stickyNotes);
    const intersects = raycaster.intersectObjects(notes);
    
    if (intersects.length > 0) {
        draggingNote = intersects[0].object;
        isDragging = true;
        e.preventDefault(); // Prevent default behavior
        console.log('Started dragging note:', draggingNote.userData.id);
    }
});

window.addEventListener('mousemove', (e) => {
    if (!draggingNote || !isDragging) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(plane);
    if (intersects.length > 0) {
        const point = intersects[0].point;
        draggingNote.position.set(point.x, point.y + 0.4, point.z);

        socket.emit('moveSticky', {
            id: draggingNote.userData.id,
            position: {
                x: point.x,
                y: point.y,
                z: point.z
            }
        });
    }
});

window.addEventListener('mouseup', (e) => {
    if (isDragging) {
        console.log('Stopped dragging note');
        isDragging = false;
        draggingNote = null;
    }
});

window.addEventListener('click', (e) => {
    if (isDragging) return;
    
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const notes = Object.values(stickyNotes);
    const noteIntersects = raycaster.intersectObjects(notes);
    
    if (noteIntersects.length === 0) {
        const planeIntersects = raycaster.intersectObject(plane);
        if (planeIntersects.length > 0) {
            const point = planeIntersects[0].point;
            const noteId = crypto.randomUUID();
            
            createStickyNote(point, "New Note", noteId);
            
            if (socket && socket.connected) {
                socket.emit('newSticky', {
                    id: noteId,
                    position: {
                        x: point.x,
                        y: point.y,
                        z: point.z
                    },
                    text: "New Note"
                });
            }
        }
    }
});

socket.on('addSticky', (data) => {
    const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    createStickyNote(pos, data.text, data.id);
});

socket.on('stickyMoved', (data) => {
    const note = stickyNotes[data.id];
    if (note) {
        note.position.set(data.position.x, data.position.y + 0.4, data.position.z);
    }
});