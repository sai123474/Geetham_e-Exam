// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
const app = express();
const PORT = 3000;
// IMPORTANT: Replace with your actual Google AI API key.
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0"; 
const genAI = new GoogleGenerativeAI(API_KEY);

// --- FILE PATHS ---
const quizzesFilePath = path.join(__dirname, 'quizzes.json');
const resultsFilePath = path.join(__dirname, 'results.json');

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- API ENDPOINTS ---

// Get all quiz data for the student page and admin panel
app.get('/get-quizzes', (req, res) => {
    fs.readFile(quizzesFilePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send('Error reading quizzes file.');
        res.json(JSON.parse(data));
    });
});

// Save updated quiz data from the admin panel
app.post('/update-quizzes', (req, res) => {
    const updatedQuizzes = req.body;
    fs.writeFile(quizzesFilePath, JSON.stringify(updatedQuizzes, null, 2), (err) => {
        if (err) return res.status(500).send('Error saving quizzes.');
        res.status(200).send('Quizzes updated successfully.');
    });
});

// Check if a student has already attempted a specific quiz
app.post('/check-attempt', (req, res) => {
    const { mobile, quizId } = req.body;
    fs.readFile(resultsFilePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') return res.json({ canAttempt: true });
            return res.status(500).send('Error reading results file.');
        }
        const results = JSON.parse(data);
        const hasAttempted = results.some(r => r.mobile === mobile && r.quizId === quizId);
        if (hasAttempted) {
            res.json({ canAttempt: false, message: "You have already attempted this quiz." });
        } else {
            res.json({ canAttempt: true });
        }
    });
});

// Save a student's submitted result
app.post('/submit-result', (req, res) => {
    const newResult = req.body;
    fs.readFile(resultsFilePath, 'utf8', (err, data) => {
        if (err && err.code !== 'ENOENT') return res.status(500).send('Error saving results file.');
        const results = data ? JSON.parse(data) : [];
        results.push(newResult);
        fs.writeFile(resultsFilePath, JSON.stringify(results, null, 2), (err) => {
            if (err) return res.status(500).send('Error saving result.');
            res.status(200).send('Result saved successfully.');
        });
    });
});

// Get all results for the teacher's dashboard
app.get('/results', (req, res) => {
    fs.readFile(resultsFilePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') return res.json([]);
            return res.status(500).send('Error reading results file.');
        }
        res.json(JSON.parse(data));
    });
});

// Clear all results from the database
app.post('/clear-results', (req, res) => {
    fs.writeFile(resultsFilePath, JSON.stringify([], null, 2), (err) => {
        if (err) return res.status(500).send('Error clearing results.');
        res.status(200).send('Results cleared successfully.');
    });
});

// AI Endpoint to generate questions from a topic
app.post('/generate-questions', async (req, res) => {
    try {
        const { topic, numQuestions } = req.body;
        // ...
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest"});
// ...
        const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic of "${topic}". Provide the question text, four options, and the 0-based index of the correct answer. Format the response as a single, valid JSON array of objects. Each object must have keys: "text", "options" (an array of 4 strings), and "correctAnswer" (a number). Output only the raw JSON array.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonResponse = text.replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(jsonResponse));
    } catch (error) {
        res.status(500).send("Failed to generate questions with AI.");
    }
});

// AI Endpoint to generate questions from pasted text
// In server.js

app.post('/generate-from-text', async (req, res) => {
    try {
        const { text } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        // MODIFIED PROMPT: Now asks the AI to identify the subject
        const prompt = `Analyze the following text from a question paper and convert it into a valid JSON array of objects. Each object must have keys: "subject" (either "Physics", "Chemistry", or "Mathematics"), "text" (the question), "options" (an array of 4 strings), and "correctAnswer" (the 0-based index of the correct option). Extract all questions. Output only the raw JSON array. Text to analyze: "${text}"`;

        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.text();
        const jsonResponse = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        res.json(JSON.parse(jsonResponse));
    } catch (error) {
        console.error("Error generating from text with AI:", error);
        res.status(500).send("Failed to process text with AI.");
    }
});
// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});