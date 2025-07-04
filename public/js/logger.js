function maybeCorrupt(value, probability = 0.1) {
    return Math.random() < probability ? null : value;
}

function logAnswer({ questionId, selectedAnswer, isCorrect, currentQuestion, questionStartTime, mode }) {
    const timestampEnd = Date.now();
    const timestampStart = maybeCorrupt(questionStartTime);
    const duration = timestampEnd - (timestampStart || timestampEnd); // fallback safe

    const log = {
        "@timestamp": new Date().toISOString(),

        event: {
            type: "questionAnswered",
            category: "user_interaction",
            action: "submit_answer",
            duration: duration
        },

        user: {
            id: firebase.auth().currentUser?.uid || "unknown"
        },

        session: {
            id: localStorage.getItem("sessionId"),
            mode: mode
        },

        question: {
            id: questionId,
            text: currentQuestion?.text || "",
            selected: typeof selectedAnswer === 'object' ? JSON.stringify(selectedAnswer) : selectedAnswer,
            selectedAnswers: Array.isArray(selectedAnswer) ? selectedAnswer : [selectedAnswer],
            correct: isCorrect
        },

        device: {
            user_agent: maybeCorrupt(localStorage.getItem("deviceInfo")),
            ip: sessionStorage.getItem("ipInfo") ? JSON.parse(sessionStorage.getItem("ipInfo")).ip : null
        },

        geo: sessionStorage.getItem("ipInfo") ? JSON.parse(sessionStorage.getItem("ipInfo")).geo || {} : {},

        log: {
            source: window.location.pathname.split("/").pop() || "unknown"
        },

        tags: ["ccna", mode],

        // Optional for Grafana-style metrics
        metric: {
            name: "answer_accuracy",
            value: isCorrect ? 1 : 0
        },

        // Optional: simulated alert
        alert: (mode === "exam" && !isCorrect) ? {
            severity: 2,
            signature: "Incorrect answer in exam mode",
            category: "Suspicious Behavior"
        } : undefined
    };

    // Clean up null/undefined fields
    Object.keys(log).forEach(key => {
        if (log[key] === undefined) delete log[key];
    });

    firebase.database().ref(`userLogs/${log.session.id}/${questionId}`).set(log);
}


