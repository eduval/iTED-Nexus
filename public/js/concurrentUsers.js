const db = firebase.database();

function updateOnlineCount() {
    const onlineRef = db.ref("onlineUsers");
    onlineRef.on("value", (snapshot) => {
        const count = snapshot.numChildren();
        document.getElementById("userCount").textContent = `Online Users: ${count}`;
    });
}

function markOnline(user) {
    const userRef = db.ref(`onlineUsers/${user.uid}`);
    userRef.set(true);
    userRef.onDisconnect().remove();
    updateOnlineCount();
}

updateOnlineCount();

