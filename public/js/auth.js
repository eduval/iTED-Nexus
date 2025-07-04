function setupPresence(user) {
    const db = firebase.database();
    const userSessionPath = `sessions/${user.uid}`;
    const onlineUserPath = `onlineUsers/${user.uid}`;
    const thisSessionId = Math.random().toString(36).substring(2);

    const sessionRef = db.ref(userSessionPath);
    const onlineRef = db.ref(onlineUserPath);

    // 1. Write this session ID to the database
    sessionRef.set(thisSessionId).catch(console.error);

    // 2. Setup disconnection cleanup
    sessionRef.onDisconnect().remove();
    onlineRef.set(true);
    onlineRef.onDisconnect().remove();

    // 3. Watch for session changes (force logout if session overwritten)
    sessionRef.on("value", (snapshot) => {
        const activeSession = snapshot.val();
        if (activeSession !== thisSessionId) {
            // Someone else logged in; this session is invalid
            firebase.auth().signOut().then(() => {
                alert("You've been logged out because your account was used on another device.");
                window.location.href = "login.html";
            });
        }
    });

    // Optional: show total online users somewhere
    const countRef = db.ref("onlineUsers");
    countRef.on("value", (snapshot) => {
        const onlineUsers = snapshot.val();
        const count = onlineUsers ? Object.keys(onlineUsers).length : 0;
        const counterEl = document.getElementById("onlineCounter");
        if (counterEl) {
            counterEl.textContent = `${count} user${count !== 1 ? 's' : ''} online`;
        }
    });
}



firebase.auth().onAuthStateChanged((user) => {
    if (!user) {
        window.location.href = "login.html";
    } else {
        localStorage.setItem("sessionId", "session-" + Date.now());
        const userAgent = navigator.userAgent;
        localStorage.setItem("deviceInfo", userAgent);
        setupPresence(user); // now defined above
    }
});



